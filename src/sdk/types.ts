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
// SQL Execution Types
// ─────────────────────────────────────────────────────────────

/**
 * Result of an execute() call.
 */
export interface ExecuteResult {

    /** Number of rows affected (if available) */
    rowsAffected?: number;

}

/**
 * Transaction context for use within transaction callbacks.
 *
 * @example
 * ```typescript
 * await ctx.transaction(async (tx) => {
 *     const [user] = await tx.query('SELECT * FROM users WHERE id = $1', [id])
 *     await tx.execute('UPDATE users SET login_count = login_count + 1 WHERE id = $1', [id])
 *     return user
 * })
 * ```
 */
export interface TransactionContext {

    /**
     * Execute a SELECT query within the transaction.
     */
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

    /**
     * Execute an INSERT/UPDATE/DELETE within the transaction.
     */
    execute(sql: string, params?: unknown[]): Promise<ExecuteResult>;

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
