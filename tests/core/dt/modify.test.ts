import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import type { DtSchema } from '../../../src/core/dt/types.js';
import type { DtValue } from '../../../src/core/dt/types.js';

import {
    transformSchema,
    validateRecipe,
    buildRowProxy,
    modifyDtFile,
    type Recipe,
} from '../../../src/core/dt/modify.js';

import { DtWriter } from '../../../src/core/dt/writer.js';
import { DtReader } from '../../../src/core/dt/reader.js';

const TMP_DIR = path.join(process.cwd(), 'tmp');

describe('dt: modify', () => {

    let testDir: string;

    const schema: DtSchema = {
        v: 1,
        d: 'postgresql',
        dv: '17.7',
        t: 'users',
        columns: [
            { name: 'id', type: 'int', nullable: false },
            { name: 'username', type: 'string' },
            { name: 'email', type: 'string' },
            { name: 'created_at', type: 'timestamp' },
            { name: 'updated_at', type: 'timestamp' },
        ],
    };

    beforeEach(() => {

        const hex = randomBytes(4).toString('hex');
        testDir = path.join(TMP_DIR, `test-modify-${hex}`);
        mkdirSync(testDir, { recursive: true });

    });

    afterEach(() => {

        if (existsSync(testDir)) {

            rmSync(testDir, { recursive: true, force: true });

        }

    });

    describe('transformSchema', () => {

        it('should drop a column', () => {

            const recipe: Recipe = [{ op: 'drop', column: 'updated_at' }];
            const result = transformSchema(schema, recipe);

            expect(result.columns).toHaveLength(4);
            expect(result.columns.find(c => c.name === 'updated_at')).toBeUndefined();

        });

        it('should add a column', () => {

            const recipe: Recipe = [{
                op: 'add',
                column: 'role',
                type: 'string',
                default: { kind: 'literal', value: 'user' },
            }];
            const result = transformSchema(schema, recipe);

            expect(result.columns).toHaveLength(6);
            expect(result.columns[5]!.name).toBe('role');
            expect(result.columns[5]!.type).toBe('string');

        });

        it('should rename a column', () => {

            const recipe: Recipe = [{ op: 'rename', from: 'username', to: 'user_name' }];
            const result = transformSchema(schema, recipe);

            expect(result.columns[1]!.name).toBe('user_name');
            expect(result.columns).toHaveLength(5);

        });

        it('should apply operations incrementally', () => {

            const recipe: Recipe = [
                { op: 'rename', from: 'username', to: 'user_name' },
                { op: 'drop', column: 'updated_at' },
                { op: 'add', column: 'role', type: 'string', default: { kind: 'literal', value: 'user' } },
            ];
            const result = transformSchema(schema, recipe);

            const names = result.columns.map(c => c.name);
            expect(names).toEqual(['id', 'user_name', 'email', 'created_at', 'role']);

        });

        it('should preserve schema metadata (v, d, dv, t)', () => {

            const recipe: Recipe = [{ op: 'drop', column: 'email' }];
            const result = transformSchema(schema, recipe);

            expect(result.v).toBe(1);
            expect(result.d).toBe('postgresql');
            expect(result.dv).toBe('17.7');
            expect(result.t).toBe('users');

        });

        it('should alter column nullable to false', () => {

            const recipe: Recipe = [{ op: 'alter', column: 'email', nullable: false }];
            const result = transformSchema(schema, recipe);

            const emailCol = result.columns.find(c => c.name === 'email')!;
            expect(emailCol.nullable).toBe(false);

        });

        it('should alter column nullable to true', () => {

            const recipe: Recipe = [{ op: 'alter', column: 'id', nullable: true }];
            const result = transformSchema(schema, recipe);

            const idCol = result.columns.find(c => c.name === 'id')!;
            expect(idCol.nullable).toBe(true);

        });

        it('should ignore filter ops (no schema effect)', () => {

            const recipe: Recipe = [{ op: 'filter', predicate: 'row.id > 2' }];
            const result = transformSchema(schema, recipe);

            expect(result.columns).toHaveLength(5);

        });

    });

    describe('validateRecipe', () => {

        it('should reject dropping a nonexistent column', () => {

            const recipe: Recipe = [{ op: 'drop', column: 'nonexistent' }];
            const [, err] = validateRecipe(schema, recipe);

            expect(err).toBeTruthy();
            expect(err!.message).toContain('nonexistent');

        });

        it('should reject adding a duplicate column', () => {

            const recipe: Recipe = [{
                op: 'add',
                column: 'email',
                type: 'string',
                default: { kind: 'literal', value: '' },
            }];
            const [, err] = validateRecipe(schema, recipe);

            expect(err).toBeTruthy();
            expect(err!.message).toContain('email');

        });

        it('should reject renaming from nonexistent column', () => {

            const recipe: Recipe = [{ op: 'rename', from: 'nope', to: 'yep' }];
            const [, err] = validateRecipe(schema, recipe);

            expect(err).toBeTruthy();

        });

        it('should reject renaming to an existing column name', () => {

            const recipe: Recipe = [{ op: 'rename', from: 'username', to: 'email' }];
            const [, err] = validateRecipe(schema, recipe);

            expect(err).toBeTruthy();

        });

        it('should validate incrementally (rename then drop renamed)', () => {

            const recipe: Recipe = [
                { op: 'rename', from: 'username', to: 'user_name' },
                { op: 'drop', column: 'user_name' },
            ];
            const [result, err] = validateRecipe(schema, recipe);

            expect(err).toBeNull();
            expect(result).toBeTruthy();

        });

        it('should reject altering a nonexistent column', () => {

            const recipe: Recipe = [{ op: 'alter', column: 'nonexistent', nullable: false }];
            const [, err] = validateRecipe(schema, recipe);

            expect(err).toBeTruthy();
            expect(err!.message).toContain('nonexistent');

        });

        it('should accept altering an existing column', () => {

            const recipe: Recipe = [{ op: 'alter', column: 'email', nullable: false }];
            const [result, err] = validateRecipe(schema, recipe);

            expect(err).toBeNull();
            expect(result).toBeTruthy();

        });

        it('should reject invalid filter predicate syntax', () => {

            const recipe: Recipe = [{ op: 'filter', predicate: 'row.id >>' }];
            const [, err] = validateRecipe(schema, recipe);

            expect(err).toBeTruthy();

        });

        it('should accept valid filter predicate', () => {

            const recipe: Recipe = [{ op: 'filter', predicate: 'row.id > 2' }];
            const [result, err] = validateRecipe(schema, recipe);

            expect(err).toBeNull();
            expect(result).toBeTruthy();

        });

    });

    describe('buildRowProxy', () => {

        const columns = [
            { name: 'id', type: 'int' as const },
            { name: 'username', type: 'string' as const },
            { name: 'email', type: 'string' as const },
        ];

        it('should support named access', () => {

            const proxy = buildRowProxy(columns, [1, 'alice', 'alice@test.com']);

            expect(proxy.id).toBe(1);
            expect(proxy.username).toBe('alice');
            expect(proxy.email).toBe('alice@test.com');

        });

        it('should support positional access', () => {

            const proxy = buildRowProxy(columns, [1, 'alice', 'alice@test.com']);

            expect(proxy[0]).toBe(1);
            expect(proxy[1]).toBe('alice');
            expect(proxy[2]).toBe('alice@test.com');

        });

        it('should return undefined for nonexistent properties', () => {

            const proxy = buildRowProxy(columns, [1, 'alice', 'alice@test.com']);

            expect(proxy.nonexistent).toBeUndefined();
            expect(proxy[99]).toBeUndefined();

        });

    });

    describe('modifyDtFile', () => {

        async function writeFixture(): Promise<string> {

            const filepath = path.join(testDir, 'source.dt');
            const writer = new DtWriter({ filepath, schema });
            await writer.open();
            writer.writeRow([1, 'alice', 'alice@test.com', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z']);
            writer.writeRow([2, 'bob', 'bob@test.com', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z']);
            writer.writeRow([3, 'carol', 'carol@test.com', '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z']);
            await writer.close();

            return filepath;

        }

        it('should drop a column from rows', async () => {

            const inputPath = await writeFixture();
            const outputPath = path.join(testDir, 'output.dt');
            const recipe: Recipe = [{ op: 'drop', column: 'updated_at' }];

            const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

            expect(err).toBeNull();
            expect(result!.rowsWritten).toBe(3);
            expect(result!.columnsDropped).toBe(1);

            const reader = new DtReader({ filepath: outputPath });
            await reader.open();
            expect(reader.schema!.columns).toHaveLength(4);
            expect(reader.schema!.columns.find(c => c.name === 'updated_at')).toBeUndefined();

            const rows: DtValue[][] = [];
            for await (const row of reader.rows()) rows.push(row);
            reader.close();

            expect(rows).toHaveLength(3);
            expect(rows[0]).toHaveLength(4);

        });

        it('should add a column with literal default', async () => {

            const inputPath = await writeFixture();
            const outputPath = path.join(testDir, 'output.dt');
            const recipe: Recipe = [{
                op: 'add',
                column: 'role',
                type: 'string',
                default: { kind: 'literal', value: 'user' },
            }];

            const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

            expect(err).toBeNull();
            expect(result!.columnsAdded).toBe(1);

            const reader = new DtReader({ filepath: outputPath });
            await reader.open();
            expect(reader.schema!.columns).toHaveLength(6);

            const rows: DtValue[][] = [];
            for await (const row of reader.rows()) rows.push(row);
            reader.close();

            for (const row of rows) {

                expect(row[5]).toBe('user');

            }

        });

        it('should add a column with NOW() expression', async () => {

            const inputPath = await writeFixture();
            const outputPath = path.join(testDir, 'output.dt');
            const recipe: Recipe = [{
                op: 'add',
                column: 'processed_at',
                type: 'timestamp',
                default: { kind: 'expression', fn: 'NOW' },
            }];

            const [_result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

            expect(err).toBeNull();

            const reader = new DtReader({ filepath: outputPath });
            await reader.open();
            const rows: DtValue[][] = [];
            for await (const row of reader.rows()) rows.push(row);
            reader.close();

            // All rows should have the same timestamp (NOW computed once)
            const ts = rows[0]![5] as string;
            expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);

            for (const row of rows) {

                expect(row[5]).toBe(ts);

            }

        });

        it('should add a column with UUID() expression (unique per row)', async () => {

            const inputPath = await writeFixture();
            const outputPath = path.join(testDir, 'output.dt');
            const recipe: Recipe = [{
                op: 'add',
                column: 'trace_id',
                type: 'uuid',
                default: { kind: 'expression', fn: 'UUID' },
            }];

            const [_result2, err] = await modifyDtFile({ inputPath, outputPath, recipe });

            expect(err).toBeNull();

            const reader = new DtReader({ filepath: outputPath });
            await reader.open();
            const rows: DtValue[][] = [];
            for await (const row of reader.rows()) rows.push(row);
            reader.close();

            const uuids = rows.map(r => r[5] as string);
            expect(new Set(uuids).size).toBe(3);

        });

        it('should rename a column', async () => {

            const inputPath = await writeFixture();
            const outputPath = path.join(testDir, 'output.dt');
            const recipe: Recipe = [{ op: 'rename', from: 'username', to: 'user_name' }];

            const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

            expect(err).toBeNull();
            expect(result!.columnsRenamed).toBe(1);

            const reader = new DtReader({ filepath: outputPath });
            await reader.open();
            expect(reader.schema!.columns[1]!.name).toBe('user_name');

            const rows: DtValue[][] = [];
            for await (const row of reader.rows()) rows.push(row);
            reader.close();

            expect(rows[0]![1]).toBe('alice');
            expect(rows).toHaveLength(3);

        });

        it('should alter column nullable in output schema', async () => {

            const inputPath = await writeFixture();
            const outputPath = path.join(testDir, 'output.dt');
            const recipe: Recipe = [
                { op: 'alter', column: 'email', nullable: false },
                { op: 'alter', column: 'id', nullable: true },
            ];

            const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

            expect(err).toBeNull();
            expect(result!.rowsWritten).toBe(3);

            const reader = new DtReader({ filepath: outputPath });
            await reader.open();

            const emailCol = reader.schema!.columns.find(c => c.name === 'email')!;
            expect(emailCol.nullable).toBe(false);

            const idCol = reader.schema!.columns.find(c => c.name === 'id')!;
            expect(idCol.nullable).toBe(true);

            // Row values unchanged
            const rows: DtValue[][] = [];
            for await (const row of reader.rows()) rows.push(row);
            reader.close();

            expect(rows).toHaveLength(3);
            expect(rows[0]![2]).toBe('alice@test.com');

        });

        it('should coerce nulls to type zero values when setting not-null', async () => {

            // Write a fixture with null values
            const nullSchema: DtSchema = {
                v: 1,
                d: 'postgresql',
                dv: '17.7',
                t: 'items',
                columns: [
                    { name: 'id', type: 'int', nullable: false },
                    { name: 'name', type: 'string' },
                    { name: 'count', type: 'int' },
                    { name: 'active', type: 'bool' },
                    { name: 'notes', type: 'text' },
                ],
            };

            const filepath = path.join(testDir, 'nulls.dt');
            const writer = new DtWriter({ filepath, schema: nullSchema });
            await writer.open();
            writer.writeRow([1, 'alice', 5, true, ['some notes', 'raw']]);
            writer.writeRow([2, null, null, null, null]);
            writer.writeRow([3, 'carol', null, false, null]);
            await writer.close();

            const outputPath = path.join(testDir, 'output.dt');
            const recipe: Recipe = [
                { op: 'alter', column: 'name', nullable: false },
                { op: 'alter', column: 'count', nullable: false },
                { op: 'alter', column: 'active', nullable: false },
                { op: 'alter', column: 'notes', nullable: false },
            ];

            const [result, err] = await modifyDtFile({ inputPath: filepath, outputPath, recipe });

            expect(err).toBeNull();
            expect(result!.rowsWritten).toBe(3);

            const reader = new DtReader({ filepath: outputPath });
            await reader.open();

            const rows: DtValue[][] = [];
            for await (const row of reader.rows()) rows.push(row);
            reader.close();

            // Row 0: no nulls originally, should be unchanged
            expect(rows[0]![1]).toBe('alice');
            expect(rows[0]![2]).toBe(5);
            expect(rows[0]![3]).toBe(true);

            // Row 1: all nulls should be coerced to zero values
            expect(rows[1]![1]).toBe('');        // string → ''
            expect(rows[1]![2]).toBe(0);         // int → 0
            expect(rows[1]![3]).toBe(false);     // bool → false

            // Row 2: partial nulls coerced
            expect(rows[2]![1]).toBe('carol');   // not null, unchanged
            expect(rows[2]![2]).toBe(0);         // null int → 0
            expect(rows[2]![3]).toBe(false);     // not null, unchanged

        });

        it('should filter rows with predicate (named access)', async () => {

            const inputPath = await writeFixture();
            const outputPath = path.join(testDir, 'output.dt');
            const recipe: Recipe = [{ op: 'filter', predicate: 'row.id > 1' }];

            const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

            expect(err).toBeNull();
            expect(result!.rowsRead).toBe(3);
            expect(result!.rowsWritten).toBe(2);
            expect(result!.rowsFiltered).toBe(1);

        });

        it('should filter rows with predicate (positional access)', async () => {

            const inputPath = await writeFixture();
            const outputPath = path.join(testDir, 'output.dt');
            const recipe: Recipe = [{ op: 'filter', predicate: 'row[0] > 1' }];

            const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

            expect(err).toBeNull();
            expect(result!.rowsWritten).toBe(2);

        });

        it('should apply multiple operations in sequence', async () => {

            const inputPath = await writeFixture();
            const outputPath = path.join(testDir, 'output.dt');
            const recipe: Recipe = [
                { op: 'rename', from: 'username', to: 'user_name' },
                { op: 'drop', column: 'updated_at' },
                { op: 'add', column: 'role', type: 'string', default: { kind: 'literal', value: 'admin' } },
                { op: 'filter', predicate: 'row.id <= 2' },
            ];

            const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

            expect(err).toBeNull();
            expect(result!.rowsWritten).toBe(2);
            expect(result!.rowsFiltered).toBe(1);
            expect(result!.columnsDropped).toBe(1);
            expect(result!.columnsAdded).toBe(1);
            expect(result!.columnsRenamed).toBe(1);

            const reader = new DtReader({ filepath: outputPath });
            await reader.open();
            const names = reader.schema!.columns.map(c => c.name);
            expect(names).toEqual(['id', 'user_name', 'email', 'created_at', 'role']);

            const rows: DtValue[][] = [];
            for await (const row of reader.rows()) rows.push(row);
            reader.close();

            expect(rows).toHaveLength(2);
            expect(rows[0]![4]).toBe('admin');

        });

        it('should overwrite input file in place without corruption', async () => {

            const inputPath = await writeFixture();
            const recipe: Recipe = [{ op: 'drop', column: 'updated_at' }];

            // outputPath === inputPath — this used to crash
            const [result, err] = await modifyDtFile({ inputPath, outputPath: inputPath, recipe });

            expect(err).toBeNull();
            expect(result!.rowsWritten).toBe(3);
            expect(result!.columnsDropped).toBe(1);

            // Read back the overwritten file
            const reader = new DtReader({ filepath: inputPath });
            await reader.open();
            expect(reader.schema!.columns).toHaveLength(4);
            expect(reader.schema!.columns.find(c => c.name === 'updated_at')).toBeUndefined();

            const rows: DtValue[][] = [];
            for await (const row of reader.rows()) rows.push(row);
            reader.close();

            expect(rows).toHaveLength(3);
            expect(rows[0]).toHaveLength(4);
            expect(rows[0]![0]).toBe(1);
            expect(rows[0]![1]).toBe('alice');

        });

        it('should produce a clean copy with empty recipe', async () => {

            const inputPath = await writeFixture();
            const outputPath = path.join(testDir, 'output.dt');
            const recipe: Recipe = [];

            const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

            expect(err).toBeNull();
            expect(result!.rowsRead).toBe(3);
            expect(result!.rowsWritten).toBe(3);
            expect(result!.rowsFiltered).toBe(0);

            const reader = new DtReader({ filepath: outputPath });
            await reader.open();
            expect(reader.schema!.columns).toHaveLength(5);

            const rows: DtValue[][] = [];
            for await (const row of reader.rows()) rows.push(row);
            reader.close();

            expect(rows).toHaveLength(3);
            expect(rows[0]).toHaveLength(5);

        });

        it('should filter using renamed column name (post-transform access)', async () => {

            const inputPath = await writeFixture();
            const outputPath = path.join(testDir, 'output.dt');
            const recipe: Recipe = [
                { op: 'rename', from: 'username', to: 'user_name' },
                { op: 'filter', predicate: 'row.user_name === "alice"' },
            ];

            const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

            expect(err).toBeNull();
            expect(result!.rowsWritten).toBe(1);
            expect(result!.rowsFiltered).toBe(2);

            const reader = new DtReader({ filepath: outputPath });
            await reader.open();
            expect(reader.schema!.columns[1]!.name).toBe('user_name');

            const rows: DtValue[][] = [];
            for await (const row of reader.rows()) rows.push(row);
            reader.close();

            expect(rows[0]![1]).toBe('alice');

        });

        it('should return error for invalid recipe', async () => {

            const inputPath = await writeFixture();
            const outputPath = path.join(testDir, 'output.dt');
            const recipe: Recipe = [{ op: 'drop', column: 'nonexistent' }];

            const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

            expect(result).toBeNull();
            expect(err).toBeTruthy();

        });

        it('should preserve schema metadata', async () => {

            const inputPath = await writeFixture();
            const outputPath = path.join(testDir, 'output.dt');
            const recipe: Recipe = [{ op: 'drop', column: 'email' }];

            await modifyDtFile({ inputPath, outputPath, recipe });

            const reader = new DtReader({ filepath: outputPath });
            await reader.open();
            expect(reader.schema!.v).toBe(1);
            expect(reader.schema!.d).toBe('postgresql');
            expect(reader.schema!.dv).toBe('17.7');
            expect(reader.schema!.t).toBe('users');
            reader.close();

        });

        it('should produce valid .dtz output when output path is compressed', async () => {

            const inputPath = await writeFixture();
            const outputPath = path.join(testDir, 'output.dtz');
            const recipe: Recipe = [{ op: 'drop', column: 'updated_at' }];

            const [result, err] = await modifyDtFile({ inputPath, outputPath, recipe });

            expect(err).toBeNull();
            expect(result!.rowsWritten).toBe(3);

            // Read back as .dtz — DtReader must be able to gunzip it
            const reader = new DtReader({ filepath: outputPath });
            await reader.open();
            expect(reader.schema!.columns).toHaveLength(4);

            const rows: DtValue[][] = [];
            for await (const row of reader.rows()) rows.push(row);
            reader.close();

            expect(rows).toHaveLength(3);
            expect(rows[0]![0]).toBe(1);

        });

        it('should produce valid .dtz when overwriting a .dtz input in place', async () => {

            // Write a .dtz fixture
            const dtzPath = path.join(testDir, 'source.dtz');
            const writer = new DtWriter({ filepath: dtzPath, schema });
            await writer.open();
            writer.writeRow([1, 'alice', 'alice@test.com', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z']);
            writer.writeRow([2, 'bob', 'bob@test.com', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z']);
            await writer.close();

            const recipe: Recipe = [{ op: 'drop', column: 'email' }];

            const [result, err] = await modifyDtFile({ inputPath: dtzPath, outputPath: dtzPath, recipe });

            expect(err).toBeNull();
            expect(result!.rowsWritten).toBe(2);

            // Read back — must be valid gzip
            const reader = new DtReader({ filepath: dtzPath });
            await reader.open();
            expect(reader.schema!.columns).toHaveLength(4);

            const rows: DtValue[][] = [];
            for await (const row of reader.rows()) rows.push(row);
            reader.close();

            expect(rows).toHaveLength(2);

        });

    });

    describe('integration: real .dt file', () => {

        const exampleFile = path.join(process.cwd(), 'examples/todo-db/export/user.dt');

        it('should modify a real exported .dt file with a complex recipe', async () => {

            const outputPath = path.join(testDir, 'user_modified.dt');

            const recipe: Recipe = [
                { op: 'drop', column: 'updated_at' },
                { op: 'rename', from: 'username', to: 'user_name' },
                { op: 'add', column: 'role', type: 'string', default: { kind: 'literal', value: 'member' } },
                { op: 'filter', predicate: 'row.id <= 3' },
            ];

            const [result, err] = await modifyDtFile({ inputPath: exampleFile, outputPath, recipe });

            expect(err).toBeNull();
            expect(result).toBeTruthy();

            // Verify result counters
            expect(result!.rowsRead).toBe(5);
            expect(result!.rowsWritten).toBe(3);
            expect(result!.rowsFiltered).toBe(2);
            expect(result!.columnsDropped).toBe(1);
            expect(result!.columnsAdded).toBe(1);
            expect(result!.columnsRenamed).toBe(1);
            expect(result!.outputPath).toBe(outputPath);
            expect(result!.durationMs).toBeGreaterThanOrEqual(0);

            // Read output back and verify schema
            const reader = new DtReader({ filepath: outputPath });
            await reader.open();

            const outSchema = reader.schema!;
            expect(outSchema.v).toBe(1);
            expect(outSchema.d).toBe('postgresql');
            expect(outSchema.dv).toBe('17.7');
            expect(outSchema.t).toBe('user');

            const colNames = outSchema.columns.map(c => c.name);
            expect(colNames).toEqual(['id', 'user_name', 'email', 'created_at', 'role']);

            // updated_at should be gone
            expect(outSchema.columns.find(c => c.name === 'updated_at')).toBeUndefined();

            // user_name should have the original sourceType from username
            const userNameCol = outSchema.columns.find(c => c.name === 'user_name')!;
            expect(userNameCol.type).toBe('string');

            // role should be the added column
            const roleCol = outSchema.columns.find(c => c.name === 'role')!;
            expect(roleCol.type).toBe('string');
            expect(roleCol.nullable).toBe(true);

            // Verify row data
            const rows: DtValue[][] = [];
            for await (const row of reader.rows()) rows.push(row);
            reader.close();

            expect(rows).toHaveLength(3);

            // Row 0: id=1, user_name='alice_chen', email='alice@example.com', created_at=timestamp, role='member'
            expect(rows[0]![0]).toBe(1);
            expect(rows[0]![1]).toBe('alice_chen');
            expect(rows[0]![2]).toBe('alice@example.com');
            expect(rows[0]![3]).toBe('2026-02-03T07:23:41.916Z');
            expect(rows[0]![4]).toBe('member');

            // Row 1: id=2, user_name='bob_martinez'
            expect(rows[1]![0]).toBe(2);
            expect(rows[1]![1]).toBe('bob_martinez');
            expect(rows[1]![4]).toBe('member');

            // Row 2: id=3, user_name='carol_williams'
            expect(rows[2]![0]).toBe(3);
            expect(rows[2]![1]).toBe('carol_williams');
            expect(rows[2]![4]).toBe('member');

            // Rows with id=4 (david) and id=5 (eva) should have been filtered out
            // Each row should have exactly 5 values (id, user_name, email, created_at, role)
            for (const row of rows) {

                expect(row).toHaveLength(5);

            }

        });

        it('should filter with post-rename column access on real file', async () => {

            const outputPath = path.join(testDir, 'user_filtered.dt');

            const recipe: Recipe = [
                { op: 'rename', from: 'email', to: 'contact_email' },
                { op: 'filter', predicate: 'row.contact_email.includes("bob")' },
            ];

            const [result, err] = await modifyDtFile({ inputPath: exampleFile, outputPath, recipe });

            expect(err).toBeNull();
            expect(result!.rowsWritten).toBe(1);
            expect(result!.rowsFiltered).toBe(4);

            const reader = new DtReader({ filepath: outputPath });
            await reader.open();

            expect(reader.schema!.columns[2]!.name).toBe('contact_email');

            const rows: DtValue[][] = [];
            for await (const row of reader.rows()) rows.push(row);
            reader.close();

            expect(rows).toHaveLength(1);
            expect(rows[0]![1]).toBe('bob_martinez');
            expect(rows[0]![2]).toBe('bob@example.com');

        });

        it('should handle compressed .dtz files', async () => {

            const dtzFile = path.join(process.cwd(), 'examples/todo-db/export/user.dtz');

            if (!existsSync(dtzFile)) return; // skip if .dtz not available

            const outputPath = path.join(testDir, 'user_from_dtz.dt');

            const recipe: Recipe = [
                { op: 'drop', column: 'created_at' },
                { op: 'drop', column: 'updated_at' },
            ];

            const [result, err] = await modifyDtFile({ inputPath: dtzFile, outputPath, recipe });

            expect(err).toBeNull();
            expect(result!.rowsWritten).toBe(5);
            expect(result!.columnsDropped).toBe(2);

            const reader = new DtReader({ filepath: outputPath });
            await reader.open();

            const colNames = reader.schema!.columns.map(c => c.name);
            expect(colNames).toEqual(['id', 'username', 'email']);

            const rows: DtValue[][] = [];
            for await (const row of reader.rows()) rows.push(row);
            reader.close();

            expect(rows).toHaveLength(5);
            expect(rows[0]).toHaveLength(3);

        });

    });

});
