/**
 * Database lifecycle types.
 *
 * Types for database creation, destruction, and status checking.
 */
import type { ConnectionConfig } from '../connection/types.js';

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
}

/**
 * Options for database destruction.
 */
export interface DestroyDbOptions {
    /** Only reset tracking, don't drop database (default: true) */
    trackingOnly?: boolean;

    /** Force drop even if database has data (default: false) */
    force?: boolean;
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
