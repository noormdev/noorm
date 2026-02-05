/**
 * Dialect registry for .dt type mappings.
 *
 * Routes type mapping operations to the correct dialect implementation.
 *
 * @example
 * ```typescript
 * import { getDialectPatterns, getDialectTargetType } from './dialects/index.js';
 *
 * const patterns = getDialectPatterns('postgres');
 * const targetType = getDialectTargetType('json', 'mssql', version);
 * ```
 */
import type { Dialect } from '../../connection/types.js';
import type { UniversalType, DatabaseVersion } from '../types.js';
import type { TypePattern } from './postgres.js';

import { POSTGRES_TO_UNIVERSAL, UNIVERSAL_TO_POSTGRES } from './postgres.js';
import { MYSQL_TO_UNIVERSAL, getUniversalToMysql } from './mysql.js';
import { MSSQL_TO_UNIVERSAL, getUniversalToMssql } from './mssql.js';

/**
 * Get source type → universal type pattern list for a dialect.
 *
 * @param dialect - Database dialect
 * @returns Array of type patterns, or empty array for unsupported dialects
 */
export function getDialectPatterns(dialect: Dialect): TypePattern[] {

    switch (dialect) {

    case 'postgres':
        return POSTGRES_TO_UNIVERSAL;

    case 'mysql':
        return MYSQL_TO_UNIVERSAL;

    case 'mssql':
        return MSSQL_TO_UNIVERSAL;

    default:
        return [];

    }

}

/**
 * Get dialect-specific target type string for a universal type.
 *
 * Version-aware: uses database version to select optimal type mappings.
 *
 * @param universalType - Universal type to map
 * @param dialect - Target database dialect
 * @param version - Target database version (optional)
 * @returns Dialect-specific type string
 */
export function getDialectTargetType(
    universalType: UniversalType,
    dialect: Dialect,
    version?: DatabaseVersion,
): string {

    switch (dialect) {

    case 'postgres':
        return UNIVERSAL_TO_POSTGRES[universalType] ?? 'text';

    case 'mysql':
        return getUniversalToMysql(universalType, version);

    case 'mssql':
        return getUniversalToMssql(universalType, version);

    default:
        return 'text';

    }

}

// Re-export dialect-specific modules
export { POSTGRES_TO_UNIVERSAL, UNIVERSAL_TO_POSTGRES } from './postgres.js';
export { MYSQL_TO_UNIVERSAL, getUniversalToMysql } from './mysql.js';
export { MSSQL_TO_UNIVERSAL, getUniversalToMssql } from './mssql.js';
export type { TypePattern } from './postgres.js';
