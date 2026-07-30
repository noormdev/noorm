/**
 * Database lifecycle module.
 *
 * Provides operations for creating, destroying, and checking database status.
 * Supports PostgreSQL, MySQL, MSSQL, and SQLite with dialect-specific implementations.
 *
 * @example
 * ```typescript
 * import { checkDbStatus, createDb, destroyDb } from './db'
 *
 * // Check status
 * const status = await checkDbStatus(config)
 *
 * // Create database and tracking tables
 * await createDb(config, 'myconfig')
 *
 * // Drop entire database
 * await destroyDb(config, 'myconfig')
 * ```
 */

// Main operations
export { checkDbStatus, createDb, destroyDb } from './operations.js';

// Lifecycle policy gate
export { assertDbPolicy } from './policy.js';
export type { DbPolicyContext } from './policy.js';

// Dual connection infrastructure
export { withDualConnection } from './dual.js';
export type {
    DualConnectionContext,
    DualConnectionEntry,
    DualConnectionOptions,
} from './dual.js';

// Types
export type {
    DbStatus,
    DbOperationResult,
    CreateDbOptions,
    DestroyDbOptions,
    DialectDbOperations,
} from './types.js';

// Dialect operations (for advanced use)
export {
    getDialectOperations,
    dialectOperations,
    postgresDbOperations,
    mysqlDbOperations,
    mssqlDbOperations,
    sqliteDbOperations,
} from './dialects/index.js';
