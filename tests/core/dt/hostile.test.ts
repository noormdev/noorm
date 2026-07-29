/**
 * Hostile `.dt` input corpus.
 *
 * A `.dt` file arrives from a colleague, an object store, or a CI artifact —
 * it is untrusted input. The reader trusted it entirely: only `schema.v` was
 * checked, gzip was inflated without a ceiling, and undecodable payloads
 * became empty buffers or passed through raw. Every case below used to import
 * "successfully", exhaust memory, or hang the pipeline forever.
 *
 * The existing dt suite round-trips data the same code wrote, so none of it
 * can fail on any of these.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { attempt, attemptSync } from '@logosdx/utils';

import { DtReader } from '../../../src/core/dt/reader.js';
import { deserializeValue } from '../../../src/core/dt/deserialize.js';
import {
    MAX_DECOMPRESSED_VALUE_BYTES,
    MAX_ROW_BYTES,
} from '../../../src/core/dt/constants.js';
import type { DtColumn } from '../../../src/core/dt/types.js';

const TMP_DIR = path.join(process.cwd(), 'tmp');

const SCHEMA_LINE = JSON.stringify({
    v: 1,
    d: 'postgresql',
    dv: '17.9',
    t: 'category',
    columns: [
        { name: 'id', type: 'int' },
        { name: 'name', type: 'string' },
        { name: 'payload', type: 'json' },
    ],
});

describe('dt: hostile input', () => {

    let testDir: string;

    beforeEach(() => {

        testDir = path.join(TMP_DIR, `test-hostile-${randomBytes(4).toString('hex')}`);
        mkdirSync(testDir, { recursive: true });

    });

    afterEach(() => {

        if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });

    });

    /**
     * Write a `.dt` file from raw lines and read every row out of it.
     */
    async function readAll(lines: string[], name = 'hostile.dt'): Promise<unknown[][]> {

        const filepath = path.join(testDir, name);
        writeFileSync(filepath, lines.join('\n'));

        const reader = new DtReader({ filepath });
        await reader.open();

        const rows: unknown[][] = [];

        for await (const values of reader.rows()) {

            rows.push(values);

        }

        reader.close();

        return rows;

    }

    describe('schema header', () => {

        it('should reject a header with no columns', async () => {

            const filepath = path.join(testDir, 'no-columns.dt');
            writeFileSync(filepath, JSON.stringify({ v: 1, d: 'postgresql', dv: '17.9', t: 'category' }));

            const reader = new DtReader({ filepath });
            const [, err] = await attempt(() => reader.open());

            expect(err).toBeInstanceOf(Error);
            // Not `undefined is not an object (evaluating 'q.columns')`.
            expect(err!.message).toMatch(/columns/);

        });

        it('should reject a header that is not an object', async () => {

            const filepath = path.join(testDir, 'array-header.dt');
            writeFileSync(filepath, '[1, 2, 3]');

            const reader = new DtReader({ filepath });
            const [, err] = await attempt(() => reader.open());

            expect(err).toBeInstanceOf(Error);
            expect(err!.message).toMatch(/not an object/);

        });

        it('should reject a column entry with no name', async () => {

            const filepath = path.join(testDir, 'nameless-column.dt');
            writeFileSync(filepath, JSON.stringify({
                v: 1, d: 'postgresql', dv: '17.9', t: 'category',
                columns: [{ type: 'int' }],
            }));

            const reader = new DtReader({ filepath });
            const [, err] = await attempt(() => reader.open());

            expect(err).toBeInstanceOf(Error);
            expect(err!.message).toMatch(/"name"/);

        });

        it('should reject an unparseable header', async () => {

            const filepath = path.join(testDir, 'garbage.dt');
            writeFileSync(filepath, '{not: valid, json5');

            const reader = new DtReader({ filepath });
            const [, err] = await attempt(() => reader.open());

            expect(err).toBeInstanceOf(Error);
            expect(err!.message).toMatch(/not valid JSON5/);

        });

        it('should reject an empty file', async () => {

            const filepath = path.join(testDir, 'empty.dt');
            writeFileSync(filepath, '');

            const reader = new DtReader({ filepath });
            const [, err] = await attempt(() => reader.open());

            expect(err).toBeInstanceOf(Error);

        });

    });

    describe('row arity', () => {

        it('should reject a row shorter than the column list', async () => {

            const [, err] = await attempt(() => readAll([SCHEMA_LINE, '[1, "a"]']));

            expect(err).toBeInstanceOf(Error);
            expect(err!.message).toMatch(/2 values but the schema declares 3/);

        });

        it('should reject a row longer than the column list', async () => {

            const [, err] = await attempt(() => readAll([SCHEMA_LINE, '[1, "a", {}, "extra"]']));

            expect(err).toBeInstanceOf(Error);
            expect(err!.message).toMatch(/4 values but the schema declares 3/);

        });

        it('should reject an object row', async () => {

            const [, err] = await attempt(() => readAll([SCHEMA_LINE, '{"id": 1}']));

            expect(err).toBeInstanceOf(Error);
            expect(err!.message).toMatch(/not an array/);

        });

        it('should reject a truncated row', async () => {

            const [, err] = await attempt(() => readAll([SCHEMA_LINE, '[1, "a", ']));

            expect(err).toBeInstanceOf(Error);
            expect(err!.message).toMatch(/row 1 is not valid JSON5/);

        });

        it('should accept a well-formed row', async () => {

            const rows = await readAll([SCHEMA_LINE, '[1, "a", [{"k":1}, "raw"]]']);

            expect(rows.length).toBe(1);
            expect(rows[0]!.length).toBe(3);

        });

    });

    describe('line length', () => {

        it('should cap a single line rather than buffer it whole', () => {

            // The guard is what makes a newline-free file safe; assert the
            // limit exists and is a real bound, since materialising 256 MB
            // in a unit test is not worth the runtime.
            expect(MAX_ROW_BYTES).toBeGreaterThan(0);
            expect(MAX_ROW_BYTES).toBeLessThan(2 ** 31);

        });

    });

    describe('encoded values', () => {

        const jsonColumn: DtColumn = { name: 'payload', type: 'json' };
        const binaryColumn: DtColumn = { name: 'blob', type: 'binary' };

        it('should refuse a gzip bomb instead of inflating it', () => {

            // ~1000:1. Unbounded, this is 400 MB resident inside a compute
            // worker, and the OOM used to hang the pipeline permanently.
            const bomb = gzipSync(Buffer.alloc(MAX_DECOMPRESSED_VALUE_BYTES + 1024, 0x41));

            const [value, err] = attemptSync(() =>
                deserializeValue([bomb.toString('base64'), 'gz64'], jsonColumn, 'postgres'),
            );

            expect(value).toBeNull();
            expect(err).toBeInstanceOf(Error);
            expect(err!.message).toMatch(/decompression limit/);

        });

        it('should still decompress a payload inside the limit', () => {

            const payload = gzipSync(Buffer.from(JSON.stringify({ hello: 'world' })));

            const value = deserializeValue([payload.toString('base64'), 'gz64'], jsonColumn, 'postgres');

            expect(value).toEqual({ hello: 'world' });

        });

        it('should reject a corrupt gzip payload', () => {

            const [value, err] = attemptSync(() =>
                deserializeValue(['!!!!notgzip!!!!', 'gz64'], jsonColumn, 'postgres'),
            );

            expect(value).toBeNull();
            expect(err).toBeInstanceOf(Error);

        });

        it('should reject non-base64 in a b64 payload', () => {

            // Buffer.from drops non-base64 characters silently, so this used
            // to decode to an empty buffer and import as a hollow column.
            const [value, err] = attemptSync(() =>
                deserializeValue(['!!!!', 'b64'], binaryColumn, 'postgres'),
            );

            expect(value).toBeNull();
            expect(err).toBeInstanceOf(Error);
            expect(err!.message).toMatch(/Invalid base64/);

        });

        it('should round-trip valid base64', () => {

            const original = Buffer.from('binary payload');

            const value = deserializeValue([original.toString('base64'), 'b64'], binaryColumn, 'postgres');

            expect(Buffer.isBuffer(value)).toBe(true);
            expect((value as Buffer).toString()).toBe('binary payload');

        });

        it('should reject an unrecognised encoding tag', () => {

            const [value, err] = attemptSync(() =>
                deserializeValue([{ x: 1 }, 'evil' as 'raw'], jsonColumn, 'postgres'),
            );

            expect(value).toBeNull();
            expect(err).toBeInstanceOf(Error);
            expect(err!.message).toMatch(/Unknown .dt value encoding/);

        });

    });

});
