/**
 * PostgreSQL type mappings for the .dt universal type system.
 *
 * Maps PostgreSQL-specific data types to universal types and back.
 * PostgreSQL has the most stable type system of the three supported dialects.
 *
 * @example
 * ```typescript
 * import { POSTGRES_TO_UNIVERSAL, UNIVERSAL_TO_POSTGRES } from './postgres.js';
 * ```
 */
import type { UniversalType } from '../types.js';

/**
 * Pattern entry for source type → universal type mapping.
 *
 * Patterns are tested in order; first match wins.
 */
export interface TypePattern {

    /** Regex to match against the source database type (case-insensitive). */
    pattern: RegExp;

    /** Universal type this pattern maps to. */
    universalType: UniversalType;

    /** Whether this is a native type (vs. workaround). */
    native: boolean;

}

/**
 * PostgreSQL source type → universal type mappings.
 *
 * Tested in order; first match wins. More specific patterns must come first.
 */
export const POSTGRES_TO_UNIVERSAL: TypePattern[] = [
    // Boolean
    { pattern: /^boolean$/i, universalType: 'bool', native: true },
    { pattern: /^bool$/i, universalType: 'bool', native: true },

    // Integer types
    { pattern: /^smallint$/i, universalType: 'int', native: true },
    { pattern: /^int2$/i, universalType: 'int', native: true },
    { pattern: /^integer$/i, universalType: 'int', native: true },
    { pattern: /^int$/i, universalType: 'int', native: true },
    { pattern: /^int4$/i, universalType: 'int', native: true },
    { pattern: /^serial$/i, universalType: 'int', native: true },
    { pattern: /^smallserial$/i, universalType: 'int', native: true },

    // Bigint
    { pattern: /^bigint$/i, universalType: 'bigint', native: true },
    { pattern: /^int8$/i, universalType: 'bigint', native: true },
    { pattern: /^bigserial$/i, universalType: 'bigint', native: true },

    // Float
    { pattern: /^real$/i, universalType: 'float', native: true },
    { pattern: /^float4$/i, universalType: 'float', native: true },
    { pattern: /^double precision$/i, universalType: 'float', native: true },
    { pattern: /^float8$/i, universalType: 'float', native: true },

    // Decimal
    { pattern: /^numeric/i, universalType: 'decimal', native: true },
    { pattern: /^decimal/i, universalType: 'decimal', native: true },

    // UUID
    { pattern: /^uuid$/i, universalType: 'uuid', native: true },

    // Date/time
    { pattern: /^timestamptz/i, universalType: 'timestamp', native: true },
    { pattern: /^timestamp/i, universalType: 'timestamp', native: true },
    { pattern: /^date$/i, universalType: 'date', native: true },
    { pattern: /^time/i, universalType: 'string', native: true },

    // JSON
    { pattern: /^jsonb$/i, universalType: 'json', native: true },
    { pattern: /^json$/i, universalType: 'json', native: true },

    // Binary
    { pattern: /^bytea$/i, universalType: 'binary', native: true },

    // Vector (pgvector extension)
    { pattern: /^vector/i, universalType: 'vector', native: true },

    // Array types (e.g., integer[], text[], etc.)
    { pattern: /\[\]$/i, universalType: 'array', native: true },
    { pattern: /^ARRAY$/i, universalType: 'array', native: true },

    // String types (catch-all for text-like types)
    { pattern: /^text$/i, universalType: 'string', native: true },
    { pattern: /^varchar/i, universalType: 'string', native: true },
    { pattern: /^character varying/i, universalType: 'string', native: true },
    { pattern: /^char/i, universalType: 'string', native: true },
    { pattern: /^character\b/i, universalType: 'string', native: true },
    { pattern: /^citext$/i, universalType: 'string', native: true },
    { pattern: /^name$/i, universalType: 'string', native: true },

    // Everything else → custom
    { pattern: /.*/, universalType: 'custom', native: false },
];

/**
 * Universal type → PostgreSQL target type mappings.
 *
 * No version gating needed for PostgreSQL (stable type system).
 */
export const UNIVERSAL_TO_POSTGRES: Record<UniversalType, string> = {
    string: 'text',
    int: 'integer',
    bigint: 'bigint',
    float: 'double precision',
    decimal: 'numeric',
    bool: 'boolean',
    timestamp: 'timestamptz',
    date: 'date',
    uuid: 'uuid',
    json: 'jsonb',
    binary: 'bytea',
    vector: 'vector',
    array: 'text[]',
    custom: 'text',
};
