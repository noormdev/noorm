/**
 * Db namespace — database exploration and schema operations.
 *
 * Mirrors [d] db in the TUI. All operations require a connection.
 * Destructive operations respect the allowProtected guard.
 */
import type { Kysely } from 'kysely';

import type { Dialect } from '../../core/connection/index.js';
import type {
    TableSummary,
    TableDetail,
    ExploreOverview,
} from '../../core/explore/index.js';
import { fetchOverview, fetchList, fetchDetail } from '../../core/explore/index.js';
import type { TruncateOptions, TruncateResult, TeardownResult, TeardownPreview } from '../../core/teardown/index.js';
import { truncateData, teardownSchema, previewTeardown } from '../../core/teardown/index.js';
import { formatIdentity } from '../../core/identity/index.js';

import type { ContextState } from '../state.js';
import type { BuildOptions } from '../types.js';
import { checkProtectedConfig } from '../guards.js';

// ─────────────────────────────────────────────────────────────
// DbNamespace
// ─────────────────────────────────────────────────────────────

export class DbNamespace {

    #state: ContextState;
    #buildFn: ((opts?: BuildOptions) => Promise<unknown>) | null = null;

    constructor(state: ContextState) {

        this.#state = state;

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

        checkProtectedConfig(this.#state.config, 'truncate', this.#state.options);

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

        checkProtectedConfig(this.#state.config, 'teardown', this.#state.options);

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

        checkProtectedConfig(this.#state.config, 'reset', this.#state.options);

        await this.teardown();

        if (this.#buildFn) {

            await this.#buildFn({ force: true });

        }

    }

    // ─────────────────────────────────────────────────────
    // Build injection (for reset)
    // ─────────────────────────────────────────────────────

    /** @internal Used by NoormOps to wire up reset -> build. */
    set _buildFn(fn: (opts?: BuildOptions) => Promise<unknown>) {

        this.#buildFn = fn;

    }

    // ─────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────

    get #kysely(): Kysely<unknown> {

        if (!this.#state.connection) {

            throw new Error('Not connected. Call connect() first.');

        }

        return this.#state.connection.db;

    }

    get #dialect(): Dialect {

        return this.#state.config.connection.dialect;

    }

}
