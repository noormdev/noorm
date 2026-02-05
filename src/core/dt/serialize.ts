/**
 * Serialization for .dt file format.
 *
 * Converts database row values to .dt format values.
 * Simple types become native JSON; encoded types become `[value, encoding]` tuples
 * with smart compression based on payload size.
 *
 * @example
 * ```typescript
 * import { serializeRow } from './serialize.js';
 *
 * const dtValues = serializeRow({
 *     row: { id: 1, metadata: { title: 'Doc' }, embedding: [0.1, 0.2] },
 *     columns: [
 *         { name: 'id', type: 'int' },
 *         { name: 'metadata', type: 'json' },
 *         { name: 'embedding', type: 'vector' },
 *     ],
 * });
 * // [1, [{ title: 'Doc' }, 'raw'], [[0.1, 0.2], 'raw']]
 * ```
 */
import { gzipSync } from 'node:zlib';

import type { DtColumn, DtValue, EncodedValue } from './types.js';
import { GZIP_THRESHOLD, GZIP_RATIO_THRESHOLD } from './constants.js';
import { isEncodedType } from './type-map.js';

/**
 * Options for serializing a row.
 */
export interface SerializeRowOptions {

    /** Database row as key-value pairs. */
    row: Record<string, unknown>;

    /** Column definitions (determines serialization strategy per value). */
    columns: DtColumn[];

}

/**
 * Serialize a database row to .dt format values.
 *
 * Returns an array of values in column order. Simple types are passed through
 * with appropriate conversions; encoded types become `[value, encoding]` tuples.
 *
 * @param options - Row data and column definitions
 * @returns Array of .dt values in column order
 */
export function serializeRow(options: SerializeRowOptions): DtValue[] {

    const { row, columns } = options;
    const result: DtValue[] = [];

    for (const col of columns) {

        const value = row[col.name];
        result.push(serializeValue(value, col));

    }

    return result;

}

/**
 * Serialize a single value based on its column type.
 *
 * @param value - Raw database value
 * @param column - Column definition
 * @returns Serialized .dt value
 */
export function serializeValue(value: unknown, column: DtColumn): DtValue {

    // NULL is always null
    if (value === null || value === undefined) {

        return null;

    }

    // Encoded types → tuple
    if (isEncodedType(column.type)) {

        return encodeValue(value, column.type);

    }

    // Simple types → native JSON representation
    return serializeSimple(value, column.type);

}

/**
 * Serialize a simple type value to its JSON representation.
 *
 * bigint and decimal are stored as strings to preserve precision.
 * Timestamps are stored as ISO 8601 strings.
 */
function serializeSimple(value: unknown, type: string): DtValue {

    switch (type) {

    case 'bigint':
        // Preserve precision beyond Number.MAX_SAFE_INTEGER
        return String(value);

    case 'decimal':
        // Preserve exact decimal precision
        return String(value);

    case 'bool':
        // Normalize truthy values (MSSQL bit, MySQL tinyint)
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';

        return Boolean(value);

    case 'timestamp': {

        // ISO 8601 string
        if (value instanceof Date) return value.toISOString();

        return String(value);

    }

    case 'date': {

        // ISO 8601 date-only string
        if (value instanceof Date) return value.toISOString().split('T')[0];

        return String(value);

    }

    case 'uuid':
        return String(value);

    case 'int':
    case 'float':
        // Native JSON number
        return typeof value === 'string' ? Number(value) : value;

    case 'string':
    default:
        return String(value);

    }

}

/**
 * Encode a value for an encoded type column.
 *
 * Applies smart compression: small values stay human-readable,
 * large values are gzip+base64 compressed.
 *
 * @param value - Raw value from database
 * @param type - Universal encoded type
 * @returns Encoded value tuple `[value, encoding]`
 */
export function encodeValue(value: unknown, type: string): EncodedValue {

    if (type === 'binary') {

        return encodeBinary(value);

    }

    // json, vector, array, custom — all follow the same compression logic
    return encodeJsonLike(value);

}

/**
 * Encode a binary value.
 *
 * Small binary → base64, large binary → gzip+base64 if worthwhile.
 */
function encodeBinary(value: unknown): EncodedValue {

    const buf = toBuffer(value);
    const byteLength = buf.length;

    // Small binary: just base64
    if (byteLength < GZIP_THRESHOLD) {

        return [buf.toString('base64'), 'b64'];

    }

    // Try gzip compression
    const compressed = gzipSync(buf);

    if (compressed.length < byteLength * GZIP_RATIO_THRESHOLD) {

        return [compressed.toString('base64'), 'gz64'];

    }

    // Gzip didn't help enough, use plain base64
    return [buf.toString('base64'), 'b64'];

}

/**
 * Encode a JSON-like value (json, vector, array, custom).
 *
 * Small payloads stay raw for readability; large ones get compressed.
 */
function encodeJsonLike(value: unknown): EncodedValue {

    const jsonStr = JSON.stringify(value);
    const byteLength = Buffer.byteLength(jsonStr, 'utf8');

    // Small value: keep human-readable
    if (byteLength < GZIP_THRESHOLD) {

        return [value, 'raw'];

    }

    // Try gzip compression
    const buf = Buffer.from(jsonStr, 'utf8');
    const compressed = gzipSync(buf);

    if (compressed.length < byteLength * GZIP_RATIO_THRESHOLD) {

        return [compressed.toString('base64'), 'gz64'];

    }

    // Gzip didn't help, keep raw
    return [value, 'raw'];

}

/**
 * Convert a value to a Buffer.
 *
 * Handles Buffer, Uint8Array, and base64 strings.
 */
function toBuffer(value: unknown): Buffer {

    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (typeof value === 'string') return Buffer.from(value, 'base64');

    return Buffer.from(String(value), 'utf8');

}
