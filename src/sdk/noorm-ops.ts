/**
 * NoormOps — noorm-specific operations behind ctx.noorm namespace.
 *
 * Separates database management operations (build, truncate, changes,
 * locks, etc.) from the SQL-focused top-level Context API. Both share
 * the same ContextState so connection state stays in sync.
 */
import path from 'node:path';

import type { Kysely } from 'kysely';

import type { Dialect } from '../core/connection/index.js';
import type { Config } from '../core/config/types.js';
import type { Settings } from '../core/settings/index.js';
import type { Identity } from '../core/identity/index.js';
import type { NoormDatabase } from '../core/shared/index.js';
import type {
    TableSummary,
    TableDetail,
    ExploreOverview,
} from '../core/explore/index.js';
import type { TruncateResult, TeardownResult } from '../core/teardown/index.js';
import type { BatchResult, FileResult, RunOptions, RunContext } from '../core/runner/index.js';
import type {
    ChangeResult,
    BatchChangeResult,
    ChangeListItem,
    ChangeOptions,
    ChangeContext,
    ChangeHistoryRecord,
} from '../core/change/index.js';
import type { Lock, LockStatus, LockOptions } from '../core/lock/index.js';
import type { ProcessResult as TemplateResult } from '../core/template/index.js';
import type { TransferOptions, TransferResult, TransferPlan } from '../core/transfer/types.js';

import { fetchOverview, fetchList, fetchDetail } from '../core/explore/index.js';
import { truncateData, teardownSchema } from '../core/teardown/index.js';
import {
    runBuild,
    runFile as coreRunFile,
    runDir as coreRunDir,
    runFiles as coreRunFiles,
    computeChecksum as coreComputeChecksum,
} from '../core/runner/index.js';
import { ChangeManager } from '../core/change/index.js';
import { getLockManager } from '../core/lock/index.js';
import { processFile } from '../core/template/index.js';
import { formatIdentity } from '../core/identity/index.js';
import { observer } from '../core/observer.js';
import { getStateManager } from '../core/state/index.js';
import { testConnection as coreTestConnection } from '../core/connection/index.js';
import { transferData, getTransferPlan } from '../core/transfer/index.js';
import { exportTable as coreExportTable, importDtFile } from '../core/dt/index.js';

import { checkProtectedConfig } from './guards.js';
import type { ContextState } from './state.js';
import type { BuildOptions, ExportOptions, ImportOptions } from './types.js';

// ─────────────────────────────────────────────────────────────
// NoormOps Class
// ─────────────────────────────────────────────────────────────

/**
 * Noorm-specific operations accessed via ctx.noorm.
 *
 * All database management operations — schema, changes, locks,
 * runner, explore, transfer, DT — live here. The shared ContextState
 * keeps connection state in sync with the parent Context.
 *
 * @example
 * ```typescript
 * const ctx = await createContext({ config: 'dev' })
 * await ctx.connect()
 *
 * await ctx.noorm.build()
 * await ctx.noorm.fastForward()
 * const tables = await ctx.noorm.listTables()
 * ```
 */
export class NoormOps {

    #state: ContextState;

    constructor(state: ContextState) {

        this.#state = state;

    }

    // ─────────────────────────────────────────────────────────
    // Read-only Properties
    // ─────────────────────────────────────────────────────────

    get config(): Config {

        return this.#state.config;

    }

    get settings(): Settings {

        return this.#state.settings;

    }

    get identity(): Identity {

        return this.#state.identity;

    }

    get observer() {

        return observer;

    }

    // ─────────────────────────────────────────────────────────
    // Private Accessors
    // ─────────────────────────────────────────────────────────

    get #kysely(): Kysely<unknown> {

        if (!this.#state.connection) {

            throw new Error('Not connected. Call connect() first.');

        }

        return this.#state.connection.db;

    }

    get #dialect(): Dialect {

        return this.#state.config.connection.dialect;

    }

    // ─────────────────────────────────────────────────────────
    // Explore
    // ─────────────────────────────────────────────────────────

    /**
     * List all tables in the database.
     *
     * @example
     * ```typescript
     * const tables = await ctx.noorm.listTables()
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
     * const detail = await ctx.noorm.describeTable('users')
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
     * const overview = await ctx.noorm.overview()
     * ```
     */
    async overview(): Promise<ExploreOverview> {

        return fetchOverview(this.#kysely, this.#dialect);

    }

    // ─────────────────────────────────────────────────────────
    // Schema Operations
    // ─────────────────────────────────────────────────────────

    /**
     * Wipe all data, keeping the schema intact.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.truncate()
     * ```
     */
    async truncate(): Promise<TruncateResult> {

        checkProtectedConfig(this.#state.config, 'truncate', this.#state.options);

        return truncateData(this.#kysely, this.#dialect);

    }

    /**
     * Drop all database objects except noorm tracking tables.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.teardown()
     * ```
     */
    async teardown(): Promise<TeardownResult> {

        checkProtectedConfig(this.#state.config, 'teardown', this.#state.options);

        return teardownSchema(this.#kysely, this.#dialect, {
            configName: this.#state.config.name,
            executedBy: formatIdentity(this.#state.identity),
        });

    }

    /**
     * Execute all SQL files in the schema directory.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.build({ force: true })
     * ```
     */
    async build(options?: BuildOptions): Promise<BatchResult> {

        const runContext = this.#createRunContext();
        const sqlPath = path.join(
            this.#state.projectRoot,
            this.#state.config.paths.sql,
        );

        return runBuild(runContext, sqlPath, { force: options?.force });

    }

    /**
     * Full rebuild: teardown + build.
     *
     * @example
     * ```typescript
     * await ctx.noorm.reset()
     * ```
     */
    async reset(): Promise<void> {

        checkProtectedConfig(this.#state.config, 'reset', this.#state.options);

        await this.teardown();
        await this.build({ force: true });

    }

    // ─────────────────────────────────────────────────────────
    // File Runner
    // ─────────────────────────────────────────────────────────

    /**
     * Execute a single SQL file.
     *
     * @example
     * ```typescript
     * await ctx.noorm.runFile('seeds/test-data.sql')
     * ```
     */
    async runFile(filepath: string, options?: RunOptions): Promise<FileResult> {

        const runContext = this.#createRunContext();
        const absolutePath = path.isAbsolute(filepath)
            ? filepath
            : path.join(this.#state.projectRoot, filepath);

        return coreRunFile(runContext, absolutePath, options);

    }

    /**
     * Execute multiple SQL files sequentially.
     *
     * @example
     * ```typescript
     * await ctx.noorm.runFiles(['functions/utils.sql', 'triggers/audit.sql'])
     * ```
     */
    async runFiles(filepaths: string[], options?: RunOptions): Promise<BatchResult> {

        const runContext = this.#createRunContext();
        const absolutePaths = filepaths.map((fp) =>
            path.isAbsolute(fp) ? fp : path.join(this.#state.projectRoot, fp),
        );

        return coreRunFiles(runContext, absolutePaths, options);

    }

    /**
     * Execute all SQL files in a directory.
     *
     * @example
     * ```typescript
     * await ctx.noorm.runDir('seeds/')
     * ```
     */
    async runDir(dirpath: string, options?: RunOptions): Promise<BatchResult> {

        const runContext = this.#createRunContext();
        const absolutePath = path.isAbsolute(dirpath)
            ? dirpath
            : path.join(this.#state.projectRoot, dirpath);

        return coreRunDir(runContext, absolutePath, options);

    }

    // ─────────────────────────────────────────────────────────
    // Changes
    // ─────────────────────────────────────────────────────────

    /**
     * Apply a specific change.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.applyChange('2024-01-15-add-users')
     * ```
     */
    async applyChange(
        name: string,
        options?: ChangeOptions,
    ): Promise<ChangeResult> {

        return this.#getChangeManager().run(name, options);

    }

    /**
     * Revert a specific change.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.revertChange('2024-01-15-add-users')
     * ```
     */
    async revertChange(
        name: string,
        options?: ChangeOptions,
    ): Promise<ChangeResult> {

        return this.#getChangeManager().revert(name, options);

    }

    /**
     * Apply all pending changes.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.fastForward()
     * ```
     */
    async fastForward(): Promise<BatchChangeResult> {

        return this.#getChangeManager().ff();

    }

    /**
     * Get status of all changes.
     *
     * @example
     * ```typescript
     * const changes = await ctx.noorm.getChangeStatus()
     * ```
     */
    async getChangeStatus(): Promise<ChangeListItem[]> {

        return this.#getChangeManager().list();

    }

    /**
     * Get only pending changes.
     *
     * @example
     * ```typescript
     * const pending = await ctx.noorm.getPendingChanges()
     * ```
     */
    async getPendingChanges(): Promise<ChangeListItem[]> {

        const all = await this.getChangeStatus();

        return all.filter(
            (cs) => !cs.orphaned && (cs.status === 'pending' || cs.status === 'reverted'),
        );

    }

    // ─────────────────────────────────────────────────────────
    // Secrets
    // ─────────────────────────────────────────────────────────

    /**
     * Get a config-scoped secret.
     *
     * @example
     * ```typescript
     * const apiKey = ctx.noorm.getSecret('API_KEY')
     * ```
     */
    getSecret(key: string): string | undefined {

        const state = getStateManager(this.#state.projectRoot);
        const value = state.getSecret(this.#state.config.name, key);

        return value ?? undefined;

    }

    // ─────────────────────────────────────────────────────────
    // Locks
    // ─────────────────────────────────────────────────────────

    /**
     * Acquire a database lock.
     *
     * @example
     * ```typescript
     * const lock = await ctx.noorm.acquireLock({ timeout: 60000 })
     * ```
     */
    async acquireLock(options?: LockOptions): Promise<Lock> {

        const lockManager = getLockManager();
        const identityStr = formatIdentity(this.#state.identity);

        return lockManager.acquire(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#state.config.name,
            identityStr,
            { ...options, dialect: this.#state.config.connection.dialect },
        );

    }

    /**
     * Release the current lock.
     *
     * @example
     * ```typescript
     * await ctx.noorm.releaseLock()
     * ```
     */
    async releaseLock(): Promise<void> {

        const lockManager = getLockManager();
        const identityStr = formatIdentity(this.#state.identity);

        await lockManager.release(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#state.config.name,
            identityStr,
        );

    }

    /**
     * Get current lock status.
     *
     * @example
     * ```typescript
     * const status = await ctx.noorm.getLockStatus()
     * ```
     */
    async getLockStatus(): Promise<LockStatus> {

        const lockManager = getLockManager();

        return lockManager.status(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#state.config.name,
            this.#state.config.connection.dialect,
        );

    }

    /**
     * Execute an operation with automatic lock acquisition and release.
     *
     * @example
     * ```typescript
     * await ctx.noorm.withLock(async () => {
     *     await ctx.noorm.build()
     *     await ctx.noorm.fastForward()
     * })
     * ```
     */
    async withLock<T>(fn: () => Promise<T>, options?: LockOptions): Promise<T> {

        const lockManager = getLockManager();
        const identityStr = formatIdentity(this.#state.identity);

        return lockManager.withLock(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#state.config.name,
            identityStr,
            fn,
            { ...options, dialect: this.#state.config.connection.dialect },
        );

    }

    /**
     * Force release any database lock regardless of ownership.
     *
     * @example
     * ```typescript
     * await ctx.noorm.forceReleaseLock()
     * ```
     */
    async forceReleaseLock(): Promise<boolean> {

        const lockManager = getLockManager();

        return lockManager.forceRelease(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#state.config.name,
        );

    }

    // ─────────────────────────────────────────────────────────
    // Templates
    // ─────────────────────────────────────────────────────────

    /**
     * Render a template file without executing.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.renderTemplate('sql/001_users.sql.tmpl')
     * ```
     */
    async renderTemplate(filepath: string): Promise<TemplateResult> {

        const absolutePath = path.isAbsolute(filepath)
            ? filepath
            : path.join(this.#state.projectRoot, filepath);

        const state = getStateManager(this.#state.projectRoot);

        return processFile(absolutePath, {
            projectRoot: this.#state.projectRoot,
            config: this.#state.config as unknown as Record<string, unknown>,
            secrets: state.getAllSecrets(this.#state.config.name),
            globalSecrets: state.getAllGlobalSecrets(),
        });

    }

    // ─────────────────────────────────────────────────────────
    // History
    // ─────────────────────────────────────────────────────────

    /**
     * Get execution history.
     *
     * @example
     * ```typescript
     * const history = await ctx.noorm.getHistory(10)
     * ```
     */
    async getHistory(limit?: number): Promise<ChangeHistoryRecord[]> {

        return this.#getChangeManager().getHistory(undefined, limit);

    }

    // ─────────────────────────────────────────────────────────
    // Utilities
    // ─────────────────────────────────────────────────────────

    /**
     * Compute SHA-256 checksum for a file.
     *
     * @example
     * ```typescript
     * const checksum = await ctx.noorm.computeChecksum('sql/001_users.sql')
     * ```
     */
    async computeChecksum(filepath: string): Promise<string> {

        const absolutePath = path.isAbsolute(filepath)
            ? filepath
            : path.join(this.#state.projectRoot, filepath);

        return coreComputeChecksum(absolutePath);

    }

    /**
     * Tests if the connection can be established.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.testConnection()
     * ```
     */
    async testConnection(): Promise<{ ok: boolean; error?: string }> {

        return coreTestConnection(this.#state.config.connection);

    }

    // ─────────────────────────────────────────────────────────
    // Transfer
    // ─────────────────────────────────────────────────────────

    /**
     * Transfer data from this context's database to a destination context.
     *
     * Both contexts must be connected. Uses each context's config for
     * connection management.
     *
     * @example
     * ```typescript
     * const [result, err] = await source.noorm.transferTo(dest, {
     *     tables: ['users', 'posts'],
     *     onConflict: 'skip',
     * })
     * ```
     */
    async transferTo(
        destConfig: Config,
        options?: TransferOptions,
    ): Promise<[TransferResult | null, Error | null]> {

        return transferData(this.#state.config, destConfig, options);

    }

    /**
     * Generate a transfer plan without executing.
     *
     * @example
     * ```typescript
     * const [plan, err] = await source.noorm.transferPlan(destConfig)
     * ```
     */
    async transferPlan(
        destConfig: Config,
        options?: TransferOptions,
    ): Promise<[TransferPlan | null, Error | null]> {

        return getTransferPlan(this.#state.config, destConfig, options);

    }

    // ─────────────────────────────────────────────────────────
    // DT File Operations
    // ─────────────────────────────────────────────────────────

    /**
     * Export a table to a .dt file.
     *
     * @example
     * ```typescript
     * const [result, err] = await ctx.noorm.exportTable('users', './exports/users.dtz')
     * ```
     */
    async exportTable(
        tableName: string,
        filepath: string,
        options?: ExportOptions,
    ): Promise<[{ rowsWritten: number; bytesWritten: number } | null, Error | null]> {

        return coreExportTable({
            db: this.#kysely,
            dialect: this.#dialect,
            tableName,
            filepath,
            schema: options?.schema,
            passphrase: options?.passphrase,
            batchSize: options?.batchSize,
        });

    }

    /**
     * Import a .dt file into the connected database.
     *
     * @example
     * ```typescript
     * const [result, err] = await ctx.noorm.importFile('./exports/users.dtz', {
     *     onConflict: 'skip',
     * })
     * ```
     */
    async importFile(
        filepath: string,
        options?: ImportOptions,
    ): Promise<[{ rowsImported: number; rowsSkipped: number } | null, Error | null]> {

        return importDtFile({
            filepath,
            db: this.#kysely,
            dialect: this.#dialect,
            passphrase: options?.passphrase,
            batchSize: options?.batchSize,
            onConflict: options?.onConflict,
            truncate: options?.truncate,
        });

    }

    // ─────────────────────────────────────────────────────────
    // Private Helpers
    // ─────────────────────────────────────────────────────────

    #createRunContext(): RunContext {

        const state = getStateManager(this.#state.projectRoot);

        return {
            db: this.#kysely as unknown as Kysely<NoormDatabase>,
            configName: this.#state.config.name,
            identity: this.#state.identity,
            projectRoot: this.#state.projectRoot,
            config: this.#state.config as unknown as Record<string, unknown>,
            secrets: state.getAllSecrets(this.#state.config.name),
            globalSecrets: state.getAllGlobalSecrets(),
        };

    }

    #createChangeContext(): ChangeContext {

        const state = getStateManager(this.#state.projectRoot);

        return {
            db: this.#kysely as unknown as Kysely<NoormDatabase>,
            configName: this.#state.config.name,
            identity: this.#state.identity,
            projectRoot: this.#state.projectRoot,
            changesDir: path.join(this.#state.projectRoot, this.#state.config.paths.changes),
            sqlDir: path.join(this.#state.projectRoot, this.#state.config.paths.sql),
            config: this.#state.config as unknown as Record<string, unknown>,
            secrets: state.getAllSecrets(this.#state.config.name),
            globalSecrets: state.getAllGlobalSecrets(),
        };

    }

    #getChangeManager(): ChangeManager {

        if (!this.#state.changeManager) {

            this.#state.changeManager = new ChangeManager(this.#createChangeContext());

        }

        return this.#state.changeManager;

    }

}
