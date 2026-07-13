/**
 * Changes namespace — change authoring, execution, and history.
 *
 * Mirrors [g] changes in the TUI. Scaffold operations work offline,
 * execution and status queries require a database connection.
 */
import path from 'node:path';

import type { Kysely } from 'kysely';

import type { NoormDatabase } from '../../core/shared/index.js';
import type {
    Change,
    ChangeOptions,
    ChangeResult,
    BatchChangeOptions,
    BatchChangeResult,
    ChangeListItem,
    ChangeHistoryRecord,
    FileHistoryRecord,
    ChangeContext,
    CreateChangeOptions,
    AddFileOptions,
} from '../../core/change/index.js';
import {
    createChange,
    addFile as coreAddFile,
    removeFile as coreRemoveFile,
    renameFile as coreRenameFile,
    reorderFiles as coreReorderFiles,
    deleteChange as coreDeleteChange,
    parseChange as coreParseChange,
    discoverChanges as coreDiscoverChanges,
    validateChange as coreValidateChange,
    ChangeManager,
} from '../../core/change/index.js';
import { getStateManager } from '../../core/state/index.js';
import { checkProtectedConfig } from '../guards.js';

import type { ContextState } from '../state.js';
import { requireConnection } from '../state.js';

// ─────────────────────────────────────────────────────────────
// ChangesNamespace
// ─────────────────────────────────────────────────────────────

export class ChangesNamespace {

    #state: ContextState;
    #manager: ChangeManager | null = null;

    constructor(state: ContextState) {

        this.#state = state;

    }

    // ─────────────────────────────────────────────────────
    // Scaffold (offline)
    // ─────────────────────────────────────────────────────

    /**
     * Create a new change directory with change/ and revert/ folders.
     *
     * @example
     * ```typescript
     * const change = await ctx.noorm.changes.create({ description: 'add-user-roles' })
     * ```
     */
    async create(options: CreateChangeOptions): Promise<Change> {

        return createChange(this.#changesDir, options);

    }

    /**
     * Add a file to a change.
     *
     * @example
     * ```typescript
     * const updated = await ctx.noorm.changes.addFile(change, 'change', {
     *     name: 'create-table',
     *     type: 'sql',
     * })
     * ```
     */
    async addFile(
        change: Change,
        folder: 'change' | 'revert',
        options: AddFileOptions,
    ): Promise<Change> {

        return coreAddFile(change, folder, options);

    }

    /**
     * Remove a file from a change.
     *
     * @example
     * ```typescript
     * await ctx.noorm.changes.removeFile(change, 'change', '001_create-table.sql')
     * ```
     */
    async removeFile(
        change: Change,
        folder: 'change' | 'revert',
        filename: string,
    ): Promise<Change> {

        return coreRemoveFile(change, folder, filename);

    }

    /**
     * Rename a file in a change.
     *
     * @example
     * ```typescript
     * await ctx.noorm.changes.renameFile(change, 'change', '001_old.sql', 'new-name')
     * ```
     */
    async renameFile(
        change: Change,
        folder: 'change' | 'revert',
        oldFilename: string,
        newDescription: string,
    ): Promise<Change> {

        return coreRenameFile(change, folder, oldFilename, newDescription);

    }

    /**
     * Reorder files in a change folder.
     *
     * @example
     * ```typescript
     * await ctx.noorm.changes.reorderFiles(change, 'change', ['002_b.sql', '001_a.sql'])
     * ```
     */
    async reorderFiles(
        change: Change,
        folder: 'change' | 'revert',
        newOrder: string[],
    ): Promise<Change> {

        return coreReorderFiles(change, folder, newOrder);

    }

    /**
     * Delete a change directory from disk.
     *
     * @example
     * ```typescript
     * await ctx.noorm.changes.delete(change)
     * ```
     */
    async delete(change: Change): Promise<void> {

        checkProtectedConfig(this.#state.config, this.#state.options, 'change:rm', 'changes.delete');

        return coreDeleteChange(change);

    }

    // ─────────────────────────────────────────────────────
    // Discovery & validation (offline)
    // ─────────────────────────────────────────────────────

    /**
     * Discover all changes on disk.
     *
     * @example
     * ```typescript
     * const changes = await ctx.noorm.changes.discover()
     * ```
     */
    async discover(): Promise<Change[]> {

        return coreDiscoverChanges(this.#changesDir, this.#sqlDir);

    }

    /**
     * Parse a single change from disk by name.
     *
     * @example
     * ```typescript
     * const change = await ctx.noorm.changes.parse('2024-01-15-add-users')
     * ```
     */
    async parse(name: string): Promise<Change> {

        const changePath = path.join(this.#changesDir, name);

        return coreParseChange(changePath, this.#sqlDir);

    }

    /**
     * Validate a change's structure.
     *
     * @throws ChangeValidationError if invalid
     *
     * @example
     * ```typescript
     * ctx.noorm.changes.validate(change)
     * ```
     */
    validate(change: Change): void {

        coreValidateChange(change);

    }

    // ─────────────────────────────────────────────────────
    // Execution (connected)
    // ─────────────────────────────────────────────────────

    /**
     * Apply a specific change.
     *
     * Pass `dryRun: true` to render the change to `tmp/` without
     * touching the database, or `preview: true` to emit rendered SQL.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.changes.apply('2024-01-15-add-users')
     * const dry = await ctx.noorm.changes.apply(
     *     '2024-01-15-add-users',
     *     { dryRun: true },
     * )
     * ```
     */
    async apply(name: string, options?: ChangeOptions): Promise<ChangeResult> {

        checkProtectedConfig(this.#state.config, this.#state.options, 'change:run', 'changes.apply');

        return this.#getManager().run(name, options);

    }

    /**
     * Revert a specific change.
     *
     * Pass `dryRun: true` to render the revert files to `tmp/` without
     * touching the database, or `preview: true` to emit rendered SQL.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.changes.revert('2024-01-15-add-users')
     * const dry = await ctx.noorm.changes.revert(
     *     '2024-01-15-add-users',
     *     { dryRun: true },
     * )
     * ```
     */
    async revert(name: string, options?: ChangeOptions): Promise<ChangeResult> {

        checkProtectedConfig(this.#state.config, this.#state.options, 'change:revert', 'changes.revert');

        return this.#getManager().revert(name, options);

    }

    /**
     * Apply all pending changes.
     *
     * Pass `dryRun: true` to render each change to `tmp/` without
     * touching the database. Pass `preview: true` to emit rendered
     * SQL (also without DB writes). When omitted, both default to
     * `false` and changes are applied normally.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.changes.ff()
     * const dry = await ctx.noorm.changes.ff({ dryRun: true })
     * const forced = await ctx.noorm.changes.ff({ force: true })
     * ```
     */
    async ff(options?: BatchChangeOptions): Promise<BatchChangeResult> {

        checkProtectedConfig(this.#state.config, this.#state.options, 'change:ff', 'changes.ff');

        return this.#getManager().ff(options);

    }

    /**
     * Apply the next N pending changes (default 1).
     *
     * Pass `dryRun: true` to render the changes to `tmp/` without
     * touching the database. Pass `preview: true` to emit rendered
     * SQL (also without DB writes).
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.changes.next()
     * const result = await ctx.noorm.changes.next(3)
     * const dry = await ctx.noorm.changes.next(2, { dryRun: true })
     * ```
     */
    async next(count: number = 1, options?: BatchChangeOptions): Promise<BatchChangeResult> {

        checkProtectedConfig(this.#state.config, this.#state.options, 'change:run', 'changes.next');

        return this.#getManager().next(count, options);

    }

    // ─────────────────────────────────────────────────────
    // Status & history (connected)
    // ─────────────────────────────────────────────────────

    /**
     * Get status of all changes (merged disk + DB).
     *
     * @example
     * ```typescript
     * const all = await ctx.noorm.changes.status()
     * ```
     */
    async status(): Promise<ChangeListItem[]> {

        return this.#getManager().list();

    }

    /**
     * Get only pending (unapplied or reverted) changes.
     *
     * @example
     * ```typescript
     * const pending = await ctx.noorm.changes.pending()
     * ```
     */
    async pending(): Promise<ChangeListItem[]> {

        const all = await this.status();

        return all.filter(
            (cs) => !cs.orphaned && (cs.status === 'pending' || cs.status === 'reverted'),
        );

    }

    /**
     * Get execution history.
     *
     * @example
     * ```typescript
     * const history = await ctx.noorm.changes.history(10)
     * ```
     */
    async history(limit?: number): Promise<ChangeHistoryRecord[]> {

        return this.#getManager().getHistory(undefined, limit);

    }

    /**
     * Get execution history for a specific change by name.
     *
     * Returns all operation records for the given change, most recent first.
     *
     * @example
     * ```typescript
     * const records = await ctx.noorm.changes.historyForChange('2024-01-15-add-users')
     * ```
     */
    async historyForChange(name: string, limit?: number): Promise<ChangeHistoryRecord[]> {

        return this.#getManager().getHistory(name, limit);

    }

    /**
     * Rewind applied changes in reverse order back to (and including) the named change.
     *
     * When a string is passed, reverts until and including that change.
     * When a number is passed, reverts that many recent changes.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.changes.rewind('2024-01-15-add-users')
     * const result = await ctx.noorm.changes.rewind(3)
     * ```
     */
    async rewind(target: number | string): Promise<BatchChangeResult> {

        checkProtectedConfig(this.#state.config, this.#state.options, 'change:revert', 'changes.rewind');

        return this.#getManager().rewind(target);

    }

    /**
     * Get per-file execution records for a specific operation ID.
     *
     * Use the `id` from a `ChangeHistoryRecord` to drill into individual
     * file-level results for that operation.
     *
     * @example
     * ```typescript
     * const records = await ctx.noorm.changes.historyForChange('2024-01-15-add-users')
     * const files = await ctx.noorm.changes.getFileHistory(records[0].id)
     * ```
     */
    async getFileHistory(operationId: number): Promise<FileHistoryRecord[]> {

        return this.#getManager().getFileHistory(operationId);

    }

    // ─────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────

    get #changesDir(): string {

        return path.join(
            this.#state.projectRoot,
            this.#state.settings.paths?.changes ?? 'changes',
        );

    }

    get #sqlDir(): string {

        return path.join(
            this.#state.projectRoot,
            this.#state.settings.paths?.sql ?? 'sql',
        );

    }

    get #kysely(): Kysely<unknown> {

        return requireConnection(this.#state).db;

    }

    #createChangeContext(): ChangeContext {

        const state = getStateManager(this.#state.projectRoot);
        const conn = requireConnection(this.#state);

        return {
            db: this.#kysely as unknown as Kysely<NoormDatabase>,
            dialect: conn.dialect,
            configName: this.#state.config.name,
            identity: this.#state.identity,
            projectRoot: this.#state.projectRoot,
            changesDir: this.#changesDir,
            sqlDir: this.#sqlDir,
            access: this.#state.config.access,
            channel: this.#state.options.channel ?? 'user',
            config: this.#state.config as unknown as Record<string, unknown>,
            secrets: state.getAllSecrets(this.#state.config.name),
            globalSecrets: state.getAllGlobalSecrets(),
        };

    }

    #getManager(): ChangeManager {

        if (!this.#manager) {

            this.#manager = new ChangeManager(this.#createChangeContext());

        }

        return this.#manager;

    }

}
