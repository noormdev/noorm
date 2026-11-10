import type { Kysely } from 'kysely';

import type { ConnectionResult } from '../../core/connection/types.js';
import { buildPipelineContext } from '../../core/pipeline/context.js';
import { runPipeline } from '../../core/pipeline/executor.js';
import { assertHistoryLimit, assertRunId, getPipelineRun, listPipelineHistory, type PipelineHistoryContext, type PipelineHistoryRecord } from '../../core/pipeline/history.js';
import type { PipelineDryRunResult, PipelineRunOptions, PipelineRunResult } from '../../core/pipeline/types.js';
import { DEFAULT_PIPELINES_PATH } from '../../core/settings/defaults.js';
import type { NoormDatabase, NoormPipelineRun } from '../../core/shared/tables.js';
import { getPackageVersion } from '../../core/state/version.js';
import { checkProtectedConfig } from '../guards.js';
import { requireConnection, runGatedExplore, type ContextState } from '../state.js';

/** Options for {@link PipelinesNamespace.history}. */
export interface PipelineHistoryOptions {
    /** Maximum runs to return, newest first. */
    limit?: number;
}

/** Connected pipeline execution and config-scoped history, reached as `ctx.noorm.pipelines`. */
export class PipelinesNamespace {

    #state: ContextState;

    constructor(state: ContextState) {

        this.#state = state;

    }

    /**
     * Runs a pipeline, or only validates and renders it with `dryRun`. A failed run resolves with `status` and
     * `transactionOutcome` set instead of throwing, so callers can see what committed.
     *
     * @example
     * const result = await ctx.noorm.pipelines.run('nightly-rollup', { input: { day: '2026-01-31' } });
     * if (result.status !== 'success') console.error(result.primaryError, result.transactionOutcome);
     */
    async run(slug: string, options: PipelineRunOptions = {}): Promise<PipelineDryRunResult | PipelineRunResult> {

        const { connection, db } = this.#connected();
        checkProtectedConfig(this.#state.config, this.#state.options, 'pipeline:run', 'pipelines.run');
        const dialect = connection.dialect;
        const context = await buildPipelineContext({
            db,
            dialect,
            config: this.#state.config,
            configName: this.#state.config.name,
            identity: this.#state.identity,
            projectRoot: this.#state.projectRoot,
            stateManager: this.#state.stateManager,
            pipelinesPath: this.#state.settings.paths?.pipelines ?? DEFAULT_PIPELINES_PATH,
            channel: this.#state.options.channel ?? 'user',
            yes: this.#state.options.yes,
            dryRun: options.dryRun,
            disposeMemoryConnection: async () => {

                try {

                    await connection.destroy();

                }
                finally {

                    if (this.#state.connection === connection) this.#state.connection = null;

                }

            },
        });

        return runPipeline(context, slug, options);

    }

    /**
     * Lists a pipeline's past runs for the active config, newest first.
     *
     * @example
     * const runs = await ctx.noorm.pipelines.history('nightly-rollup', { limit: 5 });
     * console.log(runs.map((run) => `${run.id} ${run.status}`));
     */
    async history(slug: string, options: PipelineHistoryOptions = {}): Promise<NoormPipelineRun[]> {

        if (options.limit !== undefined) assertHistoryLimit(options.limit);

        return runGatedExplore(this.#state, 'pipeline history', () => listPipelineHistory(this.#historyContext(), slug, options));

    }

    /**
     * Loads one run with its steps; `null` when the id is unknown or belongs to another config.
     *
     * @example
     * const record = await ctx.noorm.pipelines.getRun(42);
     * if (record) console.log(record.run.status, record.steps.length);
     */
    async getRun(id: number): Promise<PipelineHistoryRecord | null> {

        assertRunId(id);

        return runGatedExplore(this.#state, 'pipeline history', () => getPipelineRun(this.#historyContext(), id));

    }

    #connected(): { connection: ConnectionResult; db: Kysely<NoormDatabase> } {

        const connection = requireConnection(this.#state);

        // createConnection types its handle as Kysely<unknown>; the tracking tables are noorm's own schema.
        return { connection, db: connection.db as Kysely<NoormDatabase> };

    }

    #historyContext(): PipelineHistoryContext {

        const { connection, db } = this.#connected();

        return {
            db,
            dialect: connection.dialect,
            configName: this.#state.config.name,
            executedBy: this.#state.identity.name,
            cliVersion: getPackageVersion(),
        };

    }

}
