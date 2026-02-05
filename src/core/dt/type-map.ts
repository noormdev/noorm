/**
 * Universal type mapping engine.
 *
 * Two core functions that convert between database-specific types
 * and the .dt universal type system. Version-aware for optimal mappings.
 *
 * @example
 * ```typescript
 * import { toUniversalType, toDialectType } from './type-map.js';
 *
 * // Database type → universal
 * const result = toUniversalType({ dbType: 'jsonb', dialect: 'postgres' });
 * // { universalType: 'json', native: true }
 *
 * // Universal → database type
 * const dialectType = toDialectType({ universalType: 'json', dialect: 'mssql', version });
 * // 'json' (2025+) or 'nvarchar(max)' (2022-)
 * ```
 */
import type { Dialect } from '../connection/types.js';
import type { UniversalType, DatabaseVersion, TypeMappingResult } from './types.js';
import { ENCODED_TYPES } from './constants.js';

import { getDialectPatterns, getDialectTargetType } from './dialects/index.js';

/**
 * Options for mapping a database type to a universal type.
 */
export interface ToUniversalOptions {

    /** Database-specific type string (e.g., `jsonb`, `nvarchar(max)`, `vector(1536)`). */
    dbType: string;

    /** Source database dialect. */
    dialect: Dialect;

    /** Source database version (optional, for future version-aware source mapping). */
    version?: DatabaseVersion;

}

/**
 * Options for mapping a universal type to a dialect-specific type.
 */
export interface ToDialectOptions {

    /** Universal type to map. */
    universalType: UniversalType;

    /** Target database dialect. */
    dialect: Dialect;

    /** Target database version for version-aware mapping. */
    version?: DatabaseVersion;

}

/**
 * Map a database-specific type to the .dt universal type system.
 *
 * Matches the database type against dialect-specific patterns.
 * First matching pattern wins.
 *
 * @param options - Source type and dialect info
 * @returns Universal type and whether it's natively supported
 *
 * @example
 * ```typescript
 * toUniversalType({ dbType: 'vector(1536)', dialect: 'postgres' })
 * // { universalType: 'vector', native: true }
 *
 * toUniversalType({ dbType: 'nvarchar(max)', dialect: 'mssql' })
 * // { universalType: 'string', native: true }
 * ```
 */
export function toUniversalType(options: ToUniversalOptions): TypeMappingResult {

    const { dbType, dialect } = options;
    const patterns = getDialectPatterns(dialect);

    for (const entry of patterns) {

        if (entry.pattern.test(dbType)) {

            return {
                universalType: entry.universalType,
                native: entry.native,
            };

        }

    }

    // Fallback: unknown types become custom
    return { universalType: 'custom', native: false };

}

/**
 * Map a universal type to a dialect-specific type string.
 *
 * Version-aware: selects optimal type based on database capabilities.
 *
 * @param options - Universal type and target dialect info
 * @returns Dialect-specific type string (e.g., `jsonb`, `nvarchar(max)`)
 *
 * @example
 * ```typescript
 * toDialectType({ universalType: 'json', dialect: 'mssql', version: { major: 2025 } })
 * // 'json'
 *
 * toDialectType({ universalType: 'json', dialect: 'mssql', version: { major: 2022 } })
 * // 'nvarchar(max)'
 * ```
 */
export function toDialectType(options: ToDialectOptions): string {

    const { universalType, dialect, version } = options;

    return getDialectTargetType(universalType, dialect, version);

}

/**
 * Check if a universal type is an encoded type (uses tuples in .dt files).
 *
 * Uses O(1) hash lookup.
 *
 * @param type - Universal type to check
 * @returns True if the type uses encoded value tuples
 *
 * @example
 * ```typescript
 * isEncodedType('json')   // true
 * isEncodedType('string') // false
 * ```
 */
export function isEncodedType(type: UniversalType): boolean {

    return (ENCODED_TYPES as Record<string, boolean>)[type] === true;

}
