/**
 * Deserialization for .dt file format.
 *
 * Converts .dt format values back to database-ready values.
 * Reverses encoding tuples and applies version-aware target conversions.
 *
 * @example
 * ```typescript
 * import { deserializeRow } from './deserialize.js';
 *
 * const row = deserializeRow({
 *     values: [1, [{ title: 'Doc' }, 'raw'], [[0.1, 0.2], 'raw']],
 *     columns: [
 *         { name: 'id', type: 'int' },
 *         { name: 'metadata', type: 'json' },
 *         { name: 'embedding', type: 'vector' },
 *     ],
 *     targetDialect: 'postgres',
 * });
 * // { id: 1, metadata: { title: 'Doc' }, embedding: '[0.1,0.2]' }
 * ```
 */
import { gunzipSync } from 'node:zlib';

import { attemptSync } from '@logosdx/utils';

import type { Dialect } from '../connection/types.js';
import type { DtColumn, DtValue, DatabaseVersion, Encoding } from './types.js';
import { isEncodedType } from './type-map.js';
import { MAX_DECOMPRESSED_VALUE_BYTES } from './constants.js';

/**
 * Options for deserializing a row.
 */
export interface DeserializeRowOptions {

    /** Array of .dt values in column order. */
    values: DtValue[];

    /** Column definitions. */
    columns: DtColumn[];

    /** Target database dialect for value conversion. */
    targetDialect: Dialect;

    /** Target database version for version-aware conversion. */
    targetVersion?: DatabaseVersion;

}

/**
 * Deserialize a .dt row back to a database-ready record.
 *
 * Reverses encoding and applies target-dialect conversions.
 *
 * @param options - Values, columns, and target info
 * @returns Record ready for database insertion
 */
export function deserializeRow(options: DeserializeRowOptions): Record<string, unknown> {

    const { values, columns, targetDialect, targetVersion } = options;
    const result: Record<string, unknown> = {};

    for (let i = 0; i < columns.length; i++) {

        const col = columns[i]!;
        const value = values[i];

        result[col.name] = deserializeValue(value, col, targetDialect, targetVersion);

    }

    return result;

}

/**
 * Deserialize a single .dt value.
 *
 * @param value - .dt value (native JSON or encoded tuple)
 * @param column - Column definition
 * @param targetDialect - Target database dialect
 * @param targetVersion - Target database version
 * @returns Database-ready value
 */
export function deserializeValue(
    value: DtValue,
    column: DtColumn,
    targetDialect: Dialect,
    targetVersion?: DatabaseVersion,
): unknown {

    // NULL passthrough
    if (value === null || value === undefined) {

        return null;

    }

    // Encoded types: decode the tuple first, then convert for target
    if (isEncodedType(column.type)) {

        const decoded = decodeTuple(value as [unknown, Encoding, ...unknown[]]);

        return convertEncodedForTarget(decoded, column.type, targetDialect, targetVersion);

    }

    // Simple types: convert for target dialect
    return convertSimpleForTarget(value, column.type, targetDialect);

}

/**
 * Decode an encoded value tuple.
 *
 * Reverses the encoding applied by serialize:
 * - `raw`: value is already the decoded object/array
 * - `b64`: base64 string → Buffer
 * - `gz64`: base64 string → gunzip → raw data
 *
 * @param tuple - Encoded value tuple `[value, encoding]`
 * @returns Decoded value
 */
function decodeTuple(tuple: [unknown, Encoding, ...unknown[]]): unknown {

    // Safety: if not an array or missing encoding, treat as raw
    if (!Array.isArray(tuple) || tuple.length < 2) {

        return tuple;

    }

    const [value, encoding] = tuple;

    switch (encoding) {

    case 'raw':
        return value;

    case 'b64': {

        const encoded = value as string;

        if (typeof encoded !== 'string') {

            throw new Error(`Expected a base64 string for a b64-encoded value, got ${typeof encoded}`);

        }

        const decoded = Buffer.from(encoded, 'base64');

        // Buffer.from silently discards every non-base64 character, so a
        // corrupted payload decodes to an empty buffer and imports as a
        // hollowed-out binary column. Round-tripping is the only way to see it.
        if (decoded.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {

            throw new Error('Invalid base64 payload in .dt value');

        }

        return decoded;

    }

    case 'gz64': {

        const compressed = Buffer.from(value as string, 'base64');

        // attempt() here because zlib's ERR_BUFFER_TOO_LARGE reads as an
        // internal allocation failure; the operator needs to know the file
        // asked for more than the limit allows.
        const [decompressed, gunzipErr] = attemptSync(() =>
            gunzipSync(compressed, { maxOutputLength: MAX_DECOMPRESSED_VALUE_BYTES }),
        );

        if (gunzipErr || !decompressed) {

            throw new Error(
                `Compressed value exceeds the ${MAX_DECOMPRESSED_VALUE_BYTES} byte decompression limit `
                + `or is not valid gzip: ${gunzipErr?.message ?? 'unknown error'}`,
            );

        }

        // Try parsing as JSON; if it fails, return the buffer
        const str = decompressed.toString('utf8');

        // Check if it looks like JSON (starts with {, [, ", or is a number)
        if (/^[[{"\d]/.test(str)) {

            // Attempt JSON parse; raw buffer fallback handled by caller
            return JSON.parse(str);

        }

        return decompressed;

    }

    default:
        // Passing an unrecognised tag through raw let a tampered .dt import
        // "successfully" with the wrong value in the column.
        throw new Error(`Unknown .dt value encoding: ${String(encoding)}`);

    }

}

/**
 * Convert a decoded encoded-type value for the target dialect.
 *
 * Handles dialect-specific differences like:
 * - vector: pgvector string format vs JSON string vs native
 * - json: native object vs JSON.stringify for MSSQL < 2025
 * - array: native vs JSON string
 */
function convertEncodedForTarget(
    decoded: unknown,
    type: string,
    targetDialect: Dialect,
    targetVersion?: DatabaseVersion,
): unknown {

    switch (type) {

    case 'json':
        return convertJsonForTarget(decoded, targetDialect, targetVersion);

    case 'text':
        // Text is a plain string after decoding, no target conversion needed
        return decoded;

    case 'binary':
        // Binary is always a Buffer after decoding
        return decoded;

    case 'vector':
        return convertVectorForTarget(decoded, targetDialect, targetVersion);

    case 'array':
        return convertArrayForTarget(decoded, targetDialect);

    case 'custom':
        // Custom types: stringify for non-native targets
        if (typeof decoded === 'object') return JSON.stringify(decoded);

        return decoded;

    default:
        return decoded;

    }

}

/**
 * Convert JSON value for target dialect.
 *
 * PostgreSQL: pass object directly (Kysely handles jsonb)
 * MySQL: pass object (driver handles native JSON)
 * MSSQL 2025+: pass object (native JSON)
 * MSSQL < 2025: JSON.stringify (stored in nvarchar)
 */
function convertJsonForTarget(
    decoded: unknown,
    targetDialect: Dialect,
    targetVersion?: DatabaseVersion,
): unknown {

    if (targetDialect === 'mssql') {

        const major = targetVersion?.major ?? 2022;

        // MSSQL < 2025 stores JSON as NVARCHAR(MAX) string
        if (major < 2025) {

            return typeof decoded === 'string' ? decoded : JSON.stringify(decoded);

        }

    }

    // PostgreSQL, MySQL, MSSQL 2025+: pass native object
    return decoded;

}

/**
 * Convert vector value for target dialect.
 *
 * PostgreSQL: `'[0.1,0.2,0.3]'` string format for pgvector
 * MySQL 9+: string format for native VECTOR
 * MySQL < 9: JSON string (stored in JSON column)
 * MSSQL 2025+: JSON array string for native VECTOR
 * MSSQL < 2025: JSON array string for NVARCHAR(MAX)
 */
function convertVectorForTarget(
    decoded: unknown,
    targetDialect: Dialect,
    targetVersion?: DatabaseVersion,
): unknown {

    // Ensure we have an array
    const arr = Array.isArray(decoded) ? decoded : decoded;

    if (targetDialect === 'postgres') {

        // pgvector expects '[0.1,0.2,0.3]' string format
        return Array.isArray(arr) ? `[${arr.join(',')}]` : String(arr);

    }

    if (targetDialect === 'mysql') {

        const major = targetVersion?.major ?? 8;

        if (major >= 9) {

            // MySQL 9+ native VECTOR: string format '[0.1,0.2]'
            return Array.isArray(arr) ? `[${arr.join(',')}]` : String(arr);

        }

        // MySQL < 9: store as JSON array string
        return Array.isArray(arr) ? JSON.stringify(arr) : String(arr);

    }

    // MSSQL: JSON array string (both native VECTOR and NVARCHAR workaround)
    return Array.isArray(arr) ? JSON.stringify(arr) : String(arr);

}

/**
 * Convert array value for target dialect.
 *
 * PostgreSQL: native array (pass through)
 * MySQL/MSSQL: JSON string (no native array support)
 */
function convertArrayForTarget(decoded: unknown, targetDialect: Dialect): unknown {

    if (targetDialect === 'postgres') {

        // PostgreSQL has native arrays
        return decoded;

    }

    // MySQL and MSSQL: store as JSON string
    return Array.isArray(decoded) ? JSON.stringify(decoded) : String(decoded);

}

/**
 * Convert a simple type value for the target dialect.
 */
function convertSimpleForTarget(value: DtValue, type: string, targetDialect: Dialect): unknown {

    switch (type) {

    case 'bigint':
        // MSSQL and some drivers need actual bigint values
        if (typeof value === 'string') {

            const num = Number(value);

            if (Number.isSafeInteger(num)) return num;

        }

        return value;

    case 'decimal':
        // Keep as string for precision
        return value;

    case 'bool':
        // MSSQL uses BIT (0/1), MySQL uses TINYINT(1)
        if (targetDialect === 'mssql') return value ? 1 : 0;
        if (targetDialect === 'mysql') return value ? 1 : 0;

        return value;

    case 'timestamp':
        // Convert ISO string to Date object for some drivers
        if (typeof value === 'string') return new Date(value);

        return value;

    case 'date':
        // Keep as string for date-only columns
        return value;

    case 'uuid':
        return value;

    case 'int':
    case 'float':
        return value;

    case 'string':
    default:
        return value;

    }

}
