/**
 * Shared module exports.
 *
 * Cross-cutting concerns used by multiple core modules.
 * Table types and constants live here to avoid circular dependencies.
 */

// Tables
export {
    NOORM_TABLES,
} from './tables.js'

export type {
    NoormTableName,
    NoormDatabase,
    // Version
    NoormVersionTable,
    NoormVersion,
    NewNoormVersion,
    NoormVersionUpdate,
    // Changeset
    OperationStatus,
    ChangeType,
    Direction,
    NoormChangesetTable,
    NoormChangeset,
    NewNoormChangeset,
    NoormChangesetUpdate,
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
} from './tables.js'
