/**
 * Dialect factory for explore operations.
 *
 * Returns the appropriate explore operations implementation
 * based on the database dialect.
 */
import type { Dialect } from '../../connection/types.js';
import type { DialectExploreOperations } from '../types.js';

import { postgresExploreOperations } from './postgres.js';
import { mysqlExploreOperations } from './mysql.js';
import { mssqlExploreOperations } from './mssql.js';
import { sqliteExploreOperations } from './sqlite.js';

/**
 * Dialect-to-operations mapping.
 */
const dialectOperations: Record<Dialect, DialectExploreOperations> = {
    postgres: postgresExploreOperations,
    mysql: mysqlExploreOperations,
    mssql: mssqlExploreOperations,
    sqlite: sqliteExploreOperations,
};

/**
 * Get explore operations for a specific dialect.
 *
 * @param dialect - The database dialect
 * @returns Dialect-specific explore operations
 *
 * @example
 * ```typescript
 * const ops = getExploreOperations('postgres')
 * const overview = await ops.getOverview(db)
 * ```
 */
export function getExploreOperations(dialect: Dialect): DialectExploreOperations {

    return dialectOperations[dialect];

}

export {
    postgresExploreOperations,
    mysqlExploreOperations,
    mssqlExploreOperations,
    sqliteExploreOperations,
};
