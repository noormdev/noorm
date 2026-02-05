/**
 * SDK Context Implementation.
 *
 * The Context class provides SQL-focused programmatic access to the
 * database. Noorm-specific operations (schema, changes, locks, etc.)
 * live behind the ctx.noorm namespace via NoormOps.
 */
import type { Kysely, Transaction } from 'kysely';

import type { Dialect } from '../core/connection/index.js';
import type { Config } from '../core/config/types.js';
import type { Settings } from '../core/settings/index.js';
import type { Identity } from '../core/identity/index.js';
import { createConnection } from '../core/connection/index.js';

import { buildProcCall, buildFuncCall } from './sql.js';
import { NoormOps } from './noorm-ops.js';
import type { ContextState } from './state.js';
import type { CreateContextOptions } from './types.js';

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
 * await ctx.noorm.build()
 * await ctx.noorm.fastForward()
 *
 * await ctx.disconnect()
 * ```
 */
export class Context<DB = unknown, Procs = object, Funcs = object> {

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

        if (!this.#state.connection) {

            throw new Error('Not connected. Call connect() first.');

        }

        return this.#state.connection.db as Kysely<DB>;

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
     * await ctx.noorm.build()
     * await ctx.noorm.fastForward()
     * const tables = await ctx.noorm.listTables()
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
     * // Named params
     * const users = await ctx.proc<User>('get_users', { department_id: 1 });
     *
     * // Positional params
     * await ctx.proc('simple_proc', [42, 'hello']);
     *
     * // No params
     * await ctx.proc('refresh_cache');
     * ```
     */
    async proc<T = unknown, N extends keyof Procs & string = keyof Procs & string>(
        name: N,
        ...args: Procs[N] extends void ? [] : [params: Procs[N]]
    ): Promise<T[]> {

        if (this.dialect === 'sqlite') {

            throw new Error('SQLite does not support stored procedures.');

        }

        const params = args[0] as Record<string, unknown> | unknown[] | undefined;
        const query = buildProcCall<T>(this.dialect, name, params);
        const result = await query.execute(this.kysely);

        return (result.rows ?? []) as T[];

    }

    /**
     * Call a database function and return the scalar result.
     *
     * Generates SELECT name(...) AS column. Named params only on PG;
     * other dialects fall back to positional. SQLite throws.
     *
     * @example
     * ```typescript
     * // Named params + column alias
     * const result = await ctx.func<{ total: number }>('calc_total', { order_id: 42 }, 'total');
     *
     * // Positional params + column alias
     * const sum = await ctx.func<{ result: number }>('add_numbers', [1, 2], 'result');
     *
     * // No params — just column alias
     * const ver = await ctx.func<{ v: string }>('get_version', 'v');
     * ```
     */
    async func<T = unknown, N extends keyof Funcs & string = keyof Funcs & string>(
        name: N,
        ...args: Funcs[N] extends void ? [column: string] : [params: Funcs[N], column: string]
    ): Promise<T> {

        if (this.dialect === 'sqlite') {

            throw new Error('SQLite does not support database function calls.');

        }

        // Extract params and column from rest args
        const hasParams = !(args.length === 1 && typeof args[0] === 'string');
        const params = hasParams ? args[0] as Record<string, unknown> | unknown[] : undefined;
        const column = (hasParams ? args[1] : args[0]) as string;

        const query = buildFuncCall<T>(this.dialect, name, column, params);
        const result = await query.execute(this.kysely);

        return (result.rows?.[0] ?? null) as T;

    }

}
