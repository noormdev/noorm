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
import type { Generated, Insertable, Selectable, Updateable } from 'kysely';

// ─────────────────────────────────────────────────────────────
// Table Names
// ─────────────────────────────────────────────────────────────

/**
 * Noorm tracking table names.
 *
 * Use these constants instead of hardcoding table names.
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
});

/**
 * Type for table names.
 */
export type NoormTableName = (typeof NOORM_TABLES)[keyof typeof NOORM_TABLES];

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
}

export type NoormIdentity = Selectable<NoormIdentitiesTable>;
export type NewNoormIdentity = Insertable<NoormIdentitiesTable>;
export type NoormIdentityUpdate = Updateable<NoormIdentitiesTable>;

// ─────────────────────────────────────────────────────────────
// Combined Database Interface
// ─────────────────────────────────────────────────────────────

/**
 * Combined database interface for all noorm tracking tables.
 *
 * Use this with Kysely<NoormDatabase> for type-safe queries.
 *
 * @example
 * ```typescript
 * import { NoormDatabase, NOORM_TABLES } from './shared'
 *
 * const db = new Kysely<NoormDatabase>({ dialect })
 *
 * const version = await db
 *     .selectFrom(NOORM_TABLES.version)
 *     .selectAll()
 *     .orderBy('id', 'desc')
 *     .limit(1)
 *     .executeTakeFirst()
 * ```
 */
export interface NoormDatabase {
    __noorm_version__: NoormVersionTable;
    __noorm_change__: NoormChangeTable;
    __noorm_executions__: NoormExecutionsTable;
    __noorm_lock__: NoormLockTable;
    __noorm_identities__: NoormIdentitiesTable;
}
