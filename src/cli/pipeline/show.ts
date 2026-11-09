import { defineCommand } from 'citty';
import { attemptSync } from '@logosdx/utils';
import { parseRunId } from '../../core/pipeline/parse.js';
import { EXIT } from '../_exit.js';
import { outputError, outputResult, sharedArgs, withContext } from '../_utils.js';
import { safeRun, safeStep, validateArgs } from './_common.js';

const definitions = {
    id: { type: 'positional', description: 'Pipeline run ID', required: false },
    config: sharedArgs.config, json: sharedArgs.json, yes: sharedArgs.yes,
} as const;

export default defineCommand({
    meta: { name: 'show', description: 'Show one pipeline run in the selected config' },
    args: definitions,
    async run({ args }) {

        const [id, invalid] = attemptSync(() => {

            validateArgs(args, definitions, 1);
            const parsed = parseRunId(args.id);
            if (parsed === null) throw new Error('Invalid ID');

            return parsed;

        });
        if (invalid) {

            outputError(args, 'Invalid pipeline run ID or invocation');
            process.exitCode = EXIT.USAGE;

            return;

        }
        const [response, error] = await withContext({
            args,
            fn: (ctx) => ctx.noorm.pipelines.getRun(id),
        });
        if (error) {

            process.exitCode = EXIT.FAILURE;

            return;

        }
        if (!response) {

            outputError(args, 'Pipeline run not found');
            process.exitCode = EXIT.FAILURE;

            return;

        }
        const run = safeRun(response.run);
        const steps = response.steps.map(safeStep);
        outputResult(args, { run, steps }, [`Pipeline ${run.slug}: ${run.status} (run ${run.id}, transaction ${run.transaction_outcome})`,
            ...steps.map((step) => `  ${step.step_no}. ${step.name}: ${step.status} (${step.transaction_outcome})`)].join('\n'));

    },
});
