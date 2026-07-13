/**
 * SDK Types.
 *
 * All interfaces and types for the noorm programmatic SDK.
 */
import type { Channel } from '../core/policy/index.js';


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

    /** Stage name for stage defaults (from settings.yml) */
    stage?: string;

    /**
     * Which caller channel this context represents for access-policy checks
     * (`checkPolicy` in `src/sdk/guards.ts`). SDK/CLI/TUI callers are `user`;
     * pass `'mcp'` when the context backs an MCP session. Default: `'user'`.
     */
    channel?: Channel;

    /**
     * Pre-confirm operations that a policy `confirm` cell would otherwise
     * block — the programmatic equivalent of the CLI's --yes. Only
     * meaningful on the user channel; mcp collapses confirm to deny
     * before this is consulted. Default: false.
     */
    yes?: boolean;

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
 * const result = await ctx.noorm.dt.exportTable('users', './exports/users.dtz', {
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
 * const result = await ctx.noorm.dt.importFile('./exports/users.dtz', {
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

// ─────────────────────────────────────────────────────────────
// Proc / Func / TVF Tuple Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Extract the args type from a proc/func/tvf entry.
 *
 * Supports tuple form `[Args, Return]` and plain `void`.
 * Non-tuple entries pass through as-is for backward compat.
 *
 * @example
 * ```typescript
 * ExtractArgs<[{ id: number }, User]>  // { id: number }
 * ExtractArgs<void>                    // void
 * ```
 */
export type ExtractArgs<E> = E extends [infer A, unknown] ? A : E;

/**
 * Extract the return type from a proc/func/tvf entry.
 *
 * Returns the second element of a `[Args, Return]` tuple.
 * Falls back to `unknown` for `void` or non-tuple entries.
 *
 * @example
 * ```typescript
 * ExtractReturn<[{ id: number }, User]>  // User
 * ExtractReturn<void>                    // unknown
 * ```
 */
export type ExtractReturn<E> = E extends [unknown, infer R] ? R : unknown;
