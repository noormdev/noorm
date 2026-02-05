/**
 * DtStreamer tests.
 *
 * Covers convertBatch(), shouldFlush(), and cross-dialect type conversions
 * for json, vector, array, bool, and custom types.
 */
import { describe, it, expect } from 'vitest';
import { DtStreamer } from '../../../src/core/dt/streamer.js';
import type { DtColumn, DatabaseVersion } from '../../../src/core/dt/types.js';

describe('dt: streamer', () => {

    // -----------------------------------------------------------------------
    // convertBatch
    // -----------------------------------------------------------------------

    describe('convertBatch', () => {

        it('should passthrough simple types between same dialects', () => {

            const columns: DtColumn[] = [
                { name: 'id', type: 'int' },
                { name: 'name', type: 'string' },
            ];

            const streamer = new DtStreamer({
                sourceDialect: 'postgres',
                targetDialect: 'postgres',
                columns,
            });

            const rows = [{ id: 1, name: 'alice' }, { id: 2, name: 'bob' }];
            const result = streamer.convertBatch(rows);

            expect(result).toEqual(rows);

        });

        it('should convert bool from postgres to mssql (true → 1)', () => {

            const columns: DtColumn[] = [{ name: 'active', type: 'bool' }];
            const streamer = new DtStreamer({
                sourceDialect: 'postgres',
                targetDialect: 'mssql',
                columns,
            });

            const result = streamer.convertBatch([{ active: true }, { active: false }]);

            expect(result[0]!.active).toBe(1);
            expect(result[1]!.active).toBe(0);

        });

        it('should convert bool from mssql to postgres (1 → true)', () => {

            const columns: DtColumn[] = [{ name: 'active', type: 'bool' }];
            const streamer = new DtStreamer({
                sourceDialect: 'mssql',
                targetDialect: 'postgres',
                columns,
            });

            const result = streamer.convertBatch([{ active: 1 }, { active: 0 }]);

            expect(result[0]!.active).toBe(true);
            expect(result[1]!.active).toBe(false);

        });

        it('should convert json from mssql < 2025 to postgres', () => {

            const columns: DtColumn[] = [{ name: 'data', type: 'json' }];
            const sourceVersion: DatabaseVersion = { dialect: 'mssql', major: 2022, minor: 0, raw: '16.0' };

            const streamer = new DtStreamer({
                sourceDialect: 'mssql',
                sourceVersion,
                targetDialect: 'postgres',
                columns,
            });

            // MSSQL < 2025 stores JSON as NVARCHAR string
            const result = streamer.convertBatch([{ data: '{"key":"val"}' }]);
            expect(result[0]!.data).toEqual({ key: 'val' });

        });

        it('should stringify json from postgres to mssql < 2025', () => {

            const columns: DtColumn[] = [{ name: 'data', type: 'json' }];
            const targetVersion: DatabaseVersion = { dialect: 'mssql', major: 2022, minor: 0, raw: '16.0' };

            const streamer = new DtStreamer({
                sourceDialect: 'postgres',
                targetDialect: 'mssql',
                targetVersion,
                columns,
            });

            const result = streamer.convertBatch([{ data: { key: 'val' } }]);
            expect(result[0]!.data).toBe('{"key":"val"}');

        });

        it('should convert vector from postgres to mysql (pgvector string → string format)', () => {

            const columns: DtColumn[] = [{ name: 'emb', type: 'vector' }];
            const targetVersion: DatabaseVersion = { dialect: 'mysql', major: 9, minor: 0, raw: '9.0' };

            const streamer = new DtStreamer({
                sourceDialect: 'postgres',
                targetDialect: 'mysql',
                targetVersion,
                columns,
            });

            // pgvector format
            const result = streamer.convertBatch([{ emb: '[0.1,0.2,0.3]' }]);
            expect(result[0]!.emb).toBe('[0.1,0.2,0.3]');

        });

        it('should convert vector from postgres to mssql (pgvector string → JSON array)', () => {

            const columns: DtColumn[] = [{ name: 'emb', type: 'vector' }];

            const streamer = new DtStreamer({
                sourceDialect: 'postgres',
                targetDialect: 'mssql',
                columns,
            });

            const result = streamer.convertBatch([{ emb: '[0.1,0.2,0.3]' }]);
            expect(result[0]!.emb).toBe('[0.1,0.2,0.3]');

        });

        it('should convert array from postgres to mysql (native → JSON string)', () => {

            const columns: DtColumn[] = [{ name: 'tags', type: 'array' }];

            const streamer = new DtStreamer({
                sourceDialect: 'postgres',
                targetDialect: 'mysql',
                columns,
            });

            const result = streamer.convertBatch([{ tags: [1, 2, 3] }]);
            expect(result[0]!.tags).toBe('[1,2,3]');

        });

        it('should convert array from mysql to postgres (JSON string → native)', () => {

            const columns: DtColumn[] = [{ name: 'tags', type: 'array' }];

            const streamer = new DtStreamer({
                sourceDialect: 'mysql',
                targetDialect: 'postgres',
                columns,
            });

            const result = streamer.convertBatch([{ tags: '[1,2,3]' }]);
            expect(result[0]!.tags).toEqual([1, 2, 3]);

        });

        it('should handle null values', () => {

            const columns: DtColumn[] = [
                { name: 'id', type: 'int' },
                { name: 'data', type: 'json' },
            ];

            const streamer = new DtStreamer({
                sourceDialect: 'postgres',
                targetDialect: 'mysql',
                columns,
            });

            const result = streamer.convertBatch([{ id: 1, data: null }]);
            expect(result[0]!.data).toBe(null);

        });

        it('should stringify custom type for different dialects', () => {

            const columns: DtColumn[] = [{ name: 'geo', type: 'custom' }];

            const streamer = new DtStreamer({
                sourceDialect: 'postgres',
                targetDialect: 'mysql',
                columns,
            });

            const result = streamer.convertBatch([{ geo: { lat: 1, lng: 2 } }]);
            expect(result[0]!.geo).toBe('{"lat":1,"lng":2}');

        });

        it('should passthrough custom type for same dialect', () => {

            const columns: DtColumn[] = [{ name: 'geo', type: 'custom' }];

            const streamer = new DtStreamer({
                sourceDialect: 'postgres',
                targetDialect: 'postgres',
                columns,
            });

            const result = streamer.convertBatch([{ geo: { lat: 1, lng: 2 } }]);
            expect(result[0]!.geo).toEqual({ lat: 1, lng: 2 });

        });

    });

    // -----------------------------------------------------------------------
    // shouldFlush
    // -----------------------------------------------------------------------

    describe('shouldFlush', () => {

        it('should flush when rows exceed batchSize', () => {

            const columns: DtColumn[] = [{ name: 'id', type: 'int' }];
            const streamer = new DtStreamer({
                sourceDialect: 'postgres',
                targetDialect: 'mysql',
                columns,
                batchSize: 3,
            });

            expect(streamer.shouldFlush([{ id: 1 }, { id: 2 }])).toBe(false);
            expect(streamer.shouldFlush([{ id: 1 }, { id: 2 }, { id: 3 }])).toBe(true);

        });

        it('should expose batchSize', () => {

            const columns: DtColumn[] = [{ name: 'id', type: 'int' }];
            const streamer = new DtStreamer({
                sourceDialect: 'postgres',
                targetDialect: 'mysql',
                columns,
                batchSize: 50,
            });

            expect(streamer.batchSize).toBe(50);

        });

        it('should flush when memory exceeds maxBatchBytes', () => {

            const columns: DtColumn[] = [{ name: 'data', type: 'string' }];
            const streamer = new DtStreamer({
                sourceDialect: 'postgres',
                targetDialect: 'mysql',
                columns,
                batchSize: 1000,
                maxBatchBytes: 100,
            });

            // Large string values will exceed 100 bytes
            const rows = [{ data: 'x'.repeat(200) }];
            expect(streamer.shouldFlush(rows)).toBe(true);

        });

        it('should not flush for small batches', () => {

            const columns: DtColumn[] = [{ name: 'id', type: 'int' }];
            const streamer = new DtStreamer({
                sourceDialect: 'postgres',
                targetDialect: 'mysql',
                columns,
                batchSize: 100,
            });

            expect(streamer.shouldFlush([{ id: 1 }])).toBe(false);

        });

    });

});
