import * as clack from '@clack/prompts';
import type { ArgsDef } from 'citty';
import { attemptSync } from '@logosdx/utils';
import { isEnvTruthy } from '../../core/environment.js';
import { pipelineInputFlagName } from '../../core/pipeline/definition.js';
import { isPipelineJsonValue, parsePipelineInputText, resolvePipelineInput, validatePipelineInputValue } from '../../core/pipeline/input.js';
import type {
    PipelineDefinition, PipelineInputSnapshot, PipelineJsonValue,
} from '../../core/pipeline/types.js';
import { resolveChannel } from '../../core/policy/index.js';
import type { Channel } from '../../core/policy/index.js';
import { isYesMode } from '../_utils.js';

/**
 * Thrown when the operator cancels an input prompt, so the run stops before any SQL instead of running with a partial input.
 *
 * @example
 * if (prompts.isCancel(answer)) throw new PipelineInputCancelledError();
 */
export class PipelineInputCancelledError extends Error {

    constructor() {

        super('Pipeline input cancelled');
        this.name = 'PipelineInputCancelledError';

    }

}

/**
 * Thrown when required inputs are missing and no prompt is possible. Its message lists only input names,
 * so the CLI can print it where other input failures get a generic message.
 *
 * @example
 * if (missing.length && !interactive) throw new PipelineMissingInputError(['region', 'cutoff']);
 */
export class PipelineMissingInputError extends Error {

    constructor(names: string[]) {

        super(`Missing required pipeline inputs: ${names.join(', ')}`);
        this.name = 'PipelineMissingInputError';

    }

}

type PromptAdapter = Pick<typeof clack, 'text' | 'confirm' | 'select' | 'isCancel'>;

export interface PipelineCliInputOptions {
    channel?: Channel;
    prompts?: PromptAdapter;
}

/** Definitions intentionally leave defaults and required checks to input resolution. */
export function createPipelineInputArgs(definition: PipelineDefinition): ArgsDef {

    const args: ArgsDef = { input: { type: 'string', description: 'Pipeline input as a JSON object' } };
    for (const [name, declaration] of Object.entries(definition.inputs)) {

        const details = [declaration.type, declaration.required ? 'required' : 'optional'];
        if (Object.hasOwn(declaration, 'default')) details.push(`default: ${JSON.stringify(declaration.default)}`);
        if (declaration.choices) details.push(`choices: ${declaration.choices.map((value) => JSON.stringify(value)).join(', ')}`);
        args[pipelineInputFlagName(name)] = {
            type: 'string', description: `${declaration.description} (${details.join('; ')})`,
        };

    }

    return args;

}


/** Resolve flags and JSON before prompting so invalid supplied values never prompt. */
export async function resolvePipelineCliInput(
    definition: PipelineDefinition,
    args: Record<string, unknown>,
    options: PipelineCliInputOptions = {},
): Promise<PipelineInputSnapshot> {

    let supplied: unknown = {};
    if (args['input'] !== undefined) {

        if (typeof args['input'] !== 'string') throw new Error('Pipeline input must be a JSON object');
        const input = args['input'];
        const [parsed, parseError] = attemptSync((): unknown => JSON.parse(input));
        if (parseError) throw new Error('Pipeline input must be a JSON object');
        supplied = parsed;

    }
    if (!isPipelineJsonValue(supplied) || supplied === null || typeof supplied !== 'object' || Array.isArray(supplied)) {

        throw new Error('Pipeline input must be a plain JSON object');

    }
    for (const name of Object.keys(supplied)) {

        if (!Object.hasOwn(definition.inputs, name)) throw new Error('Undeclared pipeline input');

    }
    const values: Record<string, PipelineJsonValue> = { ...supplied };
    for (const [name, declaration] of Object.entries(definition.inputs)) {

        const flag = args[pipelineInputFlagName(name)];
        if (flag !== undefined) values[name] = parsePipelineInputText(name, declaration, flag);
        if (Object.hasOwn(values, name)) validatePipelineInputValue(name, declaration, values[name]);

    }

    const missing = Object.entries(definition.inputs).filter(([name, declaration]) =>
        declaration.required && !Object.hasOwn(values, name) && !Object.hasOwn(declaration, 'default'));
    const interactive = process.stdin.isTTY && process.stdout.isTTY && !isEnvTruthy(process.env['CI'])
        && !args['json'] && !isYesMode({ yes: args['yes'] === true })
        && (options.channel ?? resolveChannel()) === 'user';
    if (missing.length && !interactive) throw new PipelineMissingInputError(missing.map(([name]) => name));

    const prompts = options.prompts ?? clack;
    for (const [name, declaration] of missing) {

        let answer: unknown;
        if (declaration.choices) {

            answer = await prompts.select<unknown>({
                message: declaration.description,
                options: declaration.choices.map((value) => ({ value, label: String(value) })),
            });

        }
        else if (declaration.type === 'boolean') {

            answer = await prompts.confirm({ message: declaration.description });

        }
        else {

            answer = await prompts.text({
                message: declaration.description,
                validate: (raw) => {

                    const [, invalid] = attemptSync(() => parsePipelineInputText(name, declaration, raw));

                    return invalid ? `Invalid value for pipeline input: ${name}` : undefined;

                },
            });

        }
        if (prompts.isCancel(answer)) throw new PipelineInputCancelledError();
        if (declaration.choices || declaration.type === 'boolean') {

            validatePipelineInputValue(name, declaration, answer);
            values[name] = answer;

        }
        else values[name] = parsePipelineInputText(name, declaration, answer);

    }

    return resolvePipelineInput(definition.inputs, values);

}
