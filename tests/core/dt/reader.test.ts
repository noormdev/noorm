/**
 * DtReader tests.
 *
 * Covers reading .dt/.dtz/.dtzx files, schema parsing, and row iteration.
 * Depends on DtWriter for fixture generation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { DtWriter } from '../../../src/core/dt/writer.js';
import { DtReader } from '../../../src/core/dt/reader.js';
import type { DtSchema } from '../../../src/core/dt/types.js';

const TMP_DIR = path.join(process.cwd(), 'tmp');

describe('dt: reader', () => {

    let testDir: string;

    const schema: DtSchema = {
        v: 1,
        d: 'postgresql',
        dv: '16.2',
        t: 'users',
        columns: [
            { name: 'id', type: 'int' },
            { name: 'name', type: 'string' },
            { name: 'active', type: 'bool' },
        ],
    };

    const testRows = [
        [1, 'alice', true],
        [2, 'bob', false],
        [3, 'charlie', true],
    ];

    async function writeFixture(ext: string, passphrase?: string): Promise<string> {

        const filepath = path.join(testDir, `test${ext}`);
        const writer = new DtWriter({ filepath, schema, passphrase });
        await writer.open();

        for (const row of testRows) {

            writer.writeRow(row);

        }

        await writer.close();

        return filepath;

    }

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

    // -----------------------------------------------------------------------
    // .dt reading
    // -----------------------------------------------------------------------

    describe('.dt reading', () => {

        it('should parse schema from line 1', async () => {

            const filepath = await writeFixture('.dt');
            const reader = new DtReader({ filepath });
            await reader.open();

            expect(reader.schema).toBeTruthy();
            expect(reader.schema!.v).toBe(1);
            expect(reader.schema!.d).toBe('postgresql');
            expect(reader.schema!.t).toBe('users');
            expect(reader.schema!.columns).toHaveLength(3);

            reader.close();

        });

        it('should iterate over rows', async () => {

            const filepath = await writeFixture('.dt');
            const reader = new DtReader({ filepath });
            await reader.open();

            const rows = [];

            for await (const values of reader.rows()) {

                rows.push(values);

            }

            reader.close();

            expect(rows).toHaveLength(3);
            expect(rows[0]).toEqual([1, 'alice', true]);
            expect(rows[1]).toEqual([2, 'bob', false]);
            expect(rows[2]).toEqual([3, 'charlie', true]);

        });

        it('should throw if rows() called before open()', async () => {

            const filepath = await writeFixture('.dt');
            const reader = new DtReader({ filepath });

            const iter = reader.rows();
            await expect(iter.next()).rejects.toThrow('Reader not opened');

        });

    });

    // -----------------------------------------------------------------------
    // .dtz reading
    // -----------------------------------------------------------------------

    describe('.dtz reading', () => {

        it('should read gzip-compressed file', async () => {

            const filepath = await writeFixture('.dtz');
            const reader = new DtReader({ filepath });
            await reader.open();

            expect(reader.schema!.v).toBe(1);

            const rows = [];

            for await (const values of reader.rows()) {

                rows.push(values);

            }

            reader.close();

            expect(rows).toHaveLength(3);
            expect(rows[0]).toEqual([1, 'alice', true]);

        });

    });

    // -----------------------------------------------------------------------
    // .dtzx reading
    // -----------------------------------------------------------------------

    describe('.dtzx reading', () => {

        it('should require passphrase', async () => {

            const filepath = await writeFixture('.dtzx', 'secret');
            const reader = new DtReader({ filepath });

            await expect(reader.open()).rejects.toThrow('Passphrase required');

        });

        it('should read encrypted file with correct passphrase', async () => {

            const filepath = await writeFixture('.dtzx', 'secret');
            const reader = new DtReader({ filepath, passphrase: 'secret' });
            await reader.open();

            expect(reader.schema!.v).toBe(1);
            expect(reader.schema!.t).toBe('users');

            const rows = [];

            for await (const values of reader.rows()) {

                rows.push(values);

            }

            reader.close();

            expect(rows).toHaveLength(3);
            expect(rows[0]).toEqual([1, 'alice', true]);

        });

        it('should fail with wrong passphrase', async () => {

            const filepath = await writeFixture('.dtzx', 'secret');
            const reader = new DtReader({ filepath, passphrase: 'wrong' });

            await expect(reader.open()).rejects.toThrow();

        });

    });

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    describe('edge cases', () => {

        it('should handle empty file (no rows)', async () => {

            const filepath = path.join(testDir, 'empty.dt');
            const writer = new DtWriter({ filepath, schema });
            await writer.open();
            await writer.close();

            const reader = new DtReader({ filepath });
            await reader.open();

            const rows = [];

            for await (const values of reader.rows()) {

                rows.push(values);

            }

            reader.close();

            expect(rows).toHaveLength(0);

        });

        it('should close gracefully even if not fully iterated', async () => {

            const filepath = await writeFixture('.dt');
            const reader = new DtReader({ filepath });
            await reader.open();

            // Read only first row
            const iter = reader.rows();
            await iter.next();

            // Close without reading all rows
            reader.close();

        });

    });

});
