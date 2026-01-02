/**
 * Teardown Types
 *
 * Types for database reset and teardown operations.
 * Supports data wipe (truncate) and schema teardown (drop).
 */

/**
 * Options for truncating table data.
 *
 * @example
 * ```typescript
 * // Truncate all tables except preserved ones from settings
 * await truncateData(db, 'postgres', {
 *     preserve: ['AppSettings', 'UserRoles'],
 *     restartIdentity: true,
 * })
 *
 * // Truncate only specific tables
 * await truncateData(db, 'postgres', {
 *     only: ['users', 'posts'],
 * })
 * ```
 */
export interface TruncateOptions {

    /** Tables to preserve (won't be truncated) */
    preserve?: string[];

    /** If set, only truncate these tables (inverse of preserve) */
    only?: string[];

    /** Restart identity/auto-increment sequences (default: true) */
    restartIdentity?: boolean;

    /** Dry run - return SQL without executing */
    dryRun?: boolean;

}

/**
 * Options for schema teardown.
 *
 * @example
 * ```typescript
 * // Drop everything except noorm tables
 * await teardownSchema(db, 'postgres', {
 *     dryRun: true,  // Preview first
 * })
 *
 * // Keep enums but drop everything else
 * await teardownSchema(db, 'postgres', {
 *     keepTypes: true,
 *     postScript: 'schema/teardown/cleanup.sql',
 * })
 * ```
 */
export interface TeardownOptions {

    /** Additional tables to preserve beyond __noorm_* tables */
    preserveTables?: string[];

    /** Keep views (default: false) */
    keepViews?: boolean;

    /** Keep functions/procedures (default: false) */
    keepFunctions?: boolean;

    /** Keep types/enums (default: false) */
    keepTypes?: boolean;

    /** SQL script path to run after teardown */
    postScript?: string;

    /** Dry run - return SQL without executing */
    dryRun?: boolean;

    /**
     * Config name for changeset tracking.
     * When provided, marks all successful changesets as 'stale' and
     * records a reset event in the changeset history.
     */
    configName?: string;

    /**
     * Identity of who performed the teardown.
     * Required when configName is provided.
     */
    executedBy?: string;

}

/**
 * Result of a truncate operation.
 */
export interface TruncateResult {

    /** Tables that were truncated */
    truncated: string[];

    /** Tables that were preserved */
    preserved: string[];

    /** SQL statements executed (or would execute in dry-run) */
    statements: string[];

    /** Duration in milliseconds */
    durationMs: number;

}

/**
 * Result of a teardown operation.
 */
export interface TeardownResult {

    /** Objects dropped by category */
    dropped: {
        tables: string[];
        views: string[];
        functions: string[];
        types: string[];
        foreignKeys: string[];
    };

    /** Objects preserved */
    preserved: string[];

    /** SQL statements executed (or would execute in dry-run) */
    statements: string[];

    /** Duration in milliseconds */
    durationMs: number;

    /** Post-script execution result (if any) */
    postScriptResult?: {
        executed: boolean;
        error?: string;
    };

    /** Number of changesets marked as stale (if configName provided) */
    staleCount?: number;

    /** ID of the reset record created (if configName provided) */
    resetRecordId?: number;

}

/**
 * Preview of what would be affected by teardown.
 */
export interface TeardownPreview {

    /** Objects that would be dropped */
    toDrop: {
        tables: string[];
        views: string[];
        functions: string[];
        types: string[];
        foreignKeys: string[];
    };

    /** Objects that would be preserved */
    toPreserve: string[];

    /** SQL statements that would execute */
    statements: string[];

}

/**
 * Dialect-specific teardown operations interface.
 */
export interface TeardownDialectOperations {

    /**
     * Generate SQL to disable FK checks.
     */
    disableForeignKeyChecks(): string;

    /**
     * Generate SQL to re-enable FK checks.
     */
    enableForeignKeyChecks(): string;

    /**
     * Generate SQL to truncate a table.
     *
     * @param tableName - Table to truncate
     * @param schema - Optional schema name
     * @param restartIdentity - Reset auto-increment
     */
    truncateTable(tableName: string, schema?: string, restartIdentity?: boolean): string;

    /**
     * Generate SQL to drop a table.
     *
     * @param tableName - Table to drop
     * @param schema - Optional schema name
     */
    dropTable(tableName: string, schema?: string): string;

    /**
     * Generate SQL to drop a view.
     *
     * @param viewName - View to drop
     * @param schema - Optional schema name
     */
    dropView(viewName: string, schema?: string): string;

    /**
     * Generate SQL to drop a function or procedure.
     *
     * @param name - Function/procedure name
     * @param schema - Optional schema name
     */
    dropFunction(name: string, schema?: string): string;

    /**
     * Generate SQL to drop a type.
     *
     * @param typeName - Type to drop
     * @param schema - Optional schema name
     */
    dropType(typeName: string, schema?: string): string;

    /**
     * Generate SQL to drop a foreign key constraint.
     *
     * @param constraintName - Constraint name
     * @param tableName - Table the constraint is on
     * @param schema - Optional schema name
     */
    dropForeignKey(constraintName: string, tableName: string, schema?: string): string;

}
