/**
 * SDK Context Implementation.
 *
 * The Context class provides programmatic access to all noorm operations.
 * It wraps core modules and provides a clean API for SDK users.
 */
import path from 'node:path';

import { sql, type Kysely } from 'kysely';

import type { Config } from '../core/config/types.js';
import type { Settings } from '../core/settings/index.js';
import type { Identity } from '../core/identity/index.js';
import type { ConnectionResult, Dialect } from '../core/connection/index.js';
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
import { createConnection, testConnection as coreTestConnection } from '../core/connection/index.js';
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

import { checkProtectedConfig } from './guards.js';
import type {
    CreateContextOptions,
    ExecuteResult,
    TransactionContext,
    BuildOptions,
} from './types.js';

// ─────────────────────────────────────────────────────────────
// Context Class
// ─────────────────────────────────────────────────────────────

/**
 * SDK Context implementation.
 *
 * Provides programmatic access to all noorm operations.
 *
 * @example
 * ```typescript
 * const ctx = await createContext({ config: 'dev' })
 * await ctx.connect()
 *
 * // Run queries
 * const users = await ctx.query('SELECT * FROM users')
 *
 * // Clean disconnect
 * await ctx.disconnect()
 * ```
 */
export class Context<DB = unknown> {

    #connection: ConnectionResult | null = null;
    #config: Config;
    #settings: Settings;
    #identity: Identity;
    #options: CreateContextOptions;
    #projectRoot: string;
    #changeManager: ChangeManager | null = null;

    constructor(
        config: Config,
        settings: Settings,
        identity: Identity,
        options: CreateContextOptions,
        projectRoot: string,
    ) {

        this.#config = config;
        this.#settings = settings;
        this.#identity = identity;
        this.#options = options;
        this.#projectRoot = projectRoot;

    }

    // ─────────────────────────────────────────────────────────
    // Read-only Properties
    // ─────────────────────────────────────────────────────────

    get config(): Config {

        return this.#config;

    }

    get settings(): Settings {

        return this.#settings;

    }

    get identity(): Identity {

        return this.#identity;

    }

    get dialect(): Dialect {

        return this.#config.connection.dialect;

    }

    get connected(): boolean {

        return this.#connection !== null;

    }

    get observer() {

        return observer;

    }

    get kysely(): Kysely<DB> {

        if (!this.#connection) {

            throw new Error('Not connected. Call connect() first.');

        }

        return this.#connection.db as Kysely<DB>;

    }

    // ─────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────

    async connect(): Promise<void> {

        if (this.#connection) return;

        this.#connection = await createConnection(
            this.#config.connection,
            this.#config.name,
        );

    }

    async disconnect(): Promise<void> {

        if (!this.#connection) return;

        await this.#connection.destroy();
        this.#connection = null;
        this.#changeManager = null;

    }

    // ─────────────────────────────────────────────────────────
    // SQL Execution
    // ─────────────────────────────────────────────────────────

    async query<T = Record<string, unknown>>(
        sqlStr: string,
        _params?: unknown[],
    ): Promise<T[]> {

        // Note: Kysely's sql.raw() executes raw SQL without parameter binding.
        // For parameterized queries, users should use ctx.kysely directly with
        // Kysely's type-safe query builder or sql tagged template literals.
        const db = this.kysely;
        const result = await sql.raw<T>(sqlStr).execute(db);

        return (result.rows ?? []) as T[];

    }

    async execute(sqlStr: string, _params?: unknown[]): Promise<ExecuteResult> {

        // Note: Kysely's sql.raw() executes raw SQL without parameter binding.
        // For parameterized queries, users should use ctx.kysely directly.
        const db = this.kysely;
        const result = await sql.raw(sqlStr).execute(db);

        return {
            rowsAffected: result.numAffectedRows
                ? Number(result.numAffectedRows)
                : undefined,
        };

    }

    async transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {

        const db = this.kysely;

        return db.transaction().execute(async (trx) => {

            const tx: TransactionContext = {
                async query<R>(s: string, _p?: unknown[]): Promise<R[]> {

                    const r = await sql.raw<R>(s).execute(trx);

                    return (r.rows ?? []) as R[];

                },
                async execute(s: string, _p?: unknown[]): Promise<ExecuteResult> {

                    const r = await sql.raw(s).execute(trx);

                    return {
                        rowsAffected: r.numAffectedRows
                            ? Number(r.numAffectedRows)
                            : undefined,
                    };

                },
            };

            return fn(tx);

        });

    }

    // ─────────────────────────────────────────────────────────
    // Explore
    // ─────────────────────────────────────────────────────────

    async listTables(): Promise<TableSummary[]> {

        return fetchList(this.kysely as Kysely<unknown>, this.dialect, 'tables');

    }

    async describeTable(name: string, schema?: string): Promise<TableDetail | null> {

        return fetchDetail(this.kysely as Kysely<unknown>, this.dialect, 'tables', name, schema);

    }

    async overview(): Promise<ExploreOverview> {

        return fetchOverview(this.kysely as Kysely<unknown>, this.dialect);

    }

    // ─────────────────────────────────────────────────────────
    // Schema Operations
    // ─────────────────────────────────────────────────────────

    async truncate(): Promise<TruncateResult> {

        checkProtectedConfig(this.#config, 'truncate', this.#options);

        return truncateData(this.kysely as Kysely<unknown>, this.dialect);

    }

    async teardown(): Promise<TeardownResult> {

        checkProtectedConfig(this.#config, 'teardown', this.#options);

        return teardownSchema(this.kysely as Kysely<unknown>, this.dialect, {
            configName: this.#config.name,
            executedBy: formatIdentity(this.#identity),
        });

    }

    async build(options?: BuildOptions): Promise<BatchResult> {

        const runContext = this.#createRunContext();
        const sqlPath = path.join(
            this.#projectRoot,
            this.#config.paths.sql,
        );

        return runBuild(runContext, sqlPath, { force: options?.force });

    }

    async reset(): Promise<void> {

        checkProtectedConfig(this.#config, 'reset', this.#options);

        await this.teardown();
        await this.build({ force: true });

    }

    // ─────────────────────────────────────────────────────────
    // File Runner
    // ─────────────────────────────────────────────────────────

    async runFile(filepath: string, options?: RunOptions): Promise<FileResult> {

        const runContext = this.#createRunContext();
        const absolutePath = path.isAbsolute(filepath)
            ? filepath
            : path.join(this.#projectRoot, filepath);

        return coreRunFile(runContext, absolutePath, options);

    }

    async runFiles(filepaths: string[], options?: RunOptions): Promise<BatchResult> {

        const runContext = this.#createRunContext();
        const absolutePaths = filepaths.map((fp) =>
            path.isAbsolute(fp) ? fp : path.join(this.#projectRoot, fp),
        );

        return coreRunFiles(runContext, absolutePaths, options);

    }

    async runDir(dirpath: string, options?: RunOptions): Promise<BatchResult> {

        const runContext = this.#createRunContext();
        const absolutePath = path.isAbsolute(dirpath)
            ? dirpath
            : path.join(this.#projectRoot, dirpath);

        return coreRunDir(runContext, absolutePath, options);

    }

    // ─────────────────────────────────────────────────────────
    // Changes
    // ─────────────────────────────────────────────────────────

    async applyChange(
        name: string,
        options?: ChangeOptions,
    ): Promise<ChangeResult> {

        return this.#getChangeManager().run(name, options);

    }

    async revertChange(
        name: string,
        options?: ChangeOptions,
    ): Promise<ChangeResult> {

        return this.#getChangeManager().revert(name, options);

    }

    async fastForward(): Promise<BatchChangeResult> {

        return this.#getChangeManager().ff();

    }

    async getChangeStatus(): Promise<ChangeListItem[]> {

        return this.#getChangeManager().list();

    }

    async getPendingChanges(): Promise<ChangeListItem[]> {

        const all = await this.getChangeStatus();

        return all.filter(
            (cs) => !cs.orphaned && (cs.status === 'pending' || cs.status === 'reverted'),
        );

    }

    // ─────────────────────────────────────────────────────────
    // Secrets
    // ─────────────────────────────────────────────────────────

    getSecret(key: string): string | undefined {

        const state = getStateManager(this.#projectRoot);
        const value = state.getSecret(this.#config.name, key);

        return value ?? undefined;

    }

    // ─────────────────────────────────────────────────────────
    // Locks
    // ─────────────────────────────────────────────────────────

    async acquireLock(options?: LockOptions): Promise<Lock> {

        const lockManager = getLockManager();
        const identityStr = formatIdentity(this.#identity);

        return lockManager.acquire(
            this.kysely as unknown as Kysely<NoormDatabase>,
            this.#config.name,
            identityStr,
            { ...options, dialect: this.#config.connection.dialect },
        );

    }

    async releaseLock(): Promise<void> {

        const lockManager = getLockManager();
        const identityStr = formatIdentity(this.#identity);

        await lockManager.release(
            this.kysely as unknown as Kysely<NoormDatabase>,
            this.#config.name,
            identityStr,
        );

    }

    async getLockStatus(): Promise<LockStatus> {

        const lockManager = getLockManager();

        return lockManager.status(
            this.kysely as unknown as Kysely<NoormDatabase>,
            this.#config.name,
            this.#config.connection.dialect,
        );

    }

    async withLock<T>(fn: () => Promise<T>, options?: LockOptions): Promise<T> {

        const lockManager = getLockManager();
        const identityStr = formatIdentity(this.#identity);

        return lockManager.withLock(
            this.kysely as unknown as Kysely<NoormDatabase>,
            this.#config.name,
            identityStr,
            fn,
            { ...options, dialect: this.#config.connection.dialect },
        );

    }

    async forceReleaseLock(): Promise<boolean> {

        const lockManager = getLockManager();

        return lockManager.forceRelease(
            this.kysely as unknown as Kysely<NoormDatabase>,
            this.#config.name,
        );

    }

    // ─────────────────────────────────────────────────────────
    // Templates
    // ─────────────────────────────────────────────────────────

    async renderTemplate(filepath: string): Promise<TemplateResult> {

        const absolutePath = path.isAbsolute(filepath)
            ? filepath
            : path.join(this.#projectRoot, filepath);

        const state = getStateManager(this.#projectRoot);

        return processFile(absolutePath, {
            projectRoot: this.#projectRoot,
            config: this.#config as unknown as Record<string, unknown>,
            secrets: state.getAllSecrets(this.#config.name),
            globalSecrets: state.getAllGlobalSecrets(),
        });

    }

    // ─────────────────────────────────────────────────────────
    // History
    // ─────────────────────────────────────────────────────────

    async getHistory(limit?: number): Promise<ChangeHistoryRecord[]> {

        return this.#getChangeManager().getHistory(undefined, limit);

    }

    // ─────────────────────────────────────────────────────────
    // Utilities
    // ─────────────────────────────────────────────────────────

    async computeChecksum(filepath: string): Promise<string> {

        const absolutePath = path.isAbsolute(filepath)
            ? filepath
            : path.join(this.#projectRoot, filepath);

        return coreComputeChecksum(absolutePath);

    }

    async testConnection(): Promise<{ ok: boolean; error?: string }> {

        return coreTestConnection(this.#config.connection);

    }

    // ─────────────────────────────────────────────────────────
    // Private Helpers
    // ─────────────────────────────────────────────────────────

    #createRunContext(): RunContext {

        const state = getStateManager(this.#projectRoot);

        return {
            db: this.kysely as unknown as Kysely<NoormDatabase>,
            configName: this.#config.name,
            identity: this.#identity,
            projectRoot: this.#projectRoot,
            config: this.#config as unknown as Record<string, unknown>,
            secrets: state.getAllSecrets(this.#config.name),
            globalSecrets: state.getAllGlobalSecrets(),
        };

    }

    #createChangeContext(): ChangeContext {

        const state = getStateManager(this.#projectRoot);

        return {
            db: this.kysely as unknown as Kysely<NoormDatabase>,
            configName: this.#config.name,
            identity: this.#identity,
            projectRoot: this.#projectRoot,
            changesDir: path.join(this.#projectRoot, this.#config.paths.changes),
            sqlDir: path.join(this.#projectRoot, this.#config.paths.sql),
            config: this.#config as unknown as Record<string, unknown>,
            secrets: state.getAllSecrets(this.#config.name),
            globalSecrets: state.getAllGlobalSecrets(),
        };

    }

    #getChangeManager(): ChangeManager {

        if (!this.#changeManager) {

            this.#changeManager = new ChangeManager(this.#createChangeContext());

        }

        return this.#changeManager;

    }

}
