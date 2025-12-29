/**
 * Database dialect operations.
 *
 * Exports dialect-specific database lifecycle operations.
 */
import type { Dialect } from '../../connection/types.js';
import type { DialectDbOperations } from '../types.js';

import { postgresDbOperations } from './postgres.js';
import { mysqlDbOperations } from './mysql.js';
import { mssqlDbOperations } from './mssql.js';
import { sqliteDbOperations } from './sqlite.js';

/**
 * Map of dialect to operations.
 */
export const dialectOperations: Record<Dialect, DialectDbOperations> = {
    postgres: postgresDbOperations,
    mysql: mysqlDbOperations,
    mssql: mssqlDbOperations,
    sqlite: sqliteDbOperations,
};

/**
 * Get database operations for a dialect.
 */
export function getDialectOperations(dialect: Dialect): DialectDbOperations {

    return dialectOperations[dialect];

}

// Re-export individual dialect operations
export { postgresDbOperations } from './postgres.js';
export { mysqlDbOperations } from './mysql.js';
export { mssqlDbOperations } from './mssql.js';
export { sqliteDbOperations } from './sqlite.js';
