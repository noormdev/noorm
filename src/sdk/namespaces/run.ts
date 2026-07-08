/**
 * Run namespace — SQL file execution, build, preview, discovery.
 *
 * Mirrors [r] run in the TUI. Discovery works offline,
 * execution and preview require a database connection.
 */
import path from 'node:path';

import type { Kysely } from 'kysely';

import type { NoormDatabase } from '../../core/shared/index.js';
import type {
    RunContext,
    RunOptions,
    FileResult,
    BatchResult,
} from '../../core/runner/index.js';
import {
    runBuild,
    runFile as coreRunFile,
    runDir as coreRunDir,
    runFiles as coreRunFiles,
    preview as corePreview,
    discoverFiles as coreDiscoverFiles,
} from '../../core/runner/index.js';
import { getStateManager } from '../../core/state/index.js';
import { checkProtectedConfig } from '../guards.js';

import type { ContextState } from '../state.js';
import type { BuildOptions } from '../types.js';

// ─────────────────────────────────────────────────────────────
// RunNamespace
// ─────────────────────────────────────────────────────────────

export class RunNamespace {

    #state: ContextState;

    constructor(state: ContextState) {

        this.#state = state;

    }

    // ─────────────────────────────────────────────────────
    // Discovery (offline)
    // ─────────────────────────────────────────────────────

    /**
     * Discover SQL files in a directory.
     *
     * @example
     * ```typescript
     * const files = await ctx.noorm.run.discover('sql/')
     * ```
     */
    async discover(dirpath?: string): Promise<string[]> {

        const absolutePath = this.#resolvePath(
            dirpath ?? this.#state.settings.paths?.sql ?? 'sql',
        );

        return coreDiscoverFiles(absolutePath);

    }

    // ─────────────────────────────────────────────────────
    // Preview (connected)
    // ─────────────────────────────────────────────────────

    /**
     * Preview SQL files — render templates without executing.
     *
     * @example
     * ```typescript
     * const results = await ctx.noorm.run.preview(['sql/001.sql', 'sql/002.sql'])
     * ```
     */
    async preview(
        filepaths: string[],
        output?: string | null,
    ): Promise<FileResult[]> {

        const context = this.#createRunContext();
        const absolutePaths = filepaths.map((fp) => this.#resolvePath(fp));

        return corePreview(context, absolutePaths, output);

    }

    // ─────────────────────────────────────────────────────
    // Execution (connected)
    // ─────────────────────────────────────────────────────

    /**
     * Execute a single SQL file.
     *
     * @example
     * ```typescript
     * await ctx.noorm.run.file('seeds/test-data.sql')
     * ```
     */
    async file(filepath: string, options?: RunOptions): Promise<FileResult> {

        checkProtectedConfig(this.#state.config, this.#state.options, 'run:file', 'run.file');

        const context = this.#createRunContext();
        const absolutePath = this.#resolvePath(filepath);

        return coreRunFile(context, absolutePath, options);

    }

    /**
     * Execute multiple SQL files sequentially.
     *
     * @example
     * ```typescript
     * await ctx.noorm.run.files(['functions/utils.sql', 'triggers/audit.sql'])
     * ```
     */
    async files(filepaths: string[], options?: RunOptions): Promise<BatchResult> {

        checkProtectedConfig(this.#state.config, this.#state.options, 'run:dir', 'run.files');

        const context = this.#createRunContext();
        const absolutePaths = filepaths.map((fp) => this.#resolvePath(fp));

        return coreRunFiles(context, absolutePaths, options);

    }

    /**
     * Execute all SQL files in a directory.
     *
     * @example
     * ```typescript
     * await ctx.noorm.run.dir('seeds/')
     * ```
     */
    async dir(dirpath: string, options?: RunOptions): Promise<BatchResult> {

        checkProtectedConfig(this.#state.config, this.#state.options, 'run:dir', 'run.dir');

        const context = this.#createRunContext();
        const absolutePath = this.#resolvePath(dirpath);

        return coreRunDir(context, absolutePath, options);

    }

    /**
     * Execute all SQL files in the schema directory.
     *
     * @example
     * ```typescript
     * await ctx.noorm.run.build({ force: true })
     * ```
     */
    async build(options?: BuildOptions): Promise<BatchResult> {

        checkProtectedConfig(this.#state.config, this.#state.options, 'run:build', 'run.build');

        const context = this.#createRunContext();
        const sqlPath = path.join(
            this.#state.projectRoot,
            this.#state.settings.paths?.sql ?? 'sql',
        );

        return runBuild(context, sqlPath, { force: options?.force });

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

    #resolvePath(filepath: string): string {

        return path.isAbsolute(filepath)
            ? filepath
            : path.join(this.#state.projectRoot, filepath);

    }

    #createRunContext(): RunContext {

        const state = getStateManager(this.#state.projectRoot);

        return {
            db: this.#kysely as unknown as Kysely<NoormDatabase>,
            configName: this.#state.config.name,
            identity: this.#state.identity,
            projectRoot: this.#state.projectRoot,
            dialect: this.#state.config.connection.dialect,
            access: this.#state.config.access,
            channel: this.#state.options.channel ?? 'user',
            config: this.#state.config as unknown as Record<string, unknown>,
            secrets: state.getAllSecrets(this.#state.config.name),
            globalSecrets: state.getAllGlobalSecrets(),
        };

    }

}
