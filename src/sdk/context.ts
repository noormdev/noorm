/**
 * SDK Context Implementation.
 *
 * The Context class provides SQL-focused programmatic access to the
 * database. Noorm-specific operations (schema, changes, locks, etc.)
 * live behind the ctx.noorm namespace via NoormOps.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import type { Dialect } from '../core/connection/index.js';
import type { Config } from '../core/config/types.js';
import type { Settings } from '../core/settings/index.js';
import type { Identity } from '../core/identity/index.js';
import { createConnection } from '../core/connection/index.js';
import type { ConnectionRetryOptions } from '../core/connection/index.js';

import { callProc, callFunc, callTvf, qualifyName, withRoutines } from './routines.js';
import { NoormOps } from './noorm-ops.js';
import type { ContextState } from './state.js';
import { requireConnection } from './state.js';
import type { CreateContextOptions, ExtractArgs, ExtractReturn, RoutineCalls, TransactionScope } from './types.js';
import { dialectStrategy, validateUsername } from './impersonate/dialect-strategy.js';
import { buildScope } from './impersonate/scope.js';
import { ImpersonationError } from './impersonate/types.js';
import type { ImpersonatedScope } from './impersonate/types.js';

// ─────────────────────────────────────────────────────────────
// Schema Name Validation
// ─────────────────────────────────────────────────────────────

const VALID_SCHEMA_NAME = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate a schema name against a restrictive character set.
 *
 * Defense-in-depth before the name is interpolated into `${schema}.${name}`
 * ahead of dialect quoting (quoteIdent, src/sdk/sql.ts) — same allow-list
 * posture as impersonate's validateUsername (dialect-strategy.ts). Hyphens
 * are allowed — hyphenated schema names exist in the wild, and Kysely's
 * `withSchema()` and `quoteIdent` both quote the identifier, so a hyphen is
 * inert everywhere it's used. Dots are rejected (unlike usernames) because a
 * schema name containing one would be mis-split by quoteIdent's
 * split-on-first-`.` qualification logic.
 */
function validateSchemaName(name: string): void {

    if (!name || !VALID_SCHEMA_NAME.test(name)) {

        throw new Error(
            `Invalid schema name: "${name}". ` +
            'Only alphanumeric characters, underscores, and hyphens are allowed.',
        );

    }

}

// ─────────────────────────────────────────────────────────────
// Context Class
// ─────────────────────────────────────────────────────────────

/**
 * SDK Context implementation.
 *
 * Provides SQL-focused programmatic access to the database.
 * Noorm management operations are accessible via ctx.noorm.
 *
 * @example
 * ```typescript
 * const ctx = await createContext({ config: 'dev' })
 * await ctx.connect()
 *
 * // Top-level — SQL focused
 * const users = await ctx.kysely
 *     .selectFrom('users')
 *     .selectAll()
 *     .execute()
 *
 * // Noorm operations — under namespace
 * await ctx.noorm.run.build()
 * await ctx.noorm.changes.ff()
 *
 * await ctx.disconnect()
 * ```
 */
export class Context<DB = unknown, Procs = object, Funcs = object, Tvfs = object> implements RoutineCalls<Procs, Funcs, Tvfs> {

    #state: ContextState;
    #noorm: NoormOps | null = null;

    /**
     * Release callbacks for explicit-mode impersonation scopes still holding a
     * pooled connection. `disconnect()` drains these first — otherwise a
     * caller who never reverted leaves `destroy()` awaiting a connection the
     * pool can never reclaim, and the context never closes.
     */
    #heldConnections = new Set<() => void>();

    /**
     * Schema this context is scoped to, or `null` for the root context.
     * Set once by withSchema() and never mutated afterward — a chained
     * withSchema() call derives a new Context rather than changing this.
     */
    #schema: string | null = null;

    constructor(
        config: Config,
        settings: Settings,
        identity: Identity,
        options: CreateContextOptions,
        projectRoot: string,
    ) {

        this.#state = {
            connection: null,
            config,
            settings,
            identity,
            options,
            projectRoot,
            changeManager: null,
        };

    }

    // ─────────────────────────────────────────────────────────
    // Read-only Properties
    // ─────────────────────────────────────────────────────────

    get dialect(): Dialect {

        return this.#state.config.connection.dialect;

    }

    get connected(): boolean {

        return this.#state.connection !== null;

    }

    get kysely(): Kysely<DB> {

        const db = requireConnection(this.#state).db as Kysely<DB>;

        // Re-derived on every access rather than cached: caching the wrapped
        // instance would let a stale schema wrap survive a reconnect, and
        // would make chained withSchema() calls stack instead of replace.
        return this.#schema === null ? db : db.withSchema(this.#schema);

    }

    // ─────────────────────────────────────────────────────────
    // Schema Scoping
    // ─────────────────────────────────────────────────────────

    /**
     * Derive a schema-scoped Context sharing this context's connection,
     * pool, and #heldConnections — same lifecycle, fresh generics for the
     * schema's own table/routine shape.
     *
     * Replaces rather than stacks: calling withSchema() again on an
     * already-derived context swaps the schema instead of nesting it,
     * because every derived context re-derives its `.kysely` from the
     * shared connection's bare instance, never from another derived
     * context's already-wrapped one.
     *
     * `sql`-tagged raw fragments are not rewritten by this — they resolve
     * against the connection's default schema regardless of this call.
     *
     * @throws Error synchronously if `name` fails identifier validation,
     * before any connection is borrowed or shared state is touched.
     *
     * @example
     * ```typescript
     * const acct = ctx.withSchema<AcctDB>('acct');
     * const rows = await acct.kysely.selectFrom('ledger').selectAll().execute();
     * await acct.proc('rebuild_ledger', { id: 1 }); // -> acct.rebuild_ledger
     * ```
     */
    withSchema<SDB = DB, SProcs = Procs, SFuncs = Funcs, STvfs = Tvfs>(
        name: string,
    ): Context<SDB, SProcs, SFuncs, STvfs> {

        validateSchemaName(name);

        const derived = new Context<SDB, SProcs, SFuncs, STvfs>(
            this.#state.config,
            this.#state.settings,
            this.#state.identity,
            this.#state.options,
            this.#state.projectRoot,
        );

        derived.#state = this.#state;
        derived.#heldConnections = this.#heldConnections;
        derived.#schema = name;

        return derived;

    }

    // ─────────────────────────────────────────────────────────
    // Noorm Namespace
    // ─────────────────────────────────────────────────────────

    /**
     * Noorm management operations.
     *
     * Lazily instantiated on first access. Returns the same instance
     * on repeated access (singleton per Context).
     *
     * @example
     * ```typescript
     * await ctx.noorm.run.build()
     * await ctx.noorm.changes.ff()
     * const tables = await ctx.noorm.db.listTables()
     * ```
     */
    get noorm(): NoormOps {

        if (!this.#noorm) {

            this.#noorm = new NoormOps(this.#state);

        }

        return this.#noorm;

    }

    // ─────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────

    /**
     * Connect to the configured database.
     *
     * `retryOptions` defaults to the standard 3-attempt backoff. Pass
     * `{ retries: 1, delay: 0 }` for a best-effort probe that must fail
     * fast rather than hang on an unreachable database.
     */
    async connect(retryOptions?: ConnectionRetryOptions): Promise<void> {

        if (this.#state.connection) return;

        this.#state.connection = await createConnection(
            this.#state.config.connection,
            this.#state.config.name,
            retryOptions,
        );

    }

    async disconnect(): Promise<void> {

        if (!this.#state.connection) return;

        // Release before destroy, not after: destroy() waits for the pool to
        // drain, and an un-reverted scope holds a connection out of it
        // indefinitely. The revert SQL is skipped deliberately — the pool is
        // being torn down, so there is no later query to inherit the identity.
        for (const release of this.#heldConnections) release();

        this.#heldConnections.clear();

        await this.#state.connection.destroy();
        this.#state.connection = null;
        this.#state.changeManager = null;

    }

    // ─────────────────────────────────────────────────────────
    // Transactions
    // ─────────────────────────────────────────────────────────

    /**
     * Execute operations within a database transaction.
     *
     * The callback receives a full Kysely Transaction instance with
     * query builder, `sql` template literal, and all Kysely features,
     * plus `proc`/`func`/`tvf` running on the transaction's connection.
     *
     * @example
     * ```typescript
     * await ctx.transaction(async (trx) => {
     *     await trx
     *         .updateTable('accounts')
     *         .set({ balance: sql`balance - ${amount}` })
     *         .where('id', '=', fromId)
     *         .execute();
     *     await trx
     *         .updateTable('accounts')
     *         .set({ balance: sql`balance + ${amount}` })
     *         .where('id', '=', toId)
     *         .execute();
     * });
     *
     * // Routines see transaction-scoped settings
     * const rows = await ctx.transaction(async (trx) => {
     *     await sql`SET LOCAL statement_timeout = '8s'`.execute(trx);
     *     return trx.tvf('search_ledger', { q: term });
     * });
     * ```
     */
    async transaction<T>(fn: (trx: TransactionScope<DB, Procs, Funcs, Tvfs>) => Promise<T>): Promise<T> {

        return this.kysely.transaction().execute((trx) => fn(withRoutines(trx, this.dialect, this.#schema)));

    }

    // ─────────────────────────────────────────────────────────
    // Stored Procedures & Functions
    // ─────────────────────────────────────────────────────────

    /**
     * Call a stored procedure and return the result set.
     *
     * Generates dialect-specific SQL: EXEC (MSSQL), CALL (PG/MySQL).
     * Named params use dialect-appropriate syntax; MySQL falls back
     * to positional. SQLite throws — no procedure support.
     *
     * @example
     * ```typescript
     * // Return type inferred from tuple definition
     * const users = await ctx.proc('get_users', { department_id: 1 });
     *
     * // Explicit return type override
     * const users = await ctx.proc<'get_users', SpecialUser>('get_users', { department_id: 1 });
     *
     * // Positional params
     * await ctx.proc('simple_proc', [42, 'hello']);
     *
     * // No params
     * await ctx.proc('refresh_cache');
     * ```
     */
    async proc<
        N extends keyof Procs & string = keyof Procs & string,
        T = ExtractReturn<Procs[N]>,
    >(
        name: N,
        ...args: ExtractArgs<Procs[N]> extends void ? [] : [params: ExtractArgs<Procs[N]>]
    ): Promise<T[]> {

        return callProc<T, DB>(() => this.kysely, this.dialect, qualifyName(this.#schema, name), args);

    }

    /**
     * Call a database function and return the scalar result.
     *
     * Generates SELECT name(...) AS column. Named params only on PG;
     * other dialects fall back to positional. SQLite throws.
     *
     * @example
     * ```typescript
     * // Return type inferred from tuple definition
     * const result = await ctx.func('calc_total', { order_id: 42 }, 'total');
     *
     * // Explicit return type override
     * const result = await ctx.func<'calc_total', { total: number }>('calc_total', { order_id: 42 }, 'total');
     *
     * // No params — just column alias
     * const ver = await ctx.func('get_version', 'v');
     * ```
     */
    async func<
        N extends keyof Funcs & string = keyof Funcs & string,
        T = ExtractReturn<Funcs[N]>,
    >(
        name: N,
        ...args: ExtractArgs<Funcs[N]> extends void ? [column: string] : [params: ExtractArgs<Funcs[N]>, column: string]
    ): Promise<T> {

        return callFunc<T, DB>(() => this.kysely, this.dialect, qualifyName(this.#schema, name), args);

    }

    // ─────────────────────────────────────────────────────────
    // Table-Valued Functions
    // ─────────────────────────────────────────────────────────

    /**
     * Call a table-valued function and return the result set.
     *
     * Generates SELECT * FROM name(...) with dialect-specific parameter
     * syntax. Returns multiple rows, unlike func() which returns a scalar.
     * Only supported on MSSQL and PostgreSQL — MySQL and SQLite throw.
     *
     * @example
     * ```typescript
     * // Return type inferred from tuple definition
     * const sessions = await ctx.tvf('validate_session', { session_key: key });
     *
     * // Explicit return type override
     * const sessions = await ctx.tvf<'validate_session', SpecialSession>('validate_session', { session_key: key });
     *
     * // No params
     * const items = await ctx.tvf('get_active_items');
     * ```
     */
    async tvf<
        N extends keyof Tvfs & string = keyof Tvfs & string,
        T = ExtractReturn<Tvfs[N]>,
    >(
        name: N,
        ...args: ExtractArgs<Tvfs[N]> extends void ? [] : [params: ExtractArgs<Tvfs[N]>]
    ): Promise<T[]> {

        return callTvf<T, DB>(() => this.kysely, this.dialect, qualifyName(this.#schema, name), args);

    }

    // ─────────────────────────────────────────────────────────
    // Impersonation
    // ─────────────────────────────────────────────────────────

    /**
     * Execute queries as a specific database principal.
     *
     * Borrows a dedicated connection from the pool, switches identity
     * via dialect-specific SQL, and provides a scoped query interface.
     * Two modes: callback (auto-reverts) and explicit (caller reverts).
     *
     * @example
     * ```typescript
     * // Callback mode — auto-reverts, even on throw
     * const result = await ctx.impersonate('username', async (scope) => {
     *     return scope.kysely.selectFrom('users').selectAll().execute();
     * });
     *
     * // Explicit mode — caller owns lifecycle
     * const scope = await ctx.impersonate('username');
     * const users = await scope.kysely.selectFrom('users').selectAll().execute();
     * await scope.revert();
     * ```
     */
    async impersonate<T>(
        username: string,
        fn: (scope: ImpersonatedScope<DB, Procs, Funcs, Tvfs>) => Promise<T>,
    ): Promise<T>;
    async impersonate(
        username: string,
    ): Promise<ImpersonatedScope<DB, Procs, Funcs, Tvfs>>;
    async impersonate<T>(
        username: string,
        fn?: (scope: ImpersonatedScope<DB, Procs, Funcs, Tvfs>) => Promise<T>,
    ): Promise<T | ImpersonatedScope<DB, Procs, Funcs, Tvfs>> {

        // === Validation block ===
        const strategy = dialectStrategy[this.dialect];

        if (!strategy) {

            throw new ImpersonationError(
                `Impersonation is not supported for the ${this.dialect} dialect.`,
            );

        }

        validateUsername(username);

        // === Business logic block ===
        const impersonateSql = strategy.impersonate(username);
        const revertSql = strategy.revert();

        if (fn) {

            return this.#impersonateCallback(impersonateSql, revertSql, fn);

        }

        return this.#impersonateExplicit(impersonateSql, revertSql);

    }

    async #impersonateCallback<T>(
        impersonateSql: string,
        revertSql: string,
        fn: (scope: ImpersonatedScope<DB, Procs, Funcs, Tvfs>) => Promise<T>,
    ): Promise<T> {

        return this.kysely.connection().execute(async (db) => {

            await sql.raw(impersonateSql).execute(db);

            const scope = buildScope<DB, Procs, Funcs, Tvfs>(db, async () => {

                await sql.raw(revertSql).execute(db);

            }, this.dialect);

            try {

                return await fn(scope);

            }
            finally {

                await sql.raw(revertSql).execute(db);

            }

        });

    }

    async #impersonateExplicit(
        impersonateSql: string,
        revertSql: string,
    ): Promise<ImpersonatedScope<DB, Procs, Funcs, Tvfs>> {

        // === Declaration block ===
        let resolveHolder!: () => void;
        const connectionHeld = new Promise<void>(resolve => {

            resolveHolder = resolve;

        });

        let resolveReady!: (scope: ImpersonatedScope<DB, Procs, Funcs, Tvfs>) => void;
        let rejectReady!: (err: unknown) => void;
        const ready = new Promise<ImpersonatedScope<DB, Procs, Funcs, Tvfs>>((resolve, reject) => {

            resolveReady = resolve;
            rejectReady = reject;

        });

        // Registered so disconnect() can release a scope the caller never
        // reverted. Removed on a successful revert so the set only ever holds
        // connections that are genuinely still out.
        const release = () => resolveHolder();

        this.#heldConnections.add(release);

        // === Business logic block ===
        const connectionDone = this.kysely.connection().execute(async (db) => {

            await sql.raw(impersonateSql).execute(db);

            const scope = buildScope<DB, Procs, Funcs, Tvfs>(db, async () => {

                await sql.raw(revertSql).execute(db);
                this.#heldConnections.delete(release);
                resolveHolder();

            }, this.dialect);

            resolveReady(scope);

            await connectionHeld;

        });

        connectionDone.catch(err => {

            // The connection never became a usable scope, so there is nothing
            // for disconnect() to release.
            this.#heldConnections.delete(release);
            rejectReady(err);

        });

        // === Commit block ===
        return ready;

    }

}
