/**
 * Kysely table types for noorm tracking tables.
 *
 * These types define the shape of the database tables used by noorm
 * to track changes, executions, locks, identities, and versions.
 *
 * For full schema documentation, see plan/datamodel.md
 *
 * WHY: Kysely uses these types to provide type-safe queries.
 * They match the database schema created by migrations.
 */
import type { Generated, Insertable, Kysely, Selectable, Updateable } from 'kysely';

import type { Dialect } from '../connection/types.js';

// ─────────────────────────────────────────────────────────────
// Table Names
// ─────────────────────────────────────────────────────────────

/**
 * Noorm tracking table names.
 *
 * Use these constants instead of hardcoding table names.
 *
 * @deprecated Use `getNoormTables(dialect)` instead. This constant maps to prefixed
 * names and will produce incorrect SQL when used with `noormDb()` on pg/mssql.
 *
 * @example
 * ```typescript
 * import { NOORM_TABLES } from './shared'
 *
 * await db.selectFrom(NOORM_TABLES.version).selectAll().execute()
 * ```
 */
export const NOORM_TABLES = Object.freeze({
    /** Version tracking table */
    version: '__noorm_version__' as const,

    /** Change/operation tracking table */
    change: '__noorm_change__' as const,

    /** File execution tracking table */
    executions: '__noorm_executions__' as const,

    /** Concurrent operation lock table */
    lock: '__noorm_lock__' as const,

    /** Team member identity table */
    identities: '__noorm_identities__' as const,

    /** Vault secrets table */
    vault: '__noorm_vault__' as const,
});

/**
 * Shape returned by getNoormTables().
 */
export type NoormTableNames = {

    version: string;
    change: string;
    executions: string;
    lock: string;
    identities: string;
    vault: string;

};

/**
 * Schema-qualified table names for pg/mssql.
 *
 * Used with withSchema('noorm') — table names have no prefix.
 */
const SCHEMA_TABLES = Object.freeze({
    version: 'version' as const,
    change: 'change' as const,
    executions: 'executions' as const,
    lock: 'lock' as const,
    identities: 'identities' as const,
    vault: 'vault' as const,
});

/**
 * Get dialect-appropriate noorm table names.
 *
 * pg/mssql: clean names used with withSchema('noorm').
 * sqlite/mysql: prefixed names used directly.
 *
 * Returns the concrete const type so Kysely can narrow table names
 * for type-safe selectFrom() calls.
 *
 * @example
 * ```typescript
 * const tables = getNoormTables('postgres');
 * const ndb = noormDb(db, 'postgres');
 * await ndb.selectFrom(tables.change).selectAll().execute();
 * ```
 */
export function getNoormTables(dialect: Dialect): typeof SCHEMA_TABLES | typeof NOORM_TABLES {

    if (dialect === 'postgres' || dialect === 'mssql') {

        return SCHEMA_TABLES;

    }

    return NOORM_TABLES;

}

/**
 * Get a Kysely instance scoped to the noorm schema.
 *
 * pg/mssql: wraps with withSchema('noorm') so all table references
 * are prefixed with the noorm schema.
 * sqlite/mysql: returns the db as-is.
 *
 * @example
 * ```typescript
 * const ndb = noormDb(db, 'postgres');
 * await ndb.selectFrom('change').selectAll().execute();
 * // SQL: SELECT * FROM "noorm"."change"
 * ```
 */
export function noormDb(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
): Kysely<NoormDatabase> {

    if (dialect === 'postgres' || dialect === 'mssql') {

        return db.withSchema('noorm') as Kysely<NoormDatabase>;

    }

    return db;

}

/**
 * Type for prefixed noorm table names (sqlite/mysql).
 *
 * Only includes the `__noorm_*__` prefixed names from NOORM_TABLES.
 * For pg/mssql schema-qualified names, use NoormSchemaTableName.
 */
export type NoormTableName = (typeof NOORM_TABLES)[keyof typeof NOORM_TABLES];

/**
 * Type for schema-qualified noorm table names (pg/mssql).
 *
 * Clean names used with withSchema('noorm').
 */
export type NoormSchemaTableName = (typeof SCHEMA_TABLES)[keyof typeof SCHEMA_TABLES];

// ─────────────────────────────────────────────────────────────
// __noorm_version__
// ─────────────────────────────────────────────────────────────

/**
 * Version tracking table.
 *
 * Tracks noorm CLI version and all internal schema versions for migrations.
 * See: plan/datamodel.md#__noorm_version__
 */
export interface NoormVersionTable {
    /** Primary key */
    id: Generated<number>;

    /** CLI semver (e.g., "1.2.3") */
    cli_version: string;

    /** Database tracking tables version */
    noorm_version: number;

    /** State file (state.enc) schema version */
    state_version: number;

    /** Settings file (settings.yml) schema version */
    settings_version: number;

    /** First installation timestamp */
    installed_at: Generated<Date>;

    /** Last upgrade timestamp */
    upgraded_at: Generated<Date>;
}

export type NoormVersion = Selectable<NoormVersionTable>;
export type NewNoormVersion = Insertable<NoormVersionTable>;
export type NoormVersionUpdate = Updateable<NoormVersionTable>;

// ─────────────────────────────────────────────────────────────
// __noorm_change__
// ─────────────────────────────────────────────────────────────

/**
 * Operation status values.
 *
 * - pending: Operation started but not finished
 * - success: Operation completed successfully
 * - failed: Operation failed with error
 * - reverted: Operation was reverted
 * - stale: Operation's schema objects were torn down (needs re-run)
 */
export type OperationStatus = 'pending' | 'success' | 'failed' | 'reverted' | 'stale';

/**
 * Change type values.
 */
export type ChangeType = 'build' | 'run' | 'change';

/**
 * Direction values.
 */
export type Direction = 'change' | 'revert';

/**
 * Change tracking table.
 *
 * Tracks all operation batches—changes, builds, and ad-hoc runs.
 * See: plan/datamodel.md#__noorm_change__
 */
export interface NoormChangeTable {
    /** Primary key */
    id: Generated<number>;

    /** Operation identifier */
    name: string;

    /** 'build', 'run', or 'change' */
    change_type: ChangeType;

    /** 'change' or 'revert' */
    direction: Direction;

    /** SHA-256 of sorted file checksums */
    checksum: Generated<string>;

    /** When executed */
    executed_at: Generated<Date>;

    /** Identity string */
    executed_by: Generated<string>;

    /** Which config was used */
    config_name: Generated<string>;

    /** noorm version */
    cli_version: Generated<string>;

    /** 'pending', 'success', 'failed', 'reverted' */
    status: OperationStatus;

    /** Error details (empty = no error) */
    error_message: Generated<string>;

    /** Execution time (0 = never ran) */
    duration_ms: Generated<number>;
}

export type NoormChange = Selectable<NoormChangeTable>;
export type NewNoormChange = Insertable<NoormChangeTable>;
export type NoormChangeUpdate = Updateable<NoormChangeTable>;

// ─────────────────────────────────────────────────────────────
// __noorm_executions__
// ─────────────────────────────────────────────────────────────

/**
 * File execution status values.
 */
export type ExecutionStatus = 'pending' | 'success' | 'failed' | 'skipped';

/**
 * File type values.
 */
export type FileType = 'sql' | 'txt';

/**
 * Executions tracking table.
 *
 * Tracks individual file executions within an operation.
 * See: plan/datamodel.md#__noorm_executions__
 */
export interface NoormExecutionsTable {
    /** Primary key */
    id: Generated<number>;

    /** Parent operation (FK to __noorm_change__) */
    change_id: number;

    /** File that was executed */
    filepath: string;

    /** 'sql' or 'txt' */
    file_type: FileType;

    /** SHA-256 of file contents */
    checksum: Generated<string>;

    /** noorm version */
    cli_version: Generated<string>;

    /** 'pending', 'success', 'failed', 'skipped' */
    status: ExecutionStatus;

    /** Error details (empty = no error) */
    error_message: Generated<string>;

    /** 'unchanged', 'already-run', 'change failed' */
    skip_reason: Generated<string>;

    /** Execution time (0 = never ran) */
    duration_ms: Generated<number>;
}

export type NoormExecution = Selectable<NoormExecutionsTable>;
export type NewNoormExecution = Insertable<NoormExecutionsTable>;
export type NoormExecutionUpdate = Updateable<NoormExecutionsTable>;

// ─────────────────────────────────────────────────────────────
// __noorm_lock__
// ─────────────────────────────────────────────────────────────

/**
 * Lock table.
 *
 * Prevents concurrent operations on the same database.
 * See: plan/datamodel.md#__noorm_lock__
 */
export interface NoormLockTable {
    /** Primary key */
    id: Generated<number>;

    /** Lock scope (config name) */
    config_name: string;

    /** Identity of holder */
    locked_by: string;

    /** When acquired */
    locked_at: Generated<Date>;

    /** Auto-expiry time */
    expires_at: Date;

    /** Lock reason (empty = none) */
    reason: Generated<string>;
}

export type NoormLock = Selectable<NoormLockTable>;
export type NewNoormLock = Insertable<NoormLockTable>;
export type NoormLockUpdate = Updateable<NoormLockTable>;

// ─────────────────────────────────────────────────────────────
// __noorm_identities__
// ─────────────────────────────────────────────────────────────

/**
 * Identities table.
 *
 * Stores user identities for team discovery.
 * Auto-populated on first connect when identity is set up.
 * See: plan/datamodel.md#__noorm_identities__
 */
export interface NoormIdentitiesTable {
    /** Primary key */
    id: Generated<number>;

    /** SHA-256(email + name + machine + os) */
    identity_hash: string;

    /** User email */
    email: string;

    /** Display name */
    name: string;

    /** Machine hostname */
    machine: string;

    /** OS platform and version */
    os: string;

    /** X25519 public key (hex) */
    public_key: string;

    /** First registration */
    registered_at: Generated<Date>;

    /** Last activity */
    last_seen_at: Generated<Date>;

    /** Vault key encrypted with user's public key (nullable for users without vault access) */
    encrypted_vault_key: string | null;
}

export type NoormIdentity = Selectable<NoormIdentitiesTable>;
export type NewNoormIdentity = Insertable<NoormIdentitiesTable>;
export type NoormIdentityUpdate = Updateable<NoormIdentitiesTable>;

// ─────────────────────────────────────────────────────────────
// __noorm_vault__
// ─────────────────────────────────────────────────────────────

/**
 * Vault secrets table.
 *
 * Stores encrypted secrets shared across the team.
 * Secrets are encrypted with a vault key that is distributed
 * to team members via their public keys.
 */
export interface NoormVaultTable {
    /** Primary key */
    id: Generated<number>;

    /** Secret key name (e.g., 'API_KEY', 'DB_PASSWORD') */
    secret_key: string;

    /** AES-256-GCM encrypted value (JSON: {iv, authTag, ciphertext}) */
    encrypted_value: string;

    /** Identity who set this secret */
    set_by: string;

    /** When created */
    created_at: Generated<Date>;

    /** When last updated */
    updated_at: Generated<Date>;
}

export type NoormVault = Selectable<NoormVaultTable>;
export type NewNoormVault = Insertable<NoormVaultTable>;
export type NoormVaultUpdate = Updateable<NoormVaultTable>;

// ─────────────────────────────────────────────────────────────
// Combined Database Interface
// ─────────────────────────────────────────────────────────────

/**
 * Schema-qualified database interface for pg/mssql.
 *
 * Used with db.withSchema('noorm') — table names have no prefix.
 */
export interface NoormSchemaDb {

    version: NoormVersionTable;
    change: NoormChangeTable;
    executions: NoormExecutionsTable;
    lock: NoormLockTable;
    identities: NoormIdentitiesTable;
    vault: NoormVaultTable;

}

/**
 * Prefixed database interface for sqlite/mysql.
 *
 * Used directly — table names have __noorm_ prefix.
 */
export interface NoormPrefixDb {

    __noorm_version__: NoormVersionTable;
    __noorm_change__: NoormChangeTable;
    __noorm_executions__: NoormExecutionsTable;
    __noorm_lock__: NoormLockTable;
    __noorm_identities__: NoormIdentitiesTable;
    __noorm_vault__: NoormVaultTable;

}

/**
 * Combined database interface for all noorm tracking tables.
 *
 * Intersection of schema-qualified (pg/mssql) and prefixed (sqlite/mysql)
 * interfaces. Both key sets are valid — use getNoormTables(dialect) to get
 * the correct keys for your dialect.
 *
 * @example
 * ```typescript
 * const tables = getNoormTables(dialect);
 * const ndb = noormDb(db, dialect);
 * await ndb.selectFrom(tables.change).selectAll().execute();
 * ```
 */
export type NoormDatabase = NoormSchemaDb & NoormPrefixDb;
