import { defineCommand, parseArgs } from 'citty';
import { attempt } from '@logosdx/utils';
import { EXIT, exitCodeForStatus } from '../_exit.js';
import { isYesMode, outputError, outputResult, sharedArgs, withContext } from '../_utils.js';
import { createPipelineInputArgs, PipelineMissingInputError, resolvePipelineCliInput } from './input.js';
import { argumentKeys, interruptHandler, loadDefinition, pipelineFailure, validateArgs } from './_common.js';

const builtins = {
    slug: { type: 'positional', description: 'Pipeline folder slug', required: true },
    config: sharedArgs.config, json: sharedArgs.json, force: sharedArgs.force,
    dryRun: sharedArgs.dryRun, yes: sharedArgs.yes,
} as const;

// Completion imports this command with its own argv layout.
const rawArgs = process.argv[2] === 'pipeline' && process.argv[3] === 'run' ? process.argv.slice(4) : [];
const selectionArgs = {
    ...builtins,
    slug: { ...builtins.slug, required: false },
    help: { type: 'boolean', alias: 'h' },
    version: { type: 'boolean', alias: 'v' },
} as const;
const knownKeys = argumentKeys(selectionArgs);
// Generated inputs are strings even for boolean data; preview their arity before loading a manifest.
const inputArgs = Object.fromEntries(Object.keys(parseArgs(rawArgs, selectionArgs))
    .filter((key) => !knownKeys.has(key))
    .map((key) => [key, { type: 'string' as const }]));
const selected = parseArgs(rawArgs, { ...selectionArgs, ...inputArgs })['slug'];
const definition = selected ? loadDefinition(selected) : undefined;

export default defineCommand({
    meta: async () => ({ name: 'run', description: (await definition)?.description ?? 'Run a SQL pipeline' }),
    args: async () => ({
        ...builtins,
        ...(definition ? createPipelineInputArgs(await definition) : {}),
    }),
    async run({ args }) {

        const def = await definition;
        if (!def) throw new Error('A pipeline slug is required');
        const [input, inputError] = await attempt(async () => {

            validateArgs(args, { ...builtins, ...createPipelineInputArgs(def) }, 1);

            return resolvePipelineCliInput(def, args);

        });
        if (inputError) {

            outputError(args, inputError instanceof PipelineMissingInputError ? inputError.message : 'Invalid or cancelled pipeline input or invocation');
            process.exitCode = EXIT.USAGE;

            return;

        }

        const controller = new AbortController();
        const interrupt = interruptHandler(controller, (code) => process.exit(code));
        process.on('SIGINT', interrupt);
        try {

            const [response, error] = await withContext({
                args,
                fn: async (ctx) => {

                    const [result, failure] = await attempt(
                        () => ctx.noorm.pipelines.run(def.slug, { input, dryRun: !!args['dryRun'], signal: controller.signal }),
                    );

                    return result ? { result, failure: null } : { result: null, failure: pipelineFailure(failure, isYesMode(args)) };

                },
            });
            if (error || !response) {

                process.exitCode = EXIT.FAILURE;

                return;

            }
            if (!response.result) {

                outputError(args, response.failure.message);
                process.exitCode = response.failure.exit;

                return;

            }
            const result = response.result;
            const exitCode = result.transactionOutcome === 'partial' || result.status === 'partial'
                ? EXIT.PARTIAL
                : result.transactionOutcome === 'unknown' ? EXIT.FAILURE : exitCodeForStatus(result.status);
            const steps = result.steps.map(({ filepath: _path, ...step }) => {

                if ('error' in step) return { ...step, error: step.error ? { phase: step.error.phase, stepNo: step.error.stepNo } : null, skipReason: undefined };

                return step;

            });
            const safe = result.dryRun
                ? { ...result, steps }
                : { ...result, steps,
                    primaryError: result.primaryError ? { phase: result.primaryError.phase, stepNo: result.primaryError.stepNo } : null,
                    secondaryErrors: result.secondaryErrors.map(({ phase, stepNo }) => ({ phase, stepNo })) };
            const text = [`Pipeline ${result.slug}: ${result.status} (run ${result.runId ?? 'dry run'}, transaction ${result.transactionOutcome})`,
                ...steps.map((step) => `  ${step.stepNo}. ${step.name}${'status' in step ? `: ${step.status} (${step.transactionOutcome})` : ''}`)].join('\n');
            outputResult(args, { ...safe, success: exitCode === EXIT.SUCCESS }, text);
            process.exitCode = exitCode;

        }
        finally {

            process.off('SIGINT', interrupt);

        }

    },
});
