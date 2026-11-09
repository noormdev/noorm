import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { parseArgs } from 'citty';
import { sharedArgs } from '../../../src/cli/_utils.js';
import {
    createPipelineInputArgs,
    PipelineInputCancelledError,
    resolvePipelineCliInput,
} from '../../../src/cli/pipeline/input.js';
import type { PipelineDefinition, PipelineInputDeclaration } from '../../../src/core/pipeline/types.js';

type PromptAdapter = NonNullable<NonNullable<Parameters<typeof resolvePipelineCliInput>[2]>['prompts']>;

function definition(inputs: Record<string, PipelineInputDeclaration>): PipelineDefinition {

    return {
        slug: 'example', folder: '/example', manifestPath: '/example/pipeline.yml',
        manifestChecksum: 'checksum', transaction: 'step', concurrency: 4, singleRun: false,
        mode: 'linear', inputs,
        steps: [{ stepNo: 1, id: 'one', sql: 'one.sql', filepath: '/example/one.sql', needs: [] }],
    };

}

const declarations: Record<string, PipelineInputDeclaration> = {
    title: { type: 'string', description: 'Literal title', required: true },
    rate: { type: 'number', description: 'Rate', required: true },
    itemCount: { type: 'integer', description: 'Item count', required: true },
    enabled: { type: 'boolean', description: 'Enable processing', required: true },
    settings: { type: 'object', description: 'Settings object', required: true },
    items: { type: 'array', description: 'Item array', required: true },
    optional: { type: 'string', description: 'Optional note', required: false },
    mode: { type: 'string', description: 'Processing mode', required: true, default: 'fast', choices: ['fast', 'slow'] },
};
const full = definition(declarations);

function args(def: PipelineDefinition, argv: string[]) {

    return parseArgs(argv, { ...sharedArgs, ...createPipelineInputArgs(def) });

}

const cancel = Symbol('cancel');
function promptHarness(answers: unknown[] = []) {

    const calls: { kind: string; options: unknown }[] = [];
    const ask = (kind: string) => async (options: unknown) => {

        calls.push({ kind, options });

        return answers.shift();

    };
    const prompts = {
        text: ask('text'), confirm: ask('confirm'), select: ask('select'),
        isCancel: (value: unknown) => value === cancel,
    } as unknown as PromptAdapter;

    return { calls, prompts };

}

async function rejected(promise: Promise<unknown>): Promise<Error> {

    try {

        await promise;

    }
    catch (error) {

        if (error instanceof Error) return error;
        throw error;

    }
    throw new Error('Expected input resolution to reject');

}

const envNames = ['CI', 'NOORM_YES', 'NOORM_CHANNEL'] as const;
const originalEnv = new Map<string, string | undefined>();
let stdinTTY: PropertyDescriptor | undefined;
let stdoutTTY: PropertyDescriptor | undefined;

function tty(stdin: boolean, stdout: boolean) {

    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: stdin });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: stdout });

}

function restoreTTY(stream: NodeJS.ReadStream | NodeJS.WriteStream, descriptor: PropertyDescriptor | undefined) {

    if (descriptor) Object.defineProperty(stream, 'isTTY', descriptor);
    else Reflect.deleteProperty(stream, 'isTTY');

}

beforeEach(() => {

    for (const name of envNames) {

        originalEnv.set(name, process.env[name]);
        delete process.env[name];

    }
    stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    tty(true, true);

});

afterEach(() => {

    for (const name of envNames) {

        const value = originalEnv.get(name);
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;

    }
    restoreTTY(process.stdin, stdinTTY);
    restoreTTY(process.stdout, stdoutTTY);

});

describe('pipeline CLI inputs with citty', () => {

    it('parses every type, literal strings, falsy values and defaults', async () => {

        const parsed = args(full, [
            '--title=', '--rate=0', '--item-count=0', '--enabled=false',
            '--settings={"nested":[true,null]}', '--items=[1,{"x":false}]',
        ]);
        const result = await resolvePipelineCliInput(full, parsed, { channel: 'user' });
        expect(result).toEqual({
            title: '', rate: 0, itemCount: 0, enabled: false,
            settings: { nested: [true, null] }, items: [1, { x: false }], mode: 'fast',
        });
        expect('optional' in result).toBe(false);
        expect(Object.isFrozen(result)).toBe(true);

    });

    it('uses explicit flags over JSON over defaults, preserving an omitted boolean', async () => {

        const json = JSON.stringify({
            title: 'json title', rate: 2.5, itemCount: 3, enabled: true,
            settings: { from: 'json' }, items: [3], mode: 'slow',
        });
        const first = await resolvePipelineCliInput(full, args(full, ['--input', json, '--title=flag']), { channel: 'user' });
        expect(first).toEqual({
            title: 'flag', rate: 2.5, itemCount: 3, enabled: true,
            settings: { from: 'json' }, items: [3], mode: 'slow',
        });
        const second = await resolvePipelineCliInput(full, args(full, ['--input', json, '--enabled=false', '--rate=0']), { channel: 'user' });
        expect(second['enabled']).toBe(false);
        expect(second['rate']).toBe(0);

    });

    it('keeps string flags literal rather than decoding JSON scalars', async () => {

        const def = definition({ value: { type: 'string', description: 'Value', required: true } });
        for (const value of ['false', '0', 'null', '{"a":1}', '  λ café  ']) {

            const result = await resolvePipelineCliInput(def, args(def, [`--value=${value}`]), { channel: 'user' });
            expect(result['value']).toBe(value);

        }

    });

    it('rejects invalid numeric, boolean, structured and choice flags before prompting', async () => {

        const bad: [string, string][] = [
            ['rate', '01'], ['rate', '1e999'], ['rate', 'NaN'], ['rate', '1.'],
            ['item-count', '1.5'], ['item-count', '9007199254740992'],
            ['enabled', 'yes'], ['settings', '[]'], ['items', '{}'], ['mode', 'turbo'],
        ];
        for (const [name, value] of bad) {

            const harness = promptHarness();
            const error = await rejected(resolvePipelineCliInput(full, args(full, [`--${name}=${value}`]), {
                channel: 'user', prompts: harness.prompts,
            }));
            expect(error).toBeInstanceOf(Error);
            expect(harness.calls).toEqual([]);

        }

    });

    it('rejects non-object JSON input and unsafe nested keys', async () => {

        for (const input of ['[]', 'null', '42', '{"settings":{"__proto__":{"x":1}}}']) {

            const harness = promptHarness();
            await rejected(resolvePipelineCliInput(full, args(full, [`--input=${input}`]), {
                channel: 'user', prompts: harness.prompts,
            }));
            expect(harness.calls).toEqual([]);

        }

    });

    it('rejects unknown JSON keys and does not disclose malformed JSON content', async () => {

        const harness = promptHarness();
        await rejected(resolvePipelineCliInput(full, args(full, ['--input={"unknown":1}']), {
            channel: 'user', prompts: harness.prompts,
        }));
        const secret = 'secret-value-should-not-appear';
        for (const argv of [`--input={"title":"${secret}`, `--settings={"password":"${secret}`]) {

            const error = await rejected(resolvePipelineCliInput(full, args(full, [argv]), {
                channel: 'user', prompts: harness.prompts,
            }));
            expect(String(error)).not.toContain(secret);
            expect(error.stack ?? '').not.toContain(secret);

        }
        expect(harness.calls).toEqual([]);

    });

    it('exposes manifest information in generated argument descriptions', () => {

        const defs = createPipelineInputArgs(full);
        const title = defs['title'];
        const mode = defs['mode'];
        expect(title?.description).toContain('Literal title');
        expect(title?.description?.toLowerCase()).toContain('string');
        expect(title?.description?.toLowerCase()).toContain('required');
        expect(mode?.description).toContain('Processing mode');
        expect(mode?.description).toContain('fast');
        expect(mode?.description).toContain('slow');
        expect(mode?.description?.toLowerCase()).toContain('default');

    });

    it('prompts only for missing required inputs using appropriate controls', async () => {

        const def = definition({
            chosen: { type: 'integer', description: 'Choice', required: true, choices: [0, 1] },
            confirmed: { type: 'boolean', description: 'Confirmation', required: true },
            data: { type: 'object', description: 'Object', required: true },
            untouched: { type: 'string', description: 'Optional', required: false },
            defaulted: { type: 'string', description: 'Default', required: true, default: 'set' },
        });
        const harness = promptHarness([0, false, '{"nested":[1]}']);
        const result = await resolvePipelineCliInput(def, args(def, []), { channel: 'user', prompts: harness.prompts });
        expect(harness.calls.map((call) => call.kind)).toEqual(['select', 'confirm', 'text']);
        expect(result).toEqual({ chosen: 0, confirmed: false, data: { nested: [1] }, defaulted: 'set' });
        expect('untouched' in result).toBe(false);

    });

    it('offers shared validation for interactive numeric and structured text', async () => {

        const def = definition({
            count: { type: 'integer', description: 'Count', required: true },
            data: { type: 'array', description: 'Data', required: true },
        });
        const harness = promptHarness(['0', '[1,2]']);
        const result = await resolvePipelineCliInput(def, args(def, []), { channel: 'user', prompts: harness.prompts });
        expect(result).toEqual({ count: 0, data: [1, 2] });
        const countOptions = harness.calls[0]?.options as { validate?: (value: string) => string | undefined };
        const dataOptions = harness.calls[1]?.options as { validate?: (value: string) => string | undefined };
        expect(typeof countOptions.validate).toBe('function');
        expect(typeof dataOptions.validate).toBe('function');
        expect(countOptions.validate?.('1.5')).toBeTruthy();
        expect(countOptions.validate?.('0')).toBeFalsy();
        expect(dataOptions.validate?.('{}')).toBeTruthy();
        expect(dataOptions.validate?.('[1]')).toBeFalsy();

    });

    it('does not treat explicitly false environment values as noninteractive', async () => {

        process.env['CI'] = 'false';
        process.env['NOORM_YES'] = '0';
        const def = definition({ value: { type: 'string', description: 'Value', required: true } });
        const harness = promptHarness(['answer']);
        const result = await resolvePipelineCliInput(def, args(def, []), { channel: 'user', prompts: harness.prompts });
        expect(result['value']).toBe('answer');
        expect(harness.calls.map((call) => call.kind)).toEqual(['text']);

    });

    it('reports all missing required names without prompting in noninteractive modes', async () => {

        const def = definition({
            first: { type: 'string', description: 'First', required: true },
            second: { type: 'boolean', description: 'Second', required: true },
            optional: { type: 'number', description: 'Optional', required: false },
            defaulted: { type: 'string', description: 'Default', required: true, default: 'x' },
        });
        const modes = [
            { stdin: false, stdout: true, argv: [], env: undefined, channel: 'user' as const },
            { stdin: true, stdout: false, argv: [], env: undefined, channel: 'user' as const },
            { stdin: true, stdout: true, argv: ['--json'], env: undefined, channel: 'user' as const },
            { stdin: true, stdout: true, argv: ['--yes'], env: undefined, channel: 'user' as const },
            { stdin: true, stdout: true, argv: [], env: 'CI', channel: 'user' as const },
            { stdin: true, stdout: true, argv: [], env: 'NOORM_YES', channel: 'user' as const },
            { stdin: true, stdout: true, argv: [], env: undefined, channel: 'agent' as const },
        ];
        for (const mode of modes) {

            tty(mode.stdin, mode.stdout);
            delete process.env['CI'];
            delete process.env['NOORM_YES'];
            if (mode.env) process.env[mode.env] = '1';
            const harness = promptHarness();
            const error = await rejected(resolvePipelineCliInput(def, args(def, mode.argv), {
                channel: mode.channel, prompts: harness.prompts,
            }));
            expect(error.message).toContain('first');
            expect(error.message).toContain('second');
            expect(error.message).not.toContain('optional');
            expect(error.message).not.toContain('defaulted');
            expect(harness.calls).toEqual([]);

        }

    });

    it('throws a dedicated cancellation error without asking subsequent questions', async () => {

        const def = definition({
            first: { type: 'string', description: 'First', required: true },
            second: { type: 'boolean', description: 'Second', required: true },
        });
        const harness = promptHarness([cancel, true]);
        const error = await rejected(resolvePipelineCliInput(def, args(def, []), {
            channel: 'user', prompts: harness.prompts,
        }));
        expect(error).toBeInstanceOf(PipelineInputCancelledError);
        expect(harness.calls.map((call) => call.kind)).toEqual(['text']);

    });

});
