/**
 * SDK Types.
 *
 * All interfaces and types for the noorm programmatic SDK.
 */
import type { Transaction } from 'kysely';

import type { Channel } from '../core/policy/index.js';
import type { ConflictStrategy } from '../core/transfer/types.js';
import type { ConnectionConfig, DialectConnectionConfig, RuntimeConnectionOptions } from '../core/connection/types.js';


// ─────────────────────────────────────────────────────────────
// Factory Options
// ─────────────────────────────────────────────────────────────

/**
 * Inline connection fields plus the runtime-only ones a stored config cannot hold.
 * Distributes over `C` so a per-dialect config union keeps each member's own fields.
 *
 * @example
 * ```typescript
 * const connection: InlineConnection<DialectConnectionConfig> = {
 *     dialect: 'postgres',
 *     database: 'app',
 *     password: () => fetchToken(),
 *     driver: { keepAliveInitialDelayMillis: 10_000 },
 * }
 * ```
 */
export type InlineConnection<C extends ConnectionConfig> = C extends ConnectionConfig
    ? Omit<Partial<C>, 'password' | 'ssl'> & {
        password?: string | RuntimeConnectionOptions['password'];
        ssl?: boolean | (Exclude<C['ssl'], boolean | undefined> & {
            checkServerIdentity?: RuntimeConnectionOptions['checkServerIdentity'];
        });

        /** Options merged into the database driver's own. Not stored, resolved, or put in noorm's events; a driver's own error can quote a value. */
        driver?: Record<string, unknown>;
    }
    : never;

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
     * Config name from state, or `false` to use no stored config.
     *
     * If omitted:
     * - Uses `NOORM_CONFIG` env var if set
     * - Uses the active stored config only when `connection` is absent
     * - Otherwise resolves inline or environment-only connection fields
     *
     * `false` ignores `NOORM_CONFIG` and the active config, so no stored config is used.
     * Stage defaults still apply through `stage` and `NOORM_NAME`, and so do `NOORM_isTest`,
     * `NOORM_ACCESS_*` and the `NOORM_CONNECTION_*` env vars.
     */
    config?: string | false;

    /**
     * Name of a context that uses no stored config. Wins over `NOORM_NAME`.
     *
     * The name is a key, not only a label: it is `configName` on events, and it keys change
     * history, run checksums, locks, pipeline history and local secrets. Reopening a database
     * under another name makes applied changes pending and builds run again, so pick one name
     * per database and keep it.
     *
     * Throws when a stored config is selected or has this name. A stage with this name still
     * applies its protected ceiling and its `isTest: false`; its defaults need `stage`.
     */
    name?: string;

    /** Non-persisted connection overrides, applied after environment settings. */
    connection?: InlineConnection<DialectConnectionConfig>;

    /** Project root directory. Defaults to process.cwd() */
    projectRoot?: string;

    /** Resolve state and settings from independent disk snapshots for this context. */
    freshState?: boolean;

    /** Refuse if config.isTest !== true. Default: false */
    requireTest?: boolean;

    /** Stage name for stage defaults (from settings.yml) */
    stage?: string;

    /**
     * Who this context acts for, for access-policy checks (`checkPolicy` in
     * `src/sdk/guards.ts`). A human driving the SDK/CLI/TUI is `user`; pass
     * `'agent'` when an AI agent is driving, whichever transport it reached
     * for. Default: `'user'`.
     */
    channel?: Channel;

    /**
     * Pre-confirm operations that a policy `confirm` cell would otherwise
     * block — the programmatic equivalent of the CLI's --yes. Only
     * meaningful on the user channel; `agent` collapses confirm to deny
     * before this is consulted, so an agent cannot use it to walk through
     * a gate a human was meant to answer. Default: false.
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

    /** Render files without executing them. Default: false */
    dryRun?: boolean;

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
    onConflict?: ConflictStrategy;

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

/**
 * Typed stored-procedure, function, and table-valued-function calls,
 * keyed off a context's `Procs`/`Funcs`/`Tvfs` maps. Shared by `Context`,
 * the transaction handle, and the impersonated scope so all three match
 * signature for signature.
 *
 * @example
 * ```typescript
 * function rebuild(calls: RoutineCalls<MyProcs>) {
 *     return calls.proc('rebuild_ledger', { id: 1 });
 * }
 * ```
 */
export interface RoutineCalls<Procs = object, Funcs = object, Tvfs = object> {
    proc: <
        N extends keyof Procs & string = keyof Procs & string,
        T = ExtractReturn<Procs[N]>,
    >(
        name: N,
        ...args: ExtractArgs<Procs[N]> extends void ? [] : [params: ExtractArgs<Procs[N]>]
    ) => Promise<T[]>;
    func: <
        N extends keyof Funcs & string = keyof Funcs & string,
        T = ExtractReturn<Funcs[N]>,
    >(
        name: N,
        ...args: ExtractArgs<Funcs[N]> extends void ? [column: string] : [params: ExtractArgs<Funcs[N]>, column: string]
    ) => Promise<T>;
    tvf: <
        N extends keyof Tvfs & string = keyof Tvfs & string,
        T = ExtractReturn<Tvfs[N]>,
    >(
        name: N,
        ...args: ExtractArgs<Tvfs[N]> extends void ? [] : [params: ExtractArgs<Tvfs[N]>]
    ) => Promise<T[]>;
}

/**
 * The handle `ctx.transaction(fn)` passes to `fn`: Kysely's own
 * `Transaction<DB>` with routine calls bound to the transaction's
 * connection, so a `SET LOCAL` issued with `sql` applies to them.
 *
 * @example
 * ```typescript
 * await ctx.transaction(async (trx) => {
 *     await sql`SET LOCAL statement_timeout = '8s'`.execute(trx);
 *     return trx.tvf('search_ledger', { q: 'x' });
 * });
 * ```
 */
export type TransactionScope<DB = unknown, Procs = object, Funcs = object, Tvfs = object> =
    Transaction<DB> & RoutineCalls<Procs, Funcs, Tvfs>;
