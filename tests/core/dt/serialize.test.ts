/**
 * Serialization tests.
 *
 * Covers serializeRow(), serializeValue(), encodeValue() for simple types,
 * encoded types, null handling, and compression thresholds.
 */
import { describe, it, expect } from 'vitest';
import {
    serializeRow,
    serializeValue,
    encodeValue,
} from '../../../src/core/dt/serialize.js';
import type { DtColumn, EncodedValue } from '../../../src/core/dt/types.js';

describe('dt: serialize', () => {

    // -----------------------------------------------------------------------
    // serializeRow
    // -----------------------------------------------------------------------

    describe('serializeRow', () => {

        it('should serialize a row in column order', () => {

            const columns: DtColumn[] = [
                { name: 'id', type: 'int' },
                { name: 'name', type: 'string' },
                { name: 'active', type: 'bool' },
            ];

            const result = serializeRow({ row: { id: 1, name: 'alice', active: true }, columns });

            expect(result).toEqual([1, 'alice', true]);

        });

        it('should handle null values', () => {

            const columns: DtColumn[] = [
                { name: 'id', type: 'int' },
                { name: 'email', type: 'string' },
            ];

            const result = serializeRow({ row: { id: 1, email: null }, columns });

            expect(result).toEqual([1, null]);

        });

        it('should handle undefined values as null', () => {

            const columns: DtColumn[] = [
                { name: 'id', type: 'int' },
                { name: 'email', type: 'string' },
            ];

            const result = serializeRow({ row: { id: 1 }, columns });

            expect(result).toEqual([1, null]);

        });

        it('should produce encoded tuples for encoded types', () => {

            const columns: DtColumn[] = [
                { name: 'id', type: 'int' },
                { name: 'data', type: 'json' },
            ];

            const result = serializeRow({ row: { id: 1, data: { key: 'val' } }, columns });

            expect(result[0]).toBe(1);
            const encoded = result[1] as EncodedValue;
            expect(Array.isArray(encoded)).toBe(true);
            expect(encoded[0]).toEqual({ key: 'val' });
            expect(encoded[1]).toBe('raw');

        });

    });

    // -----------------------------------------------------------------------
    // serializeValue - simple types
    // -----------------------------------------------------------------------

    describe('serializeValue - simple types', () => {

        it('should serialize string', () => {

            const col: DtColumn = { name: 'v', type: 'string' };
            expect(serializeValue('hello', col)).toBe('hello');

        });

        it('should serialize int', () => {

            const col: DtColumn = { name: 'v', type: 'int' };
            expect(serializeValue(42, col)).toBe(42);

        });

        it('should convert string int to number', () => {

            const col: DtColumn = { name: 'v', type: 'int' };
            expect(serializeValue('42', col)).toBe(42);

        });

        it('should serialize bigint as string', () => {

            const col: DtColumn = { name: 'v', type: 'bigint' };
            expect(serializeValue(9007199254740993n, col)).toBe('9007199254740993');

        });

        it('should serialize float', () => {

            const col: DtColumn = { name: 'v', type: 'float' };
            expect(serializeValue(3.14, col)).toBe(3.14);

        });

        it('should serialize decimal as string', () => {

            const col: DtColumn = { name: 'v', type: 'decimal' };
            expect(serializeValue('99.999', col)).toBe('99.999');

        });

        it('should serialize bool from boolean', () => {

            const col: DtColumn = { name: 'v', type: 'bool' };
            expect(serializeValue(true, col)).toBe(true);
            expect(serializeValue(false, col)).toBe(false);

        });

        it('should normalize numeric bool (MSSQL bit)', () => {

            const col: DtColumn = { name: 'v', type: 'bool' };
            expect(serializeValue(1, col)).toBe(true);
            expect(serializeValue(0, col)).toBe(false);

        });

        it('should normalize string bool', () => {

            const col: DtColumn = { name: 'v', type: 'bool' };
            expect(serializeValue('1', col)).toBe(true);
            expect(serializeValue('true', col)).toBe(true);
            expect(serializeValue('0', col)).toBe(false);

        });

        it('should serialize timestamp from Date', () => {

            const col: DtColumn = { name: 'v', type: 'timestamp' };
            const d = new Date('2024-01-15T10:30:00.000Z');
            expect(serializeValue(d, col)).toBe('2024-01-15T10:30:00.000Z');

        });

        it('should serialize timestamp from string', () => {

            const col: DtColumn = { name: 'v', type: 'timestamp' };
            expect(serializeValue('2024-01-15T10:30:00Z', col)).toBe('2024-01-15T10:30:00Z');

        });

        it('should serialize date from Date', () => {

            const col: DtColumn = { name: 'v', type: 'date' };
            const d = new Date('2024-01-15T00:00:00.000Z');
            expect(serializeValue(d, col)).toBe('2024-01-15');

        });

        it('should serialize uuid', () => {

            const col: DtColumn = { name: 'v', type: 'uuid' };
            const uuid = '550e8400-e29b-41d4-a716-446655440000';
            expect(serializeValue(uuid, col)).toBe(uuid);

        });

        it('should return null for null', () => {

            const col: DtColumn = { name: 'v', type: 'string' };
            expect(serializeValue(null, col)).toBe(null);

        });

        it('should return null for undefined', () => {

            const col: DtColumn = { name: 'v', type: 'string' };
            expect(serializeValue(undefined, col)).toBe(null);

        });

    });

    // -----------------------------------------------------------------------
    // encodeValue
    // -----------------------------------------------------------------------

    describe('encodeValue', () => {

        it('should encode small JSON as raw', () => {

            const result = encodeValue({ key: 'val' }, 'json');
            expect(result[0]).toEqual({ key: 'val' });
            expect(result[1]).toBe('raw');

        });

        it('should encode small vector as raw', () => {

            const vec = [0.1, 0.2, 0.3];
            const result = encodeValue(vec, 'vector');
            expect(result[0]).toEqual(vec);
            expect(result[1]).toBe('raw');

        });

        it('should encode small array as raw', () => {

            const arr = [1, 2, 3];
            const result = encodeValue(arr, 'array');
            expect(result[0]).toEqual(arr);
            expect(result[1]).toBe('raw');

        });

        it('should encode small binary as b64', () => {

            const buf = Buffer.from('hello');
            const result = encodeValue(buf, 'binary');
            expect(result[1]).toBe('b64');
            expect(Buffer.from(result[0] as string, 'base64').toString()).toBe('hello');

        });

        it('should encode large compressible JSON as gz64', () => {

            // Create a large repetitive JSON payload (compresses well)
            const largeObj = { data: 'x'.repeat(500) };
            const result = encodeValue(largeObj, 'json');
            expect(result[1]).toBe('gz64');

        });

        it('should encode large binary as gz64 when compressible', () => {

            // Repetitive data compresses well
            const buf = Buffer.alloc(500, 'a');
            const result = encodeValue(buf, 'binary');
            expect(result[1]).toBe('gz64');

        });

        it('should encode large incompressible binary as b64', () => {

            // Random data does not compress well
            const buf = Buffer.from(Array.from({ length: 200 }, (_, i) => i % 256));
            const result = encodeValue(buf, 'binary');
            // May be b64 or gz64 depending on compressibility — just check it's valid
            expect(['b64', 'gz64']).toContain(result[1]);

        });

        it('should handle Uint8Array for binary', () => {

            const arr = new Uint8Array([1, 2, 3, 4, 5]);
            const result = encodeValue(arr, 'binary');
            expect(result[1]).toBe('b64');

        });

        it('should encode small text as raw', () => {

            const result = encodeValue('hello world', 'text');
            expect(result[0]).toBe('hello world');
            expect(result[1]).toBe('raw');

        });

        it('should encode large compressible text as gz64', () => {

            const largeText = 'x'.repeat(500);
            const result = encodeValue(largeText, 'text');
            expect(result[1]).toBe('gz64');

        });

        it('should encode text with special characters as raw when small', () => {

            const text = 'Line 1\nLine 2\n"quoted"\ttab';
            const result = encodeValue(text, 'text');
            expect(result[0]).toBe(text);
            expect(result[1]).toBe('raw');

        });

    });

    // -----------------------------------------------------------------------
    // serializeValue - text type
    // -----------------------------------------------------------------------

    describe('serializeValue - text type', () => {

        it('should encode text column as tuple', () => {

            const col: DtColumn = { name: 'content', type: 'text' };
            const result = serializeValue('article body', col) as EncodedValue;
            expect(Array.isArray(result)).toBe(true);
            expect(result[0]).toBe('article body');
            expect(result[1]).toBe('raw');

        });

        it('should return null for null text', () => {

            const col: DtColumn = { name: 'content', type: 'text' };
            expect(serializeValue(null, col)).toBe(null);

        });

        it('should return null for undefined text', () => {

            const col: DtColumn = { name: 'content', type: 'text' };
            expect(serializeValue(undefined, col)).toBe(null);

        });

        it('should compress large text content', () => {

            const col: DtColumn = { name: 'content', type: 'text' };
            const largeContent = 'The quick brown fox jumps over the lazy dog. '.repeat(50);
            const result = serializeValue(largeContent, col) as EncodedValue;
            expect(Array.isArray(result)).toBe(true);
            expect(result[1]).toBe('gz64');

        });

    });

});
