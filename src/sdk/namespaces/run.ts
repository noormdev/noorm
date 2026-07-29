/**
 * Run namespace — SQL file execution, build, preview, discovery.
 *
 * Mirrors [r] run in the TUI. Discovery works offline,
 * execution and preview require a database connection.
 */
import path from 'node:path';

import { attempt } from '@logosdx/utils';

import type { Kysely } from 'kysely';

import type { NoormDatabase } from '../../core/shared/index.js';
import { filterFilesByPaths, findUnmatchedIncludePatterns } from '../../core/shared/index.js';
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
import { getEffectiveBuildPaths } from '../../core/settings/rules.js';
import { getStateManager } from '../../core/state/index.js';
import { resolveVaultKey, buildSecretsContext } from '../../core/vault/index.js';
import { checkProtectedConfig } from '../guards.js';

import type { ContextState } from '../state.js';
import { requireConnection } from '../state.js';
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

        const context = await this.#createRunContext();
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

        const context = await this.#createRunContext();
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

        const context = await this.#createRunContext();
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

        const context = await this.#createRunContext();
        const absolutePath = this.#resolvePath(dirpath);

        return coreRunDir(context, absolutePath, options);

    }

    /**
     * Execute all SQL files in the schema directory.
     *
     * Honors `settings.build.include`/`exclude` and `settings.rules`
     * identically to the TUI's Run Build screen (`RunBuildScreen.tsx`) —
     * headless callers (CLI/MCP/SDK, plus `db.reset`) must see the same
     * effective file set a human confirms interactively. The filtered list
     * is always computed and passed through, even when nothing is excluded,
     * so an all-excluded build (`preFilteredFiles = []`) reads as a real
     * pre-filtered result rather than "not provided" (runner.ts's
     * `if (preFilteredFiles)` check would otherwise fall back to full
     * discovery for an empty array only if we conditionally passed
     * `undefined` instead).
     *
     * @example
     * ```typescript
     * await ctx.noorm.run.build({ force: true })
     * ```
     */
    async build(options?: BuildOptions): Promise<BatchResult> {

        checkProtectedConfig(this.#state.config, this.#state.options, 'run:build', 'run.build');

        const context = await this.#createRunContext();
        const sqlPath = path.join(
            this.#state.projectRoot,
            this.#state.settings.paths?.sql ?? 'sql',
        );

        const configForMatch = {
            name: this.#state.config.name,
            access: this.#state.config.access,
            isTest: this.#state.config.isTest ?? false,
            type: this.#state.config.type,
        };

        const effectivePaths = getEffectiveBuildPaths(
            this.#state.settings.build?.include ?? [],
            this.#state.settings.build?.exclude ?? [],
            this.#state.settings.rules ?? [],
            configForMatch,
        );

        // attempt() here to preserve runBuild's discovery-failure contract:
        // on error (e.g. missing sql dir) fall back to runBuild's own
        // discovery, which emits and resolves a failed BatchResult instead
        // of throwing — db.reset and CLI callers rely on that shape.
        const [discoveredFiles, discoverErr] = await attempt(() => coreDiscoverFiles(sqlPath));

        if (discoverErr) {

            return runBuild(context, sqlPath, { force: options?.force, dryRun: options?.dryRun });

        }

        const filteredFiles = filterFilesByPaths(
            discoveredFiles,
            sqlPath,
            effectivePaths.include,
            effectivePaths.exclude,
        );

        const result = await runBuild(context, sqlPath, { force: options?.force, dryRun: options?.dryRun }, filteredFiles);

        // Reported on the result rather than thrown: an unmatched entry is a
        // misconfiguration, not an execution failure, and a build that legitimately
        // matches nothing must keep succeeding. Surfacing it is what stops the
        // `sql/`-prefix mistake from reading as a clean build.
        const unmatchedInclude = findUnmatchedIncludePatterns(discoveredFiles, sqlPath, effectivePaths.include);

        if (unmatchedInclude.length > 0) {

            return { ...result, unmatchedInclude };

        }

        return result;

    }

    // ─────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────

    get #kysely(): Kysely<unknown> {

        return requireConnection(this.#state).db;

    }

    #resolvePath(filepath: string): string {

        return path.isAbsolute(filepath)
            ? filepath
            : path.join(this.#state.projectRoot, filepath);

    }

    async #createRunContext(): Promise<RunContext> {

        const state = getStateManager(this.#state.projectRoot);
        const db = this.#kysely as unknown as Kysely<NoormDatabase>;
        const dialect = this.#state.config.connection.dialect;
        const vaultKey = await resolveVaultKey(db, dialect);

        return {
            db,
            configName: this.#state.config.name,
            identity: this.#state.identity,
            projectRoot: this.#state.projectRoot,
            dialect,
            access: this.#state.config.access,
            channel: this.#state.options.channel ?? 'user',
            config: this.#state.config as unknown as Record<string, unknown>,
            secrets: await buildSecretsContext(state, this.#state.config.name, db, vaultKey, dialect),
            globalSecrets: state.getAllGlobalSecrets(),
        };

    }

}
