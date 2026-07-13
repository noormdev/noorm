/**
 * Shared module exports.
 *
 * Cross-cutting concerns used by multiple core modules.
 * Table types and constants live here to avoid circular dependencies.
 */

// Errors
export { getSqlErrorMessage } from './errors.js';

// Files
export { filterFilesByPaths } from './files.js';

// Dialect quoting
export { createDialectQuoting, type DialectQuoting } from './dialect-quoting.js';

// Tables
export { NOORM_TABLES, getNoormTables, noormDb } from './tables.js';

export type {
    NoormTableNames,
    NoormTableName,
    NoormSchemaTableName,
    NoormDatabase,
    NoormSchemaDb,
    NoormPrefixDb,
    // Version
    NoormVersionTable,
    NoormVersion,
    NewNoormVersion,
    NoormVersionUpdate,
    // Change
    OperationStatus,
    ChangeType,
    Direction,
    NoormChangeTable,
    NoormChange,
    NewNoormChange,
    NoormChangeUpdate,
    // Executions
    ExecutionStatus,
    FileType,
    NoormExecutionsTable,
    NoormExecution,
    NewNoormExecution,
    NoormExecutionUpdate,
    // Lock
    NoormLockTable,
    NoormLock,
    NewNoormLock,
    NoormLockUpdate,
    // Identities
    NoormIdentitiesTable,
    NoormIdentity,
    NewNoormIdentity,
    NoormIdentityUpdate,
    // Vault
    NoormVaultTable,
    NoormVault,
    NewNoormVault,
    NoormVaultUpdate,
} from './tables.js';
