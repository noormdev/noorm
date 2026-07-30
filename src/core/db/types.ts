/**
 * Database lifecycle types.
 *
 * Types for database creation, destruction, and status checking.
 */
import type { ConnectionConfig } from '../connection/types.js';
import type { DbPolicyContext } from './policy.js';

/**
 * Result of checking database status.
 */
export interface DbStatus {
    /** Server is reachable */
    serverOk: boolean;

    /** Target database exists */
    exists: boolean;

    /** Noorm tracking tables exist */
    trackingInitialized: boolean;

    /** Error message if check failed */
    error?: string;
}

/**
 * Result of a database operation.
 */
export interface DbOperationResult {
    /** Whether the operation succeeded */
    ok: boolean;

    /** Error message if failed */
    error?: string;

    /** Whether the database was created (vs already existed) */
    created?: boolean;

    /** Whether the database was dropped (vs never having existed) */
    dropped?: boolean;

    /** Whether tracking was initialized (vs already existed) */
    trackingInitialized?: boolean;
}

/**
 * Options for database creation.
 */
export interface CreateDbOptions {
    /** Skip if database already exists (default: true) */
    ifNotExists?: boolean;

    /** Initialize noorm tracking tables (default: true) */
    initializeTracking?: boolean;

    /**
     * Reuse a status already computed by the caller instead of calling
     * `checkDbStatus` again internally. For SQLite, a caller's own probe
     * already touched the target file (opening a connection auto-creates
     * it), so a second internal check would see a false "already exists".
     */
    precheckedStatus?: DbStatus;

    /**
     * Access policy to enforce before creating. Omitted by callers that
     * already ran an equivalent gate; supplied by every caller that owns
     * none, so the check cannot be forgotten per surface.
     */
    policy?: DbPolicyContext;
}

/**
 * Options for database destruction.
 */
export interface DestroyDbOptions {
    /**
     * Access policy to enforce before dropping. See {@link CreateDbOptions.policy}.
     */
    policy?: DbPolicyContext;
}

/**
 * Dialect-specific database operations.
 */
export interface DialectDbOperations {
    /**
     * Check if a database exists.
     */
    databaseExists(config: ConnectionConfig, dbName: string): Promise<boolean>;

    /**
     * Create a database.
     */
    createDatabase(config: ConnectionConfig, dbName: string): Promise<void>;

    /**
     * Drop a database.
     */
    dropDatabase(config: ConnectionConfig, dbName: string): Promise<void>;

    /**
     * Get the system database name for this dialect.
     */
    getSystemDatabase(): string | undefined;
}
