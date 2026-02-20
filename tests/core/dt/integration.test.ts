/**
 * Integration tests for the .dt pipeline.
 *
 * Exercises the full serialize → write → read → deserialize pipeline
 * with realistic scenarios that validate the text encoded type,
 * cross-dialect transfers, and MSSQL nvarchar(max) classification.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import JSON5 from 'json5';

import { serializeRow } from '../../../src/core/dt/serialize.js';
import { deserializeRow } from '../../../src/core/dt/deserialize.js';
import { DtWriter } from '../../../src/core/dt/writer.js';
import { DtReader } from '../../../src/core/dt/reader.js';
import { DtStreamer } from '../../../src/core/dt/streamer.js';
import { toUniversalType, toDialectType, isEncodedType } from '../../../src/core/dt/type-map.js';
import type { DtSchema, DtColumn, DtValue, EncodedValue, DatabaseVersion } from '../../../src/core/dt/types.js';
import type { Dialect } from '../../../src/core/connection/types.js';

const TMP_DIR = path.join(process.cwd(), 'tmp');

describe('dt: integration', () => {

    let testDir: string;

    beforeEach(() => {

        const hex = randomBytes(4).toString('hex');
        testDir = path.join(TMP_DIR, `test-integration-${hex}`);
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
        schema: DtSchema,
        rows: Record<string, unknown>[],
        ext: string,
        targetDialect: Dialect,
        targetVersion?: DatabaseVersion,
        passphrase?: string,
    ): Promise<Record<string, unknown>[]> {

        const { columns } = schema;

        // Serialize
        const serializedRows = rows.map((row) => serializeRow({ row, columns }));

        // Write
        const filepath = path.join(testDir, `integration${ext}`);
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
                targetDialect,
                targetVersion,
            }));

        }

        reader.close();

        return readRows;

    }

    /**
     * Write a .dt file and return raw file content for inspection.
     */
    async function writeAndInspect(
        schema: DtSchema,
        rows: Record<string, unknown>[],
    ): Promise<{ lines: string[]; schemaLine: DtSchema; dataLines: DtValue[][] }> {

        const { columns } = schema;
        const serializedRows = rows.map((row) => serializeRow({ row, columns }));
        const filepath = path.join(testDir, 'inspect.dt');

        const writer = new DtWriter({ filepath, schema });
        await writer.open();

        for (const values of serializedRows) {

            writer.writeRow(values);

        }

        await writer.close();

        const content = readFileSync(filepath, 'utf8');
        const lines = content.trim().split('\n');
        const schemaLine = JSON5.parse(lines[0]!) as DtSchema;
        const dataLines = lines.slice(1).map((line) => JSON5.parse(line) as DtValue[]);

        return { lines, schemaLine, dataLines };

    }

    // -----------------------------------------------------------------------
    // MSSQL nvarchar(max) / varchar(max) classification
    // -----------------------------------------------------------------------

    describe('MSSQL nvarchar(max) and varchar(max) classification', () => {

        it('should classify nvarchar(max) as text encoded type', () => {

            const result = toUniversalType({ dbType: 'nvarchar(max)', dialect: 'mssql' });

            expect(result.universalType).toBe('text');
            expect(result.native).toBe(true);
            expect(isEncodedType('text')).toBe(true);

        });

        it('should classify varchar(max) as text encoded type', () => {

            const result = toUniversalType({ dbType: 'varchar(max)', dialect: 'mssql' });

            expect(result.universalType).toBe('text');
            expect(result.native).toBe(true);

        });

        it('should classify regular nvarchar as string simple type', () => {

            const result = toUniversalType({ dbType: 'nvarchar(255)', dialect: 'mssql' });

            expect(result.universalType).toBe('string');
            expect(isEncodedType('string')).toBe(false);

        });

        it('should classify regular varchar as string simple type', () => {

            const result = toUniversalType({ dbType: 'varchar(100)', dialect: 'mssql' });

            expect(result.universalType).toBe('string');

        });

        it('should map text back to nvarchar(max) for MSSQL target', () => {

            const result = toDialectType({ universalType: 'text', dialect: 'mssql' });

            expect(result).toBe('nvarchar(max)');

        });

    });

    // -----------------------------------------------------------------------
    // File content verification
    // -----------------------------------------------------------------------

    describe('file content verification', () => {

        it('should write text columns as encoding tuples in .dt file', async () => {

            const schema: DtSchema = {
                v: 1,
                d: 'postgresql',
                dv: '16.2',
                t: 'articles',
                columns: [
                    { name: 'id', type: 'int' },
                    { name: 'title', type: 'string' },
                    { name: 'content', type: 'text' },
                ],
            };

            const rows = [{ id: 1, title: 'Hello', content: 'Short article body' }];
            const { dataLines, schemaLine } = await writeAndInspect(schema, rows);

            // Schema should declare content as text
            const contentCol = schemaLine.columns.find((c) => c.name === 'content');
            expect(contentCol!.type).toBe('text');

            // Data row should have encoding tuple for text column
            const row = dataLines[0]!;
            expect(row[0]).toBe(1);
            expect(row[1]).toBe('Hello');

            // text column: encoding tuple [value, encoding]
            const textValue = row[2] as EncodedValue;
            expect(Array.isArray(textValue)).toBe(true);
            expect(textValue[0]).toBe('Short article body');
            expect(textValue[1]).toBe('raw');

        });

        it('should compress large text content as gz64 in .dt file', async () => {

            const schema: DtSchema = {
                v: 1,
                d: 'postgresql',
                dv: '16.2',
                t: 'articles',
                columns: [
                    { name: 'id', type: 'int' },
                    { name: 'content', type: 'text' },
                ],
            };

            const largeContent = 'The quick brown fox jumps over the lazy dog. '.repeat(100);
            const rows = [{ id: 1, content: largeContent }];
            const { dataLines } = await writeAndInspect(schema, rows);

            const row = dataLines[0]!;
            const textValue = row[1] as EncodedValue;

            expect(Array.isArray(textValue)).toBe(true);
            expect(textValue[1]).toBe('gz64');
            expect(typeof textValue[0]).toBe('string');

        });

        it('should write string columns as plain values (no tuple)', async () => {

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

            const rows = [{ id: 1, name: 'alice' }];
            const { dataLines } = await writeAndInspect(schema, rows);

            const row = dataLines[0]!;
            expect(row[0]).toBe(1);
            expect(row[1]).toBe('alice');
            expect(Array.isArray(row[1])).toBe(false);

        });

        it('should write json columns as encoding tuples', async () => {

            const schema: DtSchema = {
                v: 1,
                d: 'postgresql',
                dv: '16.2',
                t: 'docs',
                columns: [
                    { name: 'id', type: 'int' },
                    { name: 'metadata', type: 'json' },
                ],
            };

            const rows = [{ id: 1, metadata: { title: 'Doc', tags: ['a', 'b'] } }];
            const { dataLines } = await writeAndInspect(schema, rows);

            const row = dataLines[0]!;
            const jsonValue = row[1] as EncodedValue;

            expect(Array.isArray(jsonValue)).toBe(true);
            expect(jsonValue[0]).toEqual({ title: 'Doc', tags: ['a', 'b'] });
            expect(jsonValue[1]).toBe('raw');

        });

    });

    // -----------------------------------------------------------------------
    // Full pipeline: serialize → write → read → deserialize
    // -----------------------------------------------------------------------

    describe('full pipeline with text type', () => {

        it('should roundtrip a table with TEXT column from PostgreSQL', async () => {

            const schema: DtSchema = {
                v: 1,
                d: 'postgresql',
                dv: '16.2',
                t: 'articles',
                columns: [
                    { name: 'id', type: 'int' },
                    { name: 'title', type: 'string' },
                    { name: 'Content', type: 'text' },
                    { name: 'metadata', type: 'json' },
                ],
            };

            const largeContent = 'This is article body content that is fairly long. '.repeat(80);

            const rows = [{
                id: 1,
                title: 'Test Article',
                Content: largeContent,
                metadata: { author: 'alice', tags: ['tech', 'db'] },
            }];

            const result = await roundTrip(schema, rows, '.dt', 'postgres');

            expect(result).toHaveLength(1);
            expect(result[0]!.id).toBe(1);
            expect(result[0]!.title).toBe('Test Article');
            expect(result[0]!.Content).toBe(largeContent);
            expect(result[0]!.metadata).toEqual({ author: 'alice', tags: ['tech', 'db'] });

        });

        it('should roundtrip a table with TEXT column through .dtz compression', async () => {

            const schema: DtSchema = {
                v: 1,
                d: 'postgresql',
                dv: '16.2',
                t: 'articles',
                columns: [
                    { name: 'id', type: 'int' },
                    { name: 'body', type: 'text' },
                ],
            };

            const largeText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(200);

            const rows = [
                { id: 1, body: largeText },
                { id: 2, body: 'Short body' },
                { id: 3, body: null },
            ];

            const result = await roundTrip(schema, rows, '.dtz', 'postgres');

            expect(result).toHaveLength(3);
            expect(result[0]!.body).toBe(largeText);
            expect(result[1]!.body).toBe('Short body');
            expect(result[2]!.body).toBe(null);

        });

        it('should roundtrip a table with TEXT column through .dtzx encryption', async () => {

            const schema: DtSchema = {
                v: 1,
                d: 'postgresql',
                dv: '16.2',
                t: 'articles',
                columns: [
                    { name: 'id', type: 'int' },
                    { name: 'Content', type: 'text' },
                ],
            };

            const content = 'Sensitive article content. '.repeat(50);

            const rows = [{ id: 1, Content: content }];
            const result = await roundTrip(schema, rows, '.dtzx', 'postgres', undefined, 'my-secret');

            expect(result).toHaveLength(1);
            expect(result[0]!.Content).toBe(content);

        });

        it('should roundtrip text with special characters through the full pipeline', async () => {

            const schema: DtSchema = {
                v: 1,
                d: 'postgresql',
                dv: '16.2',
                t: 'articles',
                columns: [
                    { name: 'id', type: 'int' },
                    { name: 'content', type: 'text' },
                ],
            };

            const specialText = [
                'Line 1\nLine 2\nLine 3',
                '\t\tTabbed content\t\t',
                '"Double quoted" and \'single quoted\'',
                'Unicode: \u{1F600}\u{1F4BB}\u{2764}',
                'Backslashes: C:\\Users\\test\\file.txt',
                'Null byte: before\u0000after',
            ];

            const rows = specialText.map((text, i) => ({ id: i + 1, content: text }));
            const result = await roundTrip(schema, rows, '.dt', 'postgres');

            expect(result).toHaveLength(specialText.length);

            for (let i = 0; i < specialText.length; i++) {

                expect(result[i]!.content).toBe(specialText[i]);

            }

        });

    });

    // -----------------------------------------------------------------------
    // Cross-dialect transfers with text type
    // -----------------------------------------------------------------------

    describe('cross-dialect transfers', () => {

        it('should transfer text from PostgreSQL to MySQL through file', async () => {

            const schema: DtSchema = {
                v: 1,
                d: 'postgresql',
                dv: '16.2',
                t: 'articles',
                columns: [
                    { name: 'id', type: 'int' },
                    { name: 'content', type: 'text' },
                    { name: 'metadata', type: 'json' },
                ],
            };

            const content = 'Long article content for MySQL transfer. '.repeat(60);

            const rows = [{
                id: 1,
                content,
                metadata: { version: 2 },
            }];

            const result = await roundTrip(schema, rows, '.dt', 'mysql');

            expect(result[0]!.content).toBe(content);
            expect(result[0]!.metadata).toEqual({ version: 2 });

        });

        it('should transfer text from PostgreSQL to MSSQL < 2025 through file', async () => {

            const schema: DtSchema = {
                v: 1,
                d: 'postgresql',
                dv: '16.2',
                t: 'articles',
                columns: [
                    { name: 'id', type: 'int' },
                    { name: 'content', type: 'text' },
                    { name: 'metadata', type: 'json' },
                ],
            };

            const content = 'Long article content for MSSQL transfer. '.repeat(60);
            const targetVersion: DatabaseVersion = { dialect: 'mssql', major: 2022, minor: 0, raw: '16.0' };

            const rows = [{
                id: 1,
                content,
                metadata: { version: 2 },
            }];

            const result = await roundTrip(schema, rows, '.dt', 'mssql', targetVersion);

            // Text passes through unchanged
            expect(result[0]!.content).toBe(content);

            // JSON gets stringified for MSSQL < 2025
            expect(result[0]!.metadata).toBe('{"version":2}');

        });

        it('should transfer text from MSSQL schema to PostgreSQL through file', async () => {

            // Simulates: MSSQL table with nvarchar(max) columns → .dt → PostgreSQL
            const schema: DtSchema = {
                v: 1,
                d: 'mssql',
                dv: '2022.0',
                t: 'articles',
                columns: [
                    { name: 'id', type: 'int' },
                    { name: 'content', type: 'text', sourceType: 'nvarchar(max)' },
                    { name: 'summary', type: 'string', sourceType: 'nvarchar(255)' },
                ],
            };

            const largeContent = 'Article body from MSSQL nvarchar(max) column. '.repeat(80);

            const rows = [{
                id: 1,
                content: largeContent,
                summary: 'Brief summary',
            }];

            const result = await roundTrip(schema, rows, '.dt', 'postgres');

            expect(result[0]!.content).toBe(largeContent);
            expect(result[0]!.summary).toBe('Brief summary');

        });

        it('should transfer text via DtStreamer across all dialect pairs', () => {

            const columns: DtColumn[] = [
                { name: 'id', type: 'int' },
                { name: 'content', type: 'text' },
                { name: 'name', type: 'string' },
            ];

            const content = 'Streamed content with "quotes" and\nnewlines';

            const dialects: Dialect[] = ['postgres', 'mysql', 'mssql'];

            for (const source of dialects) {

                for (const target of dialects) {

                    const streamer = new DtStreamer({
                        sourceDialect: source,
                        targetDialect: target,
                        columns,
                    });

                    const result = streamer.convertBatch([{
                        id: 1,
                        content,
                        name: 'test',
                    }]);

                    expect(result[0]!.content).toBe(content);
                    expect(result[0]!.name).toBe('test');

                }

            }

        });

    });

    // -----------------------------------------------------------------------
    // Realistic multi-type schemas
    // -----------------------------------------------------------------------

    describe('realistic multi-type schemas', () => {

        it('should roundtrip a CMS-style table with text, json, string, and other types', async () => {

            const schema: DtSchema = {
                v: 1,
                d: 'postgresql',
                dv: '16.2',
                t: 'cms_articles',
                columns: [
                    { name: 'id', type: 'int' },
                    { name: 'slug', type: 'string' },
                    { name: 'title', type: 'string' },
                    { name: 'Content', type: 'text' },
                    { name: 'excerpt', type: 'string' },
                    { name: 'metadata', type: 'json' },
                    { name: 'tags', type: 'array' },
                    { name: 'published', type: 'bool' },
                    { name: 'author_id', type: 'uuid' },
                    { name: 'created_at', type: 'timestamp' },
                    { name: 'views', type: 'bigint' },
                ],
            };

            const largeContent = 'This is a detailed article about database migration strategies. '.repeat(100);

            const rows = [
                {
                    id: 1,
                    slug: 'db-migration-guide',
                    title: 'Database Migration Guide',
                    Content: largeContent,
                    excerpt: 'A comprehensive guide',
                    metadata: { version: 3, reviewers: ['bob', 'charlie'], seo: { keywords: ['db', 'migration'] } },
                    tags: ['database', 'migration', 'guide'],
                    published: true,
                    author_id: '550e8400-e29b-41d4-a716-446655440000',
                    created_at: new Date('2025-06-15T08:30:00.000Z'),
                    views: '9007199254740993',
                },
                {
                    id: 2,
                    slug: 'empty-draft',
                    title: 'Untitled Draft',
                    Content: '',
                    excerpt: '',
                    metadata: {},
                    tags: [],
                    published: false,
                    author_id: '660e8400-e29b-41d4-a716-446655440001',
                    created_at: new Date('2025-12-01T00:00:00.000Z'),
                    views: '0',
                },
            ];

            const result = await roundTrip(schema, rows, '.dt', 'postgres');

            expect(result).toHaveLength(2);

            // Row 1: full content
            expect(result[0]!.id).toBe(1);
            expect(result[0]!.slug).toBe('db-migration-guide');
            expect(result[0]!.title).toBe('Database Migration Guide');
            expect(result[0]!.Content).toBe(largeContent);
            expect(result[0]!.excerpt).toBe('A comprehensive guide');
            expect(result[0]!.metadata).toEqual({ version: 3, reviewers: ['bob', 'charlie'], seo: { keywords: ['db', 'migration'] } });
            expect(result[0]!.tags).toEqual(['database', 'migration', 'guide']);
            expect(result[0]!.published).toBe(true);
            expect(result[0]!.author_id).toBe('550e8400-e29b-41d4-a716-446655440000');
            expect((result[0]!.created_at as Date).toISOString()).toBe('2025-06-15T08:30:00.000Z');
            expect(result[0]!.views).toBe('9007199254740993');

            // Row 2: empty content
            expect(result[1]!.Content).toBe('');
            expect(result[1]!.metadata).toEqual({});
            expect(result[1]!.tags).toEqual([]);
            expect(result[1]!.published).toBe(false);

        });

        it('should roundtrip MSSQL-origin schema with nvarchar(max) text to MySQL target', async () => {

            // Simulates: MSSQL export → .dt file → MySQL import
            const schema: DtSchema = {
                v: 1,
                d: 'mssql',
                dv: '2022.0',
                t: 'documents',
                columns: [
                    { name: 'id', type: 'int' },
                    { name: 'body', type: 'text', sourceType: 'nvarchar(max)' },
                    { name: 'metadata', type: 'json' },
                    { name: 'active', type: 'bool' },
                ],
            };

            const body = 'Document body from MSSQL. '.repeat(100);

            const rows = [
                { id: 1, body, metadata: { dept: 'engineering' }, active: true },
                { id: 2, body: null, metadata: null, active: false },
            ];

            const result = await roundTrip(schema, rows, '.dt', 'mysql');

            // Text survives
            expect(result[0]!.body).toBe(body);
            // JSON is native object for MySQL
            expect(result[0]!.metadata).toEqual({ dept: 'engineering' });
            // Bool converts to tinyint for MySQL
            expect(result[0]!.active).toBe(1);

            // Nulls survive
            expect(result[1]!.body).toBe(null);
            expect(result[1]!.metadata).toBe(null);
            expect(result[1]!.active).toBe(0);

        });

        it('should roundtrip multiple large text rows through .dtz', async () => {

            const schema: DtSchema = {
                v: 1,
                d: 'postgresql',
                dv: '16.2',
                t: 'logs',
                columns: [
                    { name: 'id', type: 'int' },
                    { name: 'message', type: 'text' },
                ],
            };

            const rows = Array.from({ length: 50 }, (_, i) => ({
                id: i + 1,
                message: `Log entry ${i + 1}: ${'x'.repeat(500 + i * 10)}`,
            }));

            const result = await roundTrip(schema, rows, '.dtz', 'postgres');

            expect(result).toHaveLength(50);

            for (let i = 0; i < 50; i++) {

                expect(result[i]!.id).toBe(i + 1);
                expect(result[i]!.message).toBe(rows[i]!.message);

            }

        });

    });

    // -----------------------------------------------------------------------
    // Type classification edge cases
    // -----------------------------------------------------------------------

    describe('type classification edge cases', () => {

        it('should keep tinytext as string in MySQL (max 255 bytes)', () => {

            const result = toUniversalType({ dbType: 'tinytext', dialect: 'mysql' });

            expect(result.universalType).toBe('string');

        });

        it('should map TEXT to text in all three dialects', () => {

            for (const dialect of ['postgres', 'mysql', 'mssql'] as const) {

                const result = toUniversalType({ dbType: 'text', dialect });
                expect(result.universalType).toBe('text');

            }

        });

        it('should map deprecated MSSQL types (text, ntext) to text', () => {

            for (const dbType of ['text', 'ntext']) {

                const result = toUniversalType({ dbType, dialect: 'mssql' });
                expect(result.universalType).toBe('text');

            }

        });

        it('should map MySQL text variants to text', () => {

            for (const dbType of ['text', 'mediumtext', 'longtext']) {

                const result = toUniversalType({ dbType, dialect: 'mysql' });
                expect(result.universalType).toBe('text');

            }

        });

        it('should map text back to correct dialect types', () => {

            expect(toDialectType({ universalType: 'text', dialect: 'postgres' })).toBe('text');
            expect(toDialectType({ universalType: 'text', dialect: 'mysql' })).toBe('longtext');
            expect(toDialectType({ universalType: 'text', dialect: 'mssql' })).toBe('nvarchar(max)');

        });

        it('should distinguish nvarchar(max) (text) from nvarchar(255) (string) in MSSQL', () => {

            const max = toUniversalType({ dbType: 'nvarchar(max)', dialect: 'mssql' });
            const fixed = toUniversalType({ dbType: 'nvarchar(255)', dialect: 'mssql' });

            expect(max.universalType).toBe('text');
            expect(fixed.universalType).toBe('string');

        });

        it('should distinguish varchar(max) (text) from varchar(100) (string) in MSSQL', () => {

            const max = toUniversalType({ dbType: 'varchar(max)', dialect: 'mssql' });
            const fixed = toUniversalType({ dbType: 'varchar(100)', dialect: 'mssql' });

            expect(max.universalType).toBe('text');
            expect(fixed.universalType).toBe('string');

        });

    });

});
