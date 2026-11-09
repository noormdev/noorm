import type { ArgsDef } from 'citty';
import { loadPipelineDefinition } from '../../core/pipeline/definition.js';
import { ProtectedConfigError } from '../../sdk/guards.js';
import { PipelineCodedError, PipelineDefinitionError } from '../../core/pipeline/errors.js';
import { DEFAULT_PIPELINES_PATH } from '../../core/settings/defaults.js';
import { getSettingsManager } from '../../core/settings/index.js';
import { EXIT, type ExitCode } from '../_exit.js';
import type { NoormPipelineRun, NoormPipelineStep } from '../../core/shared/tables.js';

/** Loads a pipeline definition from the current project using its configured pipelines path. */
export async function loadDefinition(slug: string) {

    const projectRoot = process.cwd();
    const settings = await getSettingsManager(projectRoot).load();

    return loadPipelineDefinition({ projectRoot, pipelinesPath: settings.paths?.pipelines ?? DEFAULT_PIPELINES_PATH, slug });

}

/** Every spelling of the declared flags (kebab, camel, aliases) that citty may hand back. */
export function argumentKeys(definitions: ArgsDef): Set<string> {

    const allowed = new Set(['_']);
    for (const [name, def] of Object.entries(definitions)) {

        allowed.add(name);
        allowed.add(name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));
        allowed.add(name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
        if ('alias' in def && def.alias) for (const alias of Array.isArray(def.alias) ? def.alias : [def.alias]) allowed.add(alias);

    }

    return allowed;

}

/** Citty parses values; reject its normally permissive unknown keys and positionals. */
export function validateArgs(args: Record<string, unknown>, definitions: ArgsDef, positionals: number): void {

    const allowed = argumentKeys(definitions);
    for (const [name, def] of Object.entries(definitions)) {

        if (def.type === 'string' && args[name] !== undefined && typeof args[name] !== 'string') {

            throw new Error('Invalid argument');

        }

    }
    if (Object.keys(args).some((key) => !allowed.has(key))
        || !Array.isArray(args['_']) || args['_'].length !== positionals) throw new Error('Invalid arguments');

}

/** A run without free-form stored errors: history and database errors can contain SQL, input and absolute paths. */
export function safeRun(run: NoormPipelineRun) {

    const { error_message: _error, active_key: _key, ...safe } = run;

    return safe;

}

/** A step without free-form stored errors, file paths or skip reasons, for the same reason as {@link safeRun}. */
export function safeStep(step: NoormPipelineStep) {

    const { error_message: _error, filepath: _path, skip_reason: _reason, ...safe } = step;

    return safe;

}

/** Exit code and user-facing text for a pipeline failure, chosen from its code. */
export function pipelineFailure(error: unknown, yes: boolean): { exit: ExitCode; message: string } {

    if (error instanceof ProtectedConfigError) {

        return {
            exit: EXIT.FAILURE,
            message: yes
                ? 'Pipeline execution is blocked by the config policy'
                : 'Pipeline execution is blocked by the config policy or requires confirmation; pass --yes',
        };

    }
    if (!(error instanceof PipelineCodedError)) return { exit: EXIT.FAILURE, message: 'Pipeline execution failed' };

    switch (error.code) {

    case 'PIPELINE_INVALID_DEFINITION':
        return {
            exit: EXIT.USAGE,
            message: error instanceof PipelineDefinitionError ? `Invalid pipeline definition (${error.rule})` : 'Invalid pipeline definition',
        };
    case 'PIPELINE_INVALID_INPUT':
        return { exit: EXIT.USAGE, message: 'Invalid pipeline input' };
    case 'PIPELINE_POLICY_BLOCKED':
        return { exit: EXIT.FAILURE, message: 'Pipeline execution is blocked by the active configuration policy' };
    case 'PIPELINE_CONFIRMATION_REQUIRED':
        return { exit: EXIT.FAILURE, message: 'Pipeline execution requires confirmation; pass --yes' };
    case 'PIPELINE_NOT_FOUND':
        return { exit: EXIT.USAGE, message: 'Pipeline not found' };
    case 'PIPELINE_BUSY':
        return { exit: EXIT.FAILURE, message: 'Pipeline execution was not admitted' };

    }

}

/** Names the failed definition rule, or an unknown pipeline; otherwise the generic invocation message. */
export function definitionFailureMessage(error: unknown): string {

    return error instanceof PipelineCodedError && (error.code === 'PIPELINE_INVALID_DEFINITION' || error.code === 'PIPELINE_NOT_FOUND')
        ? pipelineFailure(error, false).message
        : 'Invalid pipeline definition or invocation';

}

/** First interrupt aborts the run; a second one exits 130 without waiting for it to settle. */
export function interruptHandler(controller: AbortController, exit: (code: number) => void): () => void {

    return () => {

        if (controller.signal.aborted) exit(130);
        controller.abort();

    };

}
