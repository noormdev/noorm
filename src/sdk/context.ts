/**
 * SDK Context Implementation.
 *
 * The Context class provides SQL-focused programmatic access to the
 * database. Noorm-specific operations (schema, changes, locks, etc.)
 * live behind the ctx.noorm namespace via NoormOps.
 */
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';

import type { Dialect } from '../core/connection/index.js';
import type { Config } from '../core/config/types.js';
import type { Settings } from '../core/settings/index.js';
import type { Identity } from '../core/identity/index.js';
import { createConnection } from '../core/connection/index.js';

import { buildProcCall, buildFuncCall, buildTvfCall } from './sql.js';
import { NoormOps } from './noorm-ops.js';
import type { ContextState } from './state.js';
import { requireConnection } from './state.js';
import type { CreateContextOptions, ExtractArgs, ExtractReturn } from './types.js';
import { dialectStrategy, validateUsername } from './impersonate/dialect-strategy.js';
import { buildScope } from './impersonate/scope.js';
import { ImpersonationError } from './impersonate/types.js';
import type { ImpersonatedScope } from './impersonate/types.js';

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
export class Context<DB = unknown, Procs = object, Funcs = object, Tvfs = object> {

    #state: ContextState;
    #noorm: NoormOps | null = null;

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

        return requireConnection(this.#state).db as Kysely<DB>;

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

    async connect(): Promise<void> {

        if (this.#state.connection) return;

        this.#state.connection = await createConnection(
            this.#state.config.connection,
            this.#state.config.name,
        );

    }

    async disconnect(): Promise<void> {

        if (!this.#state.connection) return;

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
     * query builder, `sql` template literal, and all Kysely features.
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
     * ```
     */
    async transaction<T>(fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {

        return this.kysely.transaction().execute(fn);

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

        const params = args[0] as Record<string, unknown> | unknown[] | undefined;

        if (this.dialect === 'postgres') {

            return this.#executeProcPostgres<T>(name, params);

        }

        const query = buildProcCall<T>(this.dialect, name, params);
        const result = await query.execute(this.kysely);

        return (result.rows ?? []) as T[];

    }

    /**
     * Execute a stored procedure on PostgreSQL with FUNCTION fallback.
     *
     * PostgreSQL distinguishes between PROCEDURE and FUNCTION objects:
     * `CALL` only works against true procedures and raises SQLSTATE 42809
     * (`<name>(...) is not a procedure`) when the target is a function.
     *
     * The noorm playbook tells schema authors to use `CREATE PROCEDURE`
     * for void-returning ops and `CREATE FUNCTION` for row-returning ops,
     * and `ctx.proc()` is expected to handle both. So if `CALL` fails
     * with the wrong-object-type error, we retry with
     * `SELECT * FROM <name>(...)`, which works for both scalar and
     * set-returning PG functions.
     */
    async #executeProcPostgres<T>(
        name: string,
        params: Record<string, unknown> | unknown[] | undefined,
    ): Promise<T[]> {

        const callQuery = buildProcCall<T>('postgres', name, params);
        const [callResult, callErr] = await attempt(() => callQuery.execute(this.kysely));

        if (!callErr) {

            return (callResult.rows ?? []) as T[];

        }

        if (!isFunctionNotProcedureError(callErr)) {

            throw callErr;

        }

        // Object is a FUNCTION, not a PROCEDURE — retry as SELECT * FROM <name>(...).
        const tvfQuery = buildTvfCall<T>('postgres', name, params);
        const tvfResult = await tvfQuery.execute(this.kysely);

        return (tvfResult.rows ?? []) as T[];

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

        // Extract params and column from rest args
        const hasParams = !(args.length === 1 && typeof args[0] === 'string');
        const params = hasParams ? args[0] as Record<string, unknown> | unknown[] : undefined;
        const column = (hasParams ? args[1] : args[0]) as string;

        const query = buildFuncCall<T>(this.dialect, name, column, params);
        const result = await query.execute(this.kysely);

        return (result.rows?.[0] ?? null) as T;

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

        const params = args[0] as Record<string, unknown> | unknown[] | undefined;
        const query = buildTvfCall<T>(this.dialect, name, params);
        const result = await query.execute(this.kysely);

        return (result.rows ?? []) as T[];

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

        // === Business logic block ===
        const connectionDone = this.kysely.connection().execute(async (db) => {

            await sql.raw(impersonateSql).execute(db);

            const scope = buildScope<DB, Procs, Funcs, Tvfs>(db, async () => {

                await sql.raw(revertSql).execute(db);
                resolveHolder();

            }, this.dialect);

            resolveReady(scope);

            await connectionHeld;

        });

        connectionDone.catch(err => rejectReady(err));

        // === Commit block ===
        return ready;

    }

}

// ─────────────────────────────────────────────────────────────
// Driver Error Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Detect a PG `CALL`-against-FUNCTION error so the SDK can fall back to
 * `SELECT * FROM <name>(...)`. PostgreSQL surfaces this in two shapes:
 *
 *  - SQLSTATE 42809 (`wrong_object_type`) with message
 *    `<name>(...) is not a procedure` — when an exact match exists but
 *    is the wrong kind of object.
 *  - SQLSTATE 42883 (`undefined_function`) with message
 *    `procedure <name>(...) does not exist` and hint
 *    `To call a function, use SELECT.` — when the procedure-search
 *    fails outright but a function with the same signature exists.
 *
 * Both indicate "this is a FUNCTION, not a PROCEDURE" — retry as a
 * function call.
 */
function isFunctionNotProcedureError(err: unknown): boolean {

    if (!err || typeof err !== 'object') return false;

    // cast-justified: pg driver error has no fixed type
    const obj = err as { code?: string; message?: string; hint?: string };

    if (obj.code !== '42809' && obj.code !== '42883') return false;

    const msg = String(obj.message ?? '');
    const hint = String(obj.hint ?? '');

    return msg.includes('is not a procedure')
        || msg.includes('procedure')
        || hint.includes('use SELECT');

}
