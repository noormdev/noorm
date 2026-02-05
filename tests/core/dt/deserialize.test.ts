/**
 * Deserialization tests.
 *
 * Covers deserializeRow(), deserializeValue() with dialect-specific
 * conversions for json, vector, array, and simple types.
 */
import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';

import {
    deserializeRow,
    deserializeValue,
} from '../../../src/core/dt/deserialize.js';
import type { DtColumn, DatabaseVersion } from '../../../src/core/dt/types.js';

describe('dt: deserialize', () => {

    // -----------------------------------------------------------------------
    // deserializeRow
    // -----------------------------------------------------------------------

    describe('deserializeRow', () => {

        it('should deserialize a row as a keyed record', () => {

            const columns: DtColumn[] = [
                { name: 'id', type: 'int' },
                { name: 'name', type: 'string' },
                { name: 'active', type: 'bool' },
            ];

            const result = deserializeRow({
                values: [42, 'alice', true],
                columns,
                targetDialect: 'postgres',
            });

            expect(result).toEqual({ id: 42, name: 'alice', active: true });

        });

        it('should handle null values', () => {

            const columns: DtColumn[] = [
                { name: 'id', type: 'int' },
                { name: 'email', type: 'string' },
            ];

            const result = deserializeRow({
                values: [1, null],
                columns,
                targetDialect: 'postgres',
            });

            expect(result).toEqual({ id: 1, email: null });

        });

    });

    // -----------------------------------------------------------------------
    // deserializeValue - simple types
    // -----------------------------------------------------------------------

    describe('deserializeValue - simple types', () => {

        it('should passthrough int', () => {

            const col: DtColumn = { name: 'v', type: 'int' };
            expect(deserializeValue(42, col, 'postgres')).toBe(42);

        });

        it('should passthrough string', () => {

            const col: DtColumn = { name: 'v', type: 'string' };
            expect(deserializeValue('hello', col, 'postgres')).toBe('hello');

        });

        it('should convert bigint string to number if safe', () => {

            const col: DtColumn = { name: 'v', type: 'bigint' };
            expect(deserializeValue('12345', col, 'postgres')).toBe(12345);

        });

        it('should keep bigint string if unsafe', () => {

            const col: DtColumn = { name: 'v', type: 'bigint' };
            const big = '9007199254740993';
            expect(deserializeValue(big, col, 'postgres')).toBe(big);

        });

        it('should convert bool for mssql (bit)', () => {

            const col: DtColumn = { name: 'v', type: 'bool' };
            expect(deserializeValue(true, col, 'mssql')).toBe(1);
            expect(deserializeValue(false, col, 'mssql')).toBe(0);

        });

        it('should convert bool for mysql (tinyint)', () => {

            const col: DtColumn = { name: 'v', type: 'bool' };
            expect(deserializeValue(true, col, 'mysql')).toBe(1);
            expect(deserializeValue(false, col, 'mysql')).toBe(0);

        });

        it('should keep bool for postgres', () => {

            const col: DtColumn = { name: 'v', type: 'bool' };
            expect(deserializeValue(true, col, 'postgres')).toBe(true);

        });

        it('should convert timestamp string to Date', () => {

            const col: DtColumn = { name: 'v', type: 'timestamp' };
            const result = deserializeValue('2024-01-15T10:30:00.000Z', col, 'postgres');
            expect(result).toBeInstanceOf(Date);
            expect((result as Date).toISOString()).toBe('2024-01-15T10:30:00.000Z');

        });

        it('should passthrough date string', () => {

            const col: DtColumn = { name: 'v', type: 'date' };
            expect(deserializeValue('2024-01-15', col, 'postgres')).toBe('2024-01-15');

        });

        it('should passthrough uuid string', () => {

            const col: DtColumn = { name: 'v', type: 'uuid' };
            const uuid = '550e8400-e29b-41d4-a716-446655440000';
            expect(deserializeValue(uuid, col, 'postgres')).toBe(uuid);

        });

        it('should return null for null value', () => {

            const col: DtColumn = { name: 'v', type: 'int' };
            expect(deserializeValue(null, col, 'postgres')).toBe(null);

        });

    });

    // -----------------------------------------------------------------------
    // deserializeValue - encoded types
    // -----------------------------------------------------------------------

    describe('deserializeValue - encoded types', () => {

        it('should decode raw json for postgres', () => {

            const col: DtColumn = { name: 'v', type: 'json' };
            const result = deserializeValue([{ key: 'val' }, 'raw'], col, 'postgres');
            expect(result).toEqual({ key: 'val' });

        });

        it('should stringify json for mssql < 2025', () => {

            const col: DtColumn = { name: 'v', type: 'json' };
            const version: DatabaseVersion = { dialect: 'mssql', major: 2022, minor: 0, raw: '16.0' };
            const result = deserializeValue([{ key: 'val' }, 'raw'], col, 'mssql', version);
            expect(result).toBe('{"key":"val"}');

        });

        it('should keep json object for mssql 2025+', () => {

            const col: DtColumn = { name: 'v', type: 'json' };
            const version: DatabaseVersion = { dialect: 'mssql', major: 2025, minor: 0, raw: '17.0' };
            const result = deserializeValue([{ key: 'val' }, 'raw'], col, 'mssql', version);
            expect(result).toEqual({ key: 'val' });

        });

        it('should decode raw vector for postgres (pgvector string)', () => {

            const col: DtColumn = { name: 'v', type: 'vector' };
            const result = deserializeValue([[0.1, 0.2, 0.3], 'raw'], col, 'postgres');
            expect(result).toBe('[0.1,0.2,0.3]');

        });

        it('should decode raw vector for mysql 9+ (string format)', () => {

            const col: DtColumn = { name: 'v', type: 'vector' };
            const version: DatabaseVersion = { dialect: 'mysql', major: 9, minor: 0, raw: '9.0' };
            const result = deserializeValue([[0.1, 0.2, 0.3], 'raw'], col, 'mysql', version);
            expect(result).toBe('[0.1,0.2,0.3]');

        });

        it('should decode raw vector for mysql < 9 (JSON string)', () => {

            const col: DtColumn = { name: 'v', type: 'vector' };
            const version: DatabaseVersion = { dialect: 'mysql', major: 8, minor: 0, raw: '8.0' };
            const result = deserializeValue([[0.1, 0.2, 0.3], 'raw'], col, 'mysql', version);
            expect(result).toBe('[0.1,0.2,0.3]');

        });

        it('should decode raw vector for mssql (JSON string)', () => {

            const col: DtColumn = { name: 'v', type: 'vector' };
            const result = deserializeValue([[0.1, 0.2, 0.3], 'raw'], col, 'mssql');
            expect(result).toBe('[0.1,0.2,0.3]');

        });

        it('should decode raw array for postgres (native)', () => {

            const col: DtColumn = { name: 'v', type: 'array' };
            const result = deserializeValue([[1, 2, 3], 'raw'], col, 'postgres');
            expect(result).toEqual([1, 2, 3]);

        });

        it('should decode raw array for mysql (JSON string)', () => {

            const col: DtColumn = { name: 'v', type: 'array' };
            const result = deserializeValue([[1, 2, 3], 'raw'], col, 'mysql');
            expect(result).toBe('[1,2,3]');

        });

        it('should decode b64 binary', () => {

            const col: DtColumn = { name: 'v', type: 'binary' };
            const b64 = Buffer.from('hello').toString('base64');
            const result = deserializeValue([b64, 'b64'], col, 'postgres');
            expect(Buffer.isBuffer(result)).toBe(true);
            expect((result as Buffer).toString()).toBe('hello');

        });

        it('should decode gz64 json', () => {

            const col: DtColumn = { name: 'v', type: 'json' };
            const obj = { key: 'value' };
            const compressed = gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'));
            const b64 = compressed.toString('base64');

            const result = deserializeValue([b64, 'gz64'], col, 'postgres');
            expect(result).toEqual(obj);

        });

        it('should handle custom type for non-native target', () => {

            const col: DtColumn = { name: 'v', type: 'custom' };
            const result = deserializeValue([{ x: 1 }, 'raw'], col, 'mysql');
            expect(typeof result).toBe('string');
            expect(result).toBe('{"x":1}');

        });

    });

});
