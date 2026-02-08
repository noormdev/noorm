/**
 * Round-trip tests.
 *
 * serialize → write → read → deserialize end-to-end for all types.
 * Verifies data fidelity across the full .dt pipeline.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { serializeRow } from '../../../src/core/dt/serialize.js';
import { deserializeRow } from '../../../src/core/dt/deserialize.js';
import { DtWriter } from '../../../src/core/dt/writer.js';
import { DtReader } from '../../../src/core/dt/reader.js';
import type { DtSchema, DtColumn } from '../../../src/core/dt/types.js';

const TMP_DIR = path.join(process.cwd(), 'tmp');

describe('dt: roundtrip', () => {

    let testDir: string;

    beforeEach(() => {

        const hex = randomBytes(4).toString('hex');
        testDir = path.join(TMP_DIR, `test-${hex}`);
        mkdirSync(testDir, { recursive: true });

    });

    afterEach(() => {

        if (existsSync(testDir)) {

            rmSync(testDir, { recursive: true, force: true });

        }

    });

    /**
     * Full round-trip: serialize → write → read → deserialize
     */
    async function roundTrip(
        columns: DtColumn[],
        rows: Record<string, unknown>[],
        ext: string,
        passphrase?: string,
    ): Promise<Record<string, unknown>[]> {

        const schema: DtSchema = {
            v: 1,
            d: 'postgresql',
            dv: '16.2',
            t: 'test_table',
            columns,
        };

        // Serialize
        const serializedRows = rows.map((row) => serializeRow({ row, columns }));

        // Write
        const filepath = path.join(testDir, `roundtrip${ext}`);
        const writer = new DtWriter({ filepath, schema, passphrase });
        await writer.open();

        for (const values of serializedRows) {

            writer.writeRow(values);

        }

        await writer.close();

        // Read
        const reader = new DtReader({ filepath, passphrase });
        await reader.open();

        const readRows: Record<string, unknown>[] = [];

        for await (const values of reader.rows()) {

            readRows.push(deserializeRow({
                values,
                columns,
                targetDialect: 'postgres',
            }));

        }

        reader.close();

        return readRows;

    }

    // -----------------------------------------------------------------------
    // Simple types
    // -----------------------------------------------------------------------

    describe('simple types', () => {

        it('should round-trip int values', async () => {

            const columns: DtColumn[] = [{ name: 'id', type: 'int' }];
            const rows = [{ id: 1 }, { id: 42 }, { id: 0 }, { id: -100 }];

            const result = await roundTrip(columns, rows, '.dt');

            expect(result[0]!.id).toBe(1);
            expect(result[1]!.id).toBe(42);
            expect(result[2]!.id).toBe(0);
            expect(result[3]!.id).toBe(-100);

        });

        it('should round-trip string values', async () => {

            const columns: DtColumn[] = [{ name: 'name', type: 'string' }];
            const rows = [{ name: 'alice' }, { name: '' }, { name: 'hello "world"' }];

            const result = await roundTrip(columns, rows, '.dt');

            expect(result[0]!.name).toBe('alice');
            expect(result[1]!.name).toBe('');
            expect(result[2]!.name).toBe('hello "world"');

        });

        it('should round-trip bool values', async () => {

            const columns: DtColumn[] = [{ name: 'active', type: 'bool' }];
            const rows = [{ active: true }, { active: false }];

            const result = await roundTrip(columns, rows, '.dt');

            expect(result[0]!.active).toBe(true);
            expect(result[1]!.active).toBe(false);

        });

        it('should round-trip bigint as string', async () => {

            const columns: DtColumn[] = [{ name: 'big', type: 'bigint' }];
            const rows = [{ big: '9007199254740993' }];

            const result = await roundTrip(columns, rows, '.dt');

            // bigint stays as string for precision
            expect(result[0]!.big).toBe('9007199254740993');

        });

        it('should round-trip decimal as string', async () => {

            const columns: DtColumn[] = [{ name: 'amount', type: 'decimal' }];
            const rows = [{ amount: '99.99' }];

            const result = await roundTrip(columns, rows, '.dt');

            expect(result[0]!.amount).toBe('99.99');

        });

        it('should round-trip timestamp', async () => {

            const columns: DtColumn[] = [{ name: 'ts', type: 'timestamp' }];
            const d = new Date('2024-01-15T10:30:00.000Z');
            const rows = [{ ts: d }];

            const result = await roundTrip(columns, rows, '.dt');

            expect((result[0]!.ts as Date).toISOString()).toBe('2024-01-15T10:30:00.000Z');

        });

        it('should round-trip date', async () => {

            const columns: DtColumn[] = [{ name: 'dt', type: 'date' }];
            const d = new Date('2024-01-15T00:00:00.000Z');
            const rows = [{ dt: d }];

            const result = await roundTrip(columns, rows, '.dt');

            expect(result[0]!.dt).toBe('2024-01-15');

        });

        it('should round-trip uuid', async () => {

            const columns: DtColumn[] = [{ name: 'uid', type: 'uuid' }];
            const uuid = '550e8400-e29b-41d4-a716-446655440000';
            const rows = [{ uid: uuid }];

            const result = await roundTrip(columns, rows, '.dt');

            expect(result[0]!.uid).toBe(uuid);

        });

        it('should round-trip null values', async () => {

            const columns: DtColumn[] = [
                { name: 'id', type: 'int' },
                { name: 'name', type: 'string', nullable: true },
            ];
            const rows = [{ id: 1, name: null }];

            const result = await roundTrip(columns, rows, '.dt');

            expect(result[0]!.id).toBe(1);
            expect(result[0]!.name).toBe(null);

        });

    });

    // -----------------------------------------------------------------------
    // Encoded types
    // -----------------------------------------------------------------------

    describe('encoded types', () => {

        it('should round-trip json', async () => {

            const columns: DtColumn[] = [{ name: 'data', type: 'json' }];
            const obj = { key: 'value', nested: { arr: [1, 2] } };
            const rows = [{ data: obj }];

            const result = await roundTrip(columns, rows, '.dt');

            expect(result[0]!.data).toEqual(obj);

        });

        it('should round-trip vector', async () => {

            const columns: DtColumn[] = [{ name: 'emb', type: 'vector' }];
            const vec = [0.1, 0.2, 0.3, 0.4];
            const rows = [{ emb: vec }];

            const result = await roundTrip(columns, rows, '.dt');

            // postgres target: pgvector string
            expect(result[0]!.emb).toBe('[0.1,0.2,0.3,0.4]');

        });

        it('should round-trip array', async () => {

            const columns: DtColumn[] = [{ name: 'tags', type: 'array' }];
            const arr = ['red', 'green', 'blue'];
            const rows = [{ tags: arr }];

            const result = await roundTrip(columns, rows, '.dt');

            // postgres target: native array
            expect(result[0]!.tags).toEqual(arr);

        });

        it('should round-trip binary', async () => {

            const columns: DtColumn[] = [{ name: 'blob', type: 'binary' }];
            const buf = Buffer.from('hello binary');
            const rows = [{ blob: buf }];

            const result = await roundTrip(columns, rows, '.dt');

            expect(Buffer.isBuffer(result[0]!.blob)).toBe(true);
            expect((result[0]!.blob as Buffer).toString()).toBe('hello binary');

        });

        it('should round-trip small text (raw encoding)', async () => {

            const columns: DtColumn[] = [{ name: 'content', type: 'text' }];
            const rows = [{ content: 'short article' }, { content: '' }];

            const result = await roundTrip(columns, rows, '.dt');

            expect(result[0]!.content).toBe('short article');
            expect(result[1]!.content).toBe('');

        });

        it('should round-trip large text (gz64 encoding)', async () => {

            const columns: DtColumn[] = [{ name: 'content', type: 'text' }];
            const largeText = 'The quick brown fox jumps over the lazy dog. '.repeat(100);
            const rows = [{ content: largeText }];

            const result = await roundTrip(columns, rows, '.dt');

            expect(result[0]!.content).toBe(largeText);

        });

        it('should round-trip text with multiline and special characters', async () => {

            const columns: DtColumn[] = [{ name: 'content', type: 'text' }];
            const text = 'Line 1\nLine 2\n\t"quoted"\n\u{1F600} emoji\nend';
            const rows = [{ content: text }];

            const result = await roundTrip(columns, rows, '.dt');

            expect(result[0]!.content).toBe(text);

        });

    });

    // -----------------------------------------------------------------------
    // Compressed and encrypted
    // -----------------------------------------------------------------------

    describe('compressed (.dtz)', () => {

        it('should round-trip all types through gzip', async () => {

            const columns: DtColumn[] = [
                { name: 'id', type: 'int' },
                { name: 'name', type: 'string' },
                { name: 'data', type: 'json' },
            ];

            const rows = [
                { id: 1, name: 'alice', data: { x: 1 } },
                { id: 2, name: 'bob', data: { x: 2 } },
            ];

            const result = await roundTrip(columns, rows, '.dtz');

            expect(result).toHaveLength(2);
            expect(result[0]!.id).toBe(1);
            expect(result[0]!.name).toBe('alice');
            expect(result[0]!.data).toEqual({ x: 1 });

        });

    });

    describe('encrypted (.dtzx)', () => {

        it('should round-trip all types through encryption', async () => {

            const columns: DtColumn[] = [
                { name: 'id', type: 'int' },
                { name: 'name', type: 'string' },
                { name: 'active', type: 'bool' },
            ];

            const rows = [
                { id: 1, name: 'alice', active: true },
                { id: 2, name: 'bob', active: false },
            ];

            const result = await roundTrip(columns, rows, '.dtzx', 'test-passphrase');

            expect(result).toHaveLength(2);
            expect(result[0]!.id).toBe(1);
            expect(result[0]!.name).toBe('alice');
            expect(result[0]!.active).toBe(true);
            expect(result[1]!.active).toBe(false);

        });

    });

    // -----------------------------------------------------------------------
    // Mixed types
    // -----------------------------------------------------------------------

    describe('mixed types', () => {

        it('should round-trip a realistic row with all type families', async () => {

            const columns: DtColumn[] = [
                { name: 'id', type: 'int' },
                { name: 'name', type: 'string' },
                { name: 'Content', type: 'text' },
                { name: 'amount', type: 'decimal' },
                { name: 'active', type: 'bool' },
                { name: 'uid', type: 'uuid' },
                { name: 'metadata', type: 'json' },
                { name: 'created_at', type: 'timestamp' },
            ];

            const largeContent = 'This is a long article body with real content. '.repeat(50);

            const rows = [{
                id: 42,
                name: 'Alice Wonderland',
                Content: largeContent,
                amount: '1234.56',
                active: true,
                uid: '550e8400-e29b-41d4-a716-446655440000',
                metadata: { role: 'admin', tags: ['vip'] },
                created_at: new Date('2024-06-15T08:30:00.000Z'),
            }];

            const result = await roundTrip(columns, rows, '.dt');

            expect(result[0]!.id).toBe(42);
            expect(result[0]!.name).toBe('Alice Wonderland');
            expect(result[0]!.Content).toBe(largeContent);
            expect(result[0]!.amount).toBe('1234.56');
            expect(result[0]!.active).toBe(true);
            expect(result[0]!.uid).toBe('550e8400-e29b-41d4-a716-446655440000');
            expect(result[0]!.metadata).toEqual({ role: 'admin', tags: ['vip'] });
            expect((result[0]!.created_at as Date).toISOString()).toBe('2024-06-15T08:30:00.000Z');

        });

    });

});
