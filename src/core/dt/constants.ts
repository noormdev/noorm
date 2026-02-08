/**
 * Constants for the .dt format.
 *
 * Defines thresholds for smart compression decisions and type classification sets.
 */
import type { EncodedType, SimpleType } from './types.js';

/**
 * Current .dt format version.
 */
export const FORMAT_VERSION = 1;

/**
 * Minimum byte size before considering gzip compression.
 *
 * Values smaller than this threshold remain uncompressed for readability.
 * 128 bytes is the sweet spot: below this, gzip overhead exceeds savings.
 */
export const GZIP_THRESHOLD = 128;

/**
 * Maximum gzip-to-raw ratio to accept compression.
 *
 * Gzip must save at least 15% (ratio < 0.85) to be worth the overhead.
 * Incompressible data (random bytes, already-compressed content) stays raw.
 */
export const GZIP_RATIO_THRESHOLD = 0.85;

/**
 * Simple types stored as native JSON values.
 *
 * Uses boolean hash for O(1) lookups.
 */
export const SIMPLE_TYPES: { [key in SimpleType]: true } = {
    string: true,
    int: true,
    bigint: true,
    float: true,
    decimal: true,
    bool: true,
    timestamp: true,
    date: true,
    uuid: true,
};

/**
 * Encoded types that use `[value, encoding]` tuples.
 *
 * Uses boolean hash for O(1) lookups.
 */
export const ENCODED_TYPES: { [key in EncodedType]: true } = {
    json: true,
    binary: true,
    vector: true,
    array: true,
    text: true,
    custom: true,
};

/**
 * Valid .dt file extensions.
 */
export const DT_EXTENSIONS = {
    /** Raw .dt file (uncompressed JSON5 lines). */
    RAW: '.dt',
    /** Gzip-compressed .dt file. */
    COMPRESSED: '.dtz',
    /** Gzip-compressed and AES-256-GCM encrypted .dt file. */
    ENCRYPTED: '.dtzx',
} as const;

/**
 * Supported database dialects for .dt operations.
 */
export const DT_SUPPORTED_DIALECTS = ['postgres', 'mysql', 'mssql'] as const;
