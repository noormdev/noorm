/**
 * SDK Types.
 *
 * All interfaces and types for the noorm programmatic SDK.
 */


// ─────────────────────────────────────────────────────────────
// Factory Options
// ─────────────────────────────────────────────────────────────

/**
 * Options for creating an SDK context.
 *
 * @example
 * ```typescript
 * // Basic usage with stored config
 * const ctx = await createContext({ config: 'dev' })
 *
 * // Require test database for safety
 * const ctx = await createContext({
 *     config: 'test',
 *     requireTest: true,
 * })
 *
 * // Allow destructive ops on protected config
 * const ctx = await createContext({
 *     config: 'staging',
 *     allowProtected: true,
 * })
 *
 * // Env-only mode (CI/CD) - no stored config needed
 * // Requires NOORM_CONNECTION_DIALECT and NOORM_CONNECTION_DATABASE
 * const ctx = await createContext()
 *
 * // Override stored config via NOORM_* env vars
 * // NOORM_CONNECTION_HOST=override.host
 * const ctx = await createContext({ config: 'prod' })
 * ```
 */
export interface CreateContextOptions {

    /**
     * Config name from state.
     *
     * If omitted:
     * - Uses `NOORM_CONFIG` env var if set
     * - Falls back to env-only mode if `NOORM_CONNECTION_DIALECT`
     *   and `NOORM_CONNECTION_DATABASE` are set
     */
    config?: string;

    /** Project root directory. Defaults to process.cwd() */
    projectRoot?: string;

    /** Refuse if config.isTest !== true. Default: false */
    requireTest?: boolean;

    /** Allow destructive ops on protected configs. Default: false */
    allowProtected?: boolean;

    /** Stage name for stage defaults (from settings.yml) */
    stage?: string;

}

// ─────────────────────────────────────────────────────────────
// Build Options
// ─────────────────────────────────────────────────────────────

/**
 * Options for build operations.
 */
export interface BuildOptions {

    /** Skip checksum checks, rebuild everything. Default: false */
    force?: boolean;

}

// ─────────────────────────────────────────────────────────────
// DT Export/Import Options
// ─────────────────────────────────────────────────────────────

/**
 * Options for exporting a table to a .dt file.
 *
 * Connection details (db, dialect) come from the context automatically.
 *
 * @example
 * ```typescript
 * const [result, err] = await ctx.exportTable('users', './exports/users.dtz', {
 *     passphrase: 'secret',
 *     batchSize: 5000,
 * });
 * ```
 */
export interface ExportOptions {

    /** Passphrase for .dtzx encryption. */
    passphrase?: string;

    /** Schema/namespace (e.g., 'public' for PostgreSQL). */
    schema?: string;

    /** Rows per batch. Default: 1000. */
    batchSize?: number;

}

/**
 * Options for importing a .dt file into the database.
 *
 * Connection details (db, dialect) come from the context automatically.
 *
 * @example
 * ```typescript
 * const [result, err] = await ctx.importFile('./exports/users.dtz', {
 *     onConflict: 'skip',
 *     truncate: true,
 * });
 * ```
 */
export interface ImportOptions {

    /** Passphrase for .dtzx decryption. */
    passphrase?: string;

    /** Rows per batch. Default: 1000. */
    batchSize?: number;

    /** Conflict strategy. Default: 'fail'. */
    onConflict?: 'fail' | 'skip' | 'update' | 'replace';

    /** Truncate target table before import. Default: false. */
    truncate?: boolean;

}
