import { defineCommand } from 'citty';
import { attempt, attemptSync } from '@logosdx/utils';
import { parseHistoryLimit } from '../../core/pipeline/parse.js';
import { EXIT } from '../_exit.js';
import { outputError, outputResult, sharedArgs, withContext } from '../_utils.js';
import { safeRun, validateArgs } from './_common.js';

const definitions = {
    slug: { type: 'positional', description: 'Pipeline slug', required: false },
    limit: { type: 'string', description: 'Maximum runs (1–100, default 20)' },
    config: sharedArgs.config, json: sharedArgs.json, yes: sharedArgs.yes,
} as const;

export default defineCommand({
    meta: { name: 'history', description: 'Show pipeline run history for the selected config' },
    args: definitions,
    async run({ args }) {

        const [invocation, invalid] = attemptSync(() => {

            validateArgs(args, definitions, 1);
            if (!args.slug) throw new Error('Missing slug');
            if (args.limit === undefined) return { slug: args.slug, limit: undefined };

            const parsed = parseHistoryLimit(args.limit);
            if (parsed === null) throw new Error('Invalid limit');

            return { slug: args.slug, limit: parsed };

        });
        if (invalid) {

            outputError(args, 'Invalid pipeline history invocation');
            process.exitCode = EXIT.USAGE;

            return;

        }
        const [response, error] = await withContext({
            args,
            fn: async (ctx) => {

                const [runs] = await attempt(() => ctx.noorm.pipelines.history(invocation.slug, { limit: invocation.limit }));

                return { runs };

            },
        });
        if (error || !response) {

            process.exitCode = EXIT.FAILURE;

            return;

        }
        if (!response.runs) {

            outputError(args, 'Unable to read pipeline history');
            process.exitCode = EXIT.FAILURE;

            return;

        }
        const runs = response.runs.map(safeRun);
        outputResult(args, { runs }, runs.length ? runs.map((run) => `${run.id} ${run.slug}: ${run.status} (${run.transaction_outcome})`).join('\n') : 'No pipeline runs found');

    },
});
