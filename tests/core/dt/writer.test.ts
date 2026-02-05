/**
 * DtWriter tests.
 *
 * Covers .dt raw output, .dtz gzip, .dtzx encrypted, JSON5 format.
 * Writer/reader tests write to tmp/ per project rules.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import JSON5 from 'json5';
import { gunzipSync } from 'node:zlib';

import { DtWriter } from '../../../src/core/dt/writer.js';
import type { DtSchema } from '../../../src/core/dt/types.js';

const TMP_DIR = path.join(process.cwd(), 'tmp');

describe('dt: writer', () => {

    let testDir: string;

    const schema: DtSchema = {
        v: 1,
        d: 'postgresql',
        dv: '16.2',
        t: 'users',
        columns: [
            { name: 'id', type: 'int' },
            { name: 'name', type: 'string' },
        ],
    };

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
    // .dt raw output
    // -----------------------------------------------------------------------

    describe('.dt raw output', () => {

        it('should write schema header on line 1', async () => {

            const filepath = path.join(testDir, 'test.dt');
            const writer = new DtWriter({ filepath, schema });

            await writer.open();
            await writer.close();

            const content = readFileSync(filepath, 'utf8');
            const lines = content.trim().split('\n');
            const parsed = JSON5.parse(lines[0]!);

            expect(parsed.v).toBe(1);
            expect(parsed.d).toBe('postgresql');
            expect(parsed.columns).toHaveLength(2);

        });

        it('should write rows as JSON5 lines', async () => {

            const filepath = path.join(testDir, 'test.dt');
            const writer = new DtWriter({ filepath, schema });

            await writer.open();
            writer.writeRow([1, 'alice']);
            writer.writeRow([2, 'bob']);
            await writer.close();

            const content = readFileSync(filepath, 'utf8');
            const lines = content.trim().split('\n');

            expect(lines).toHaveLength(3); // schema + 2 rows
            expect(JSON5.parse(lines[1]!)).toEqual([1, 'alice']);
            expect(JSON5.parse(lines[2]!)).toEqual([2, 'bob']);

        });

        it('should track rowsWritten', async () => {

            const filepath = path.join(testDir, 'test.dt');
            const writer = new DtWriter({ filepath, schema });

            await writer.open();
            writer.writeRow([1, 'alice']);
            writer.writeRow([2, 'bob']);
            await writer.close();

            expect(writer.rowsWritten).toBe(2);

        });

        it('should track bytesWritten', async () => {

            const filepath = path.join(testDir, 'test.dt');
            const writer = new DtWriter({ filepath, schema });

            await writer.open();
            writer.writeRow([1, 'alice']);
            await writer.close();

            expect(writer.bytesWritten).toBeGreaterThan(0);

        });

        it('should write multiple rows via writeRows', async () => {

            const filepath = path.join(testDir, 'test.dt');
            const writer = new DtWriter({ filepath, schema });

            await writer.open();
            writer.writeRows([[1, 'alice'], [2, 'bob'], [3, 'charlie']]);
            await writer.close();

            expect(writer.rowsWritten).toBe(3);

        });

    });

    // -----------------------------------------------------------------------
    // .dtz compressed output
    // -----------------------------------------------------------------------

    describe('.dtz compressed output', () => {

        it('should write a valid gzip file', async () => {

            const filepath = path.join(testDir, 'test.dtz');
            const writer = new DtWriter({ filepath, schema });

            await writer.open();
            writer.writeRow([1, 'alice']);
            writer.writeRow([2, 'bob']);
            await writer.close();

            expect(existsSync(filepath)).toBe(true);

            // Decompress and verify content
            const compressed = readFileSync(filepath);
            const decompressed = gunzipSync(compressed).toString('utf8');
            const lines = decompressed.trim().split('\n');

            expect(lines).toHaveLength(3);
            expect(JSON5.parse(lines[0]!).v).toBe(1);
            expect(JSON5.parse(lines[1]!)).toEqual([1, 'alice']);

        });

    });

    // -----------------------------------------------------------------------
    // .dtzx encrypted output
    // -----------------------------------------------------------------------

    describe('.dtzx encrypted output', () => {

        it('should require passphrase', async () => {

            const filepath = path.join(testDir, 'test.dtzx');
            const writer = new DtWriter({ filepath, schema });

            await expect(writer.open()).rejects.toThrow('Passphrase required');

        });

        it('should write an encrypted payload', async () => {

            const filepath = path.join(testDir, 'test.dtzx');
            const writer = new DtWriter({ filepath, schema, passphrase: 'secret' });

            await writer.open();
            writer.writeRow([1, 'alice']);
            writer.writeRow([2, 'bob']);
            await writer.close();

            expect(existsSync(filepath)).toBe(true);

            // Should be valid JSON with encryption fields
            const content = readFileSync(filepath, 'utf8');
            const payload = JSON.parse(content);

            expect(payload.salt).toBeTruthy();
            expect(payload.iv).toBeTruthy();
            expect(payload.authTag).toBeTruthy();
            expect(payload.ciphertext).toBeTruthy();

        });

        it('should track bytesWritten', async () => {

            const filepath = path.join(testDir, 'test.dtzx');
            const writer = new DtWriter({ filepath, schema, passphrase: 'secret' });

            await writer.open();
            writer.writeRow([1, 'alice']);
            await writer.close();

            expect(writer.bytesWritten).toBeGreaterThan(0);

        });

    });

});
