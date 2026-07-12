/**
 * Db namespace — database exploration and schema operations.
 *
 * Mirrors [d] db in the TUI. All operations require a connection.
 * Destructive operations are gated by the config's `db:reset` access
 * (see `checkProtectedConfig` in ../guards.ts).
 */
import type { Kysely } from 'kysely';

import type { Dialect } from '../../core/connection/index.js';
import type {
    TableSummary,
    TableDetail,
    ViewSummary,
    ViewDetail,
    ProcedureSummary,
    ProcedureDetail,
    FunctionSummary,
    FunctionDetail,
    TypeSummary,
    TypeDetail,
    IndexSummary,
    ForeignKeySummary,
    ExploreOverview,
} from '../../core/explore/index.js';
import { fetchOverview, fetchList, fetchDetail } from '../../core/explore/index.js';
import type { TruncateOptions, TruncateResult, TeardownResult, TeardownPreview } from '../../core/teardown/index.js';
import { truncateData, teardownSchema, previewTeardown } from '../../core/teardown/index.js';
import { formatIdentity } from '../../core/identity/index.js';

import type { ContextState } from '../state.js';
import { requireConnection } from '../state.js';
import type { BuildOptions } from '../types.js';
import { checkProtectedConfig } from '../guards.js';

// ─────────────────────────────────────────────────────────────
// DbNamespace
// ─────────────────────────────────────────────────────────────

export class DbNamespace {

    #state: ContextState;
    #buildFn: ((opts?: BuildOptions) => Promise<unknown>) | null;

    constructor(state: ContextState, buildFn?: (opts?: BuildOptions) => Promise<unknown>) {

        this.#state = state;
        this.#buildFn = buildFn ?? null;

    }

    // ─────────────────────────────────────────────────────
    // Explore
    // ─────────────────────────────────────────────────────

    /**
     * List all tables in the database.
     *
     * @example
     * ```typescript
     * const tables = await ctx.noorm.db.listTables()
     * ```
     */
    async listTables(): Promise<TableSummary[]> {

        return fetchList(this.#kysely, this.#dialect, 'tables');

    }

    /**
     * Get detailed information about a table.
     *
     * @example
     * ```typescript
     * const detail = await ctx.noorm.db.describeTable('users')
     * ```
     */
    async describeTable(name: string, schema?: string): Promise<TableDetail | null> {

        return fetchDetail(this.#kysely, this.#dialect, 'tables', name, schema);

    }

    /**
     * List all views in the database.
     *
     * @example
     * ```typescript
     * const views = await ctx.noorm.db.listViews()
     * ```
     */
    async listViews(): Promise<ViewSummary[]> {

        return fetchList(this.#kysely, this.#dialect, 'views');

    }

    /**
     * Get detailed information about a view.
     *
     * @example
     * ```typescript
     * const detail = await ctx.noorm.db.describeView('active_users')
     * ```
     */
    async describeView(name: string, schema?: string): Promise<ViewDetail | null> {

        return fetchDetail(this.#kysely, this.#dialect, 'views', name, schema);

    }

    /**
     * List all stored procedures in the database.
     *
     * @example
     * ```typescript
     * const procs = await ctx.noorm.db.listProcedures()
     * ```
     */
    async listProcedures(): Promise<ProcedureSummary[]> {

        return fetchList(this.#kysely, this.#dialect, 'procedures');

    }

    /**
     * Get detailed information about a stored procedure.
     *
     * @example
     * ```typescript
     * const detail = await ctx.noorm.db.describeProcedure('sp_update_user')
     * ```
     */
    async describeProcedure(name: string, schema?: string): Promise<ProcedureDetail | null> {

        return fetchDetail(this.#kysely, this.#dialect, 'procedures', name, schema);

    }

    /**
     * List all functions in the database.
     *
     * @example
     * ```typescript
     * const fns = await ctx.noorm.db.listFunctions()
     * ```
     */
    async listFunctions(): Promise<FunctionSummary[]> {

        return fetchList(this.#kysely, this.#dialect, 'functions');

    }

    /**
     * Get detailed information about a function.
     *
     * @example
     * ```typescript
     * const detail = await ctx.noorm.db.describeFunction('fn_get_user')
     * ```
     */
    async describeFunction(name: string, schema?: string): Promise<FunctionDetail | null> {

        return fetchDetail(this.#kysely, this.#dialect, 'functions', name, schema);

    }

    /**
     * List all custom types in the database.
     *
     * @example
     * ```typescript
     * const types = await ctx.noorm.db.listTypes()
     * ```
     */
    async listTypes(): Promise<TypeSummary[]> {

        return fetchList(this.#kysely, this.#dialect, 'types');

    }

    /**
     * Get detailed information about a custom type.
     *
     * @example
     * ```typescript
     * const detail = await ctx.noorm.db.describeType('user_status')
     * ```
     */
    async describeType(name: string, schema?: string): Promise<TypeDetail | null> {

        return fetchDetail(this.#kysely, this.#dialect, 'types', name, schema);

    }

    /**
     * List all indexes in the database.
     *
     * @example
     * ```typescript
     * const indexes = await ctx.noorm.db.listIndexes()
     * ```
     */
    async listIndexes(): Promise<IndexSummary[]> {

        return fetchList(this.#kysely, this.#dialect, 'indexes');

    }

    /**
     * List all foreign keys in the database.
     *
     * @example
     * ```typescript
     * const fks = await ctx.noorm.db.listForeignKeys()
     * ```
     */
    async listForeignKeys(): Promise<ForeignKeySummary[]> {

        return fetchList(this.#kysely, this.#dialect, 'foreignKeys');

    }

    /**
     * Get database overview with counts of all object types.
     *
     * @example
     * ```typescript
     * const overview = await ctx.noorm.db.overview()
     * ```
     */
    async overview(): Promise<ExploreOverview> {

        return fetchOverview(this.#kysely, this.#dialect);

    }

    // ─────────────────────────────────────────────────────
    // Preview
    // ─────────────────────────────────────────────────────

    /**
     * Preview what teardown would drop without executing.
     *
     * @example
     * ```typescript
     * const preview = await ctx.noorm.db.previewTeardown()
     * ```
     */
    async previewTeardown(): Promise<TeardownPreview> {

        return previewTeardown(this.#kysely, this.#dialect);

    }

    // ─────────────────────────────────────────────────────
    // Destructive operations
    // ─────────────────────────────────────────────────────

    /**
     * Wipe all data, keeping the schema intact.
     *
     * User-provided preserve/only options take priority.
     * Falls back to settings.teardown.preserveTables from settings.yml.
     *
     * @example
     * ```typescript
     * // Uses preserve list from settings.yml automatically
     * const result = await ctx.noorm.db.truncate()
     *
     * // Override with explicit preserve list
     * const result = await ctx.noorm.db.truncate({ preserve: ['seeds'] })
     *
     * // Truncate only specific tables
     * const result = await ctx.noorm.db.truncate({ only: ['users', 'posts'] })
     * ```
     */
    async truncate(options?: TruncateOptions): Promise<TruncateResult> {

        checkProtectedConfig(this.#state.config, this.#state.options, 'db:reset', 'truncate');

        const preserve = options?.preserve
            ?? this.#state.settings.teardown?.preserveTables;

        return truncateData(this.#kysely, this.#dialect, {
            ...options,
            preserve,
        });

    }

    /**
     * Drop all database objects except noorm tracking tables.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.db.teardown()
     * ```
     */
    async teardown(): Promise<TeardownResult> {

        checkProtectedConfig(this.#state.config, this.#state.options, 'db:reset', 'teardown');

        return teardownSchema(this.#kysely, this.#dialect, {
            configName: this.#state.config.name,
            executedBy: formatIdentity(this.#state.identity),
            preserveTables: this.#state.settings.teardown?.preserveTables,
            postScript: this.#state.settings.teardown?.postScript,
        });

    }

    /**
     * Full rebuild: teardown + build.
     *
     * @example
     * ```typescript
     * await ctx.noorm.db.reset()
     * ```
     */
    async reset(): Promise<void> {

        checkProtectedConfig(this.#state.config, this.#state.options, 'db:reset', 'reset');

        // Full teardown — deliberately does NOT honor preserveTables.
        // reset() rebuilds the entire schema from sql/, so any table left
        // standing (e.g. reference vocabulary kept in preserveTables for the
        // truncate workflow) would collide with the build's CREATE TABLE and
        // abort the rebuild. preserveTables stays in effect for standalone
        // teardown() and truncate(); a full rebuild starts from nothing.
        await teardownSchema(this.#kysely, this.#dialect, {
            configName: this.#state.config.name,
            executedBy: formatIdentity(this.#state.identity),
            postScript: this.#state.settings.teardown?.postScript,
        });

        if (this.#buildFn) {

            await this.#buildFn({ force: true });

        }

    }

    // ─────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────

    get #kysely(): Kysely<unknown> {

        return requireConnection(this.#state).db;

    }

    get #dialect(): Dialect {

        return this.#state.config.connection.dialect;

    }

}
