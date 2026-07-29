/**
 * In-memory cross-dialect data streamer.
 *
 * Converts rows from one dialect's type system to another without
 * file I/O, JSON5 encoding, or gzip compression. Pure type conversion
 * for efficient cross-dialect DB-to-DB transfers.
 *
 * @example
 * ```typescript
 * import { DtStreamer } from './streamer.js';
 *
 * const streamer = new DtStreamer({
 *     sourceDialect: 'postgres',
 *     targetDialect: 'mysql',
 *     columns: [
 *         { name: 'id', type: 'int' },
 *         { name: 'data', type: 'json' },
 *     ],
 * });
 *
 * const targetRows = streamer.convertBatch(sourceRows);
 * ```
 */
import { gigabytes } from '@logosdx/utils';

import type { Dialect } from '../connection/types.js';
import type { DtColumn, DtStreamerOptions, DatabaseVersion } from './types.js';
import { isEncodedType } from './type-map.js';

/**
 * Default soft batch row limit.
 */
const DEFAULT_BATCH_SIZE = 100;

/**
 * Default max batch memory (1 GB).
 */
const DEFAULT_MAX_BATCH_BYTES = gigabytes(1);

/**
 * In-memory cross-dialect data converter.
 *
 * Operates on plain objects: no serialization to strings, no encoding tuples.
 * Used by the cross-dialect executor path: fetch batch -> convertBatch -> insert.
 *
 * Soft-limit batching: flushes at batchSize OR maxBatchBytes, whichever comes first.
 * Prevents OOM on tables with large BLOB/BINARY columns.
 */
export class DtStreamer {

    #sourceDialect: Dialect;
    #sourceVersion?: DatabaseVersion;
    #targetDialect: Dialect;
    #targetVersion?: DatabaseVersion;
    #columns: DtColumn[];
    #batchSize: number;
    #maxBatchBytes: number;

    /**
     * Create a new DtStreamer for cross-dialect conversion.
     *
     * @param options - Source/target dialects, columns, and batch limits
     */
    constructor(options: DtStreamerOptions) {

        this.#sourceDialect = options.sourceDialect;
        this.#sourceVersion = options.sourceVersion;
        this.#targetDialect = options.targetDialect;
        this.#targetVersion = options.targetVersion;
        this.#columns = options.columns;
        this.#batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
        this.#maxBatchBytes = options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES;

    }

    /**
     * The soft batch size limit.
     */
    get batchSize(): number {

        return this.#batchSize;

    }

    /**
     * Convert a batch of source-dialect rows to target-dialect rows.
     *
     * Performs in-memory type conversion without any file I/O or encoding.
     *
     * @param rows - Source database rows
     * @returns Target-dialect rows ready for insertion
     */
    convertBatch(rows: Record<string, unknown>[]): Record<string, unknown>[] {

        const result: Record<string, unknown>[] = [];

        for (const row of rows) {

            result.push(this.#convertRow(row));

        }

        return result;

    }

    /**
     * Check if accumulated rows should be flushed.
     *
     * Returns true when row count exceeds batchSize OR estimated memory
     * exceeds maxBatchBytes. Prevents OOM on tables with large values.
     *
     * @param rows - Currently accumulated rows
     * @returns True if the batch should be flushed
     */
    shouldFlush(rows: Record<string, unknown>[]): boolean {

        if (rows.length >= this.#batchSize) {

            return true;

        }

        // Estimate memory usage of accumulated rows
        return estimateRowsBytes(rows) >= this.#maxBatchBytes;

    }

    /**
     * Convert a single row from source to target dialect.
     */
    #convertRow(row: Record<string, unknown>): Record<string, unknown> {

        const result: Record<string, unknown> = {};

        for (const col of this.#columns) {

            const value = row[col.name];

            if (value === null || value === undefined) {

                result[col.name] = null;
                continue;

            }

            if (isEncodedType(col.type)) {

                result[col.name] = this.#convertEncodedValue(value, col.type);

            }
            else {

                result[col.name] = this.#convertSimpleValue(value, col.type);

            }

        }

        return result;

    }

    /**
     * Convert an encoded-type value between dialects.
     *
     * No serialization overhead: works directly with native objects.
     */
    #convertEncodedValue(value: unknown, type: string): unknown {

        switch (type) {

        case 'json':
            return this.#convertJson(value);

        case 'text':
            // Text passes through unchanged
            return value;

        case 'binary':
            // Binary data passes through unchanged
            return value;

        case 'vector':
            return this.#convertVector(value);

        case 'array':
            return this.#convertArray(value);

        case 'custom':
            // Custom types: stringify for non-native targets
            if (this.#targetDialect !== this.#sourceDialect && typeof value === 'object') {

                return JSON.stringify(value);

            }

            return value;

        default:
            return value;

        }

    }

    /**
     * Convert JSON between dialects.
     */
    #convertJson(value: unknown): unknown {

        if (this.#targetDialect === 'mssql') {

            const major = this.#targetVersion?.major ?? 2022;

            if (major < 2025) {

                return typeof value === 'string' ? value : JSON.stringify(value);

            }

        }

        // MySQL's driver has no JSON codec — handing it the object postgres
        // returned for a jsonb column sends "[object Object]" and the insert
        // fails with "Invalid JSON text ... at position 1".
        if (this.#targetDialect === 'mysql') {

            return typeof value === 'string' ? value : JSON.stringify(value);

        }

        // If source was MSSQL < 2025 (string), parse it for other targets
        if (this.#sourceDialect === 'mssql' && typeof value === 'string') {

            const major = this.#sourceVersion?.major ?? 2022;

            if (major < 2025) {

                return JSON.parse(value);

            }

        }

        return value;

    }

    /**
     * Convert vector between dialects.
     */
    #convertVector(value: unknown): unknown {

        // Parse source vector to array if it's a string
        let arr: unknown;

        if (typeof value === 'string') {

            // PostgreSQL pgvector format: '[0.1,0.2,0.3]'
            const trimmed = value.replace(/^\[/, '').replace(/\]$/, '');
            arr = trimmed.split(',').map(Number);

        }
        else {

            arr = value;

        }

        // Convert to target format
        if (this.#targetDialect === 'postgres') {

            // pgvector string format
            return Array.isArray(arr) ? `[${arr.join(',')}]` : String(value);

        }

        if (this.#targetDialect === 'mysql') {

            const major = this.#targetVersion?.major ?? 8;

            if (major >= 9) {

                // MySQL 9+ native VECTOR string format
                return Array.isArray(arr) ? `[${arr.join(',')}]` : String(value);

            }

            // MySQL < 9: JSON array
            return Array.isArray(arr) ? JSON.stringify(arr) : String(value);

        }

        // MSSQL: JSON array string
        return Array.isArray(arr) ? JSON.stringify(arr) : String(value);

    }

    /**
     * Convert array between dialects.
     */
    #convertArray(value: unknown): unknown {

        if (this.#targetDialect === 'postgres') {

            // Parse JSON array string back to native array for PostgreSQL
            if (typeof value === 'string') return JSON.parse(value);

            return value;

        }

        // MySQL/MSSQL: store as JSON string
        if (Array.isArray(value)) return JSON.stringify(value);

        return value;

    }

    /**
     * Convert a simple-type value between dialects.
     */
    #convertSimpleValue(value: unknown, type: string): unknown {

        switch (type) {

        case 'bool':
            // PostgreSQL uses true/false, MSSQL uses 0/1, MySQL uses 0/1
            if (this.#targetDialect === 'mssql' || this.#targetDialect === 'mysql') {

                if (typeof value === 'boolean') return value ? 1 : 0;

            }
            else if (this.#sourceDialect === 'mssql' || this.#sourceDialect === 'mysql') {

                if (typeof value === 'number') return value !== 0;

            }

            return value;

        case 'uuid':
            // All dialects accept UUID strings
            return value;

        default:
            return value;

        }

    }

}

/**
 * Rough estimate of memory consumed by an array of row objects.
 *
 * Uses JSON.stringify length as a proxy. Not precise, but good enough
 * for the soft-limit batching purpose.
 */
function estimateRowsBytes(rows: Record<string, unknown>[]): number {

    let total = 0;

    for (const row of rows) {

        for (const key in row) {

            const val = row[key];

            if (val === null || val === undefined) {

                total += 8;

            }
            else if (Buffer.isBuffer(val)) {

                total += val.length;

            }
            else if (typeof val === 'string') {

                total += val.length * 2; // UTF-16 estimate

            }
            else if (typeof val === 'object') {

                total += JSON.stringify(val).length * 2;

            }
            else {

                total += 8; // number, boolean

            }

        }

    }

    return total;

}
