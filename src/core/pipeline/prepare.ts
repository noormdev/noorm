import { realpath } from 'node:fs/promises';

import { attempt } from '@logosdx/utils';

import { checkConfigPolicy } from '../policy/index.js';
import { computeChecksumFromContent } from '../runner/checksum.js';
import type { RunContext } from '../runner/types.js';
import { processFile } from '../template/engine.js';
import { classOnlyCause, invalidDefinition, PipelineCodedError } from './errors.js';
import { resolvePipelineInput } from './input.js';
import { PipelineEscapeError } from './sql-literal.js';
import type { PipelineDefinition, PreparedPipeline, PreparedPipelineStep } from './types.js';

/** Invocation facts that decide how a pipeline is rendered and authorized. */
export interface PreparePipelineOptions {
    input?: unknown;
    /** The user has already confirmed a protected operation. */
    yes?: boolean;
}

/** Authorize and render each declaration once, before admission or SQL execution. */
export async function preparePipeline(
    context: RunContext,
    definition: PipelineDefinition,
    options: PreparePipelineOptions = {},
): Promise<PreparedPipeline> {

    const policy = checkConfigPolicy(context.channel, { name: context.configName, access: context.access }, 'run:dir');
    if (!policy.allowed) throw new PipelineCodedError('PIPELINE_POLICY_BLOCKED', policy.blockedReason ?? 'Pipeline execution is not allowed');
    if (policy.requiresConfirmation && !options.yes) throw new PipelineCodedError('PIPELINE_CONFIRMATION_REQUIRED', 'Pipeline execution requires confirmation');

    const input = resolvePipelineInput(definition.inputs, options.input);
    const projectRoot = await realpath(context.projectRoot);
    const steps: PreparedPipelineStep[] = [];
    for (const step of definition.steps) {

        const [rendered, renderError] = await attempt(() => processFile(step.filepath, {
            projectRoot,
            config: context.config,
            secrets: context.secrets,
            globalSecrets: context.globalSecrets,
            pipelineInput: input,
            pipelineDialect: context.dialect ?? 'postgres',
        }));
        if (renderError instanceof PipelineEscapeError) {

            throw invalidDefinition('escape-unavailable', `Failed to prepare pipeline step ${step.stepNo}: ${renderError.message}`, renderError);

        }
        // A template or helper can throw arbitrary input or secret values.
        if (renderError || !rendered) throw invalidDefinition('step-prepare', `Failed to prepare pipeline step ${step.stepNo}`, renderError ? classOnlyCause(renderError) : undefined);

        const { sql } = rendered;
        steps.push(Object.freeze({
            stepNo: step.stepNo,
            id: step.id,
            sqlPath: step.sql,
            filepath: step.filepath,
            needs: Object.freeze([...step.needs]),
            sql,
            checksum: computeChecksumFromContent(sql),
        }));

    }

    return Object.freeze({
        slug: definition.slug,
        manifestChecksum: definition.manifestChecksum,
        transaction: definition.transaction,
        concurrency: definition.concurrency,
        singleRun: definition.singleRun,
        mode: definition.mode,
        steps: Object.freeze(steps),
    });

}
