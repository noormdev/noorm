import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { setTimeout } from 'node:timers/promises';
import React, { act, useState } from 'react';
import { Text, useInput } from 'ink';
import { render as inkRender } from 'ink-testing-library';
import { FocusProvider } from '../../../../src/tui/focus.js';
import { PipelineInputEditor } from '../../../../src/tui/screens/pipeline/PipelineInputEditor.js';
import type { PipelineInputDeclaration, PipelineJsonValue } from '../../../../src/core/pipeline/types.js';

const actEnvironment = globalThis as Record<string, unknown>;
let previousActEnvironment: unknown;
let inputDelivered: (() => void) | undefined;
beforeEach(() => {

    previousActEnvironment = actEnvironment['IS_REACT_ACT_ENVIRONMENT'];
    actEnvironment['IS_REACT_ACT_ENVIRONMENT'] = true;

});
afterEach(() => {

    actEnvironment['IS_REACT_ACT_ENVIRONMENT'] = previousActEnvironment;

});

function InputDelivery() {

    useInput(() => inputDelivered?.());

    return null;

}

function render(tree: React.ReactElement) {

    let view!: ReturnType<typeof inkRender>;
    act(() => {

        view = inkRender(<>{tree}<InputDelivery /></>);

    });

    return { ...view, unmount: () => act(() => view.unmount()) };

}

async function press(view: { stdin: { write: (input: string) => void } }, input: string) {

    await act(async () => {

        const delivered = Promise.withResolvers<void>();
        inputDelivered = delivered.resolve;
        view.stdin.write(input);
        await delivered.promise;
        inputDelivered = undefined;

    });

}

async function until(predicate: () => boolean): Promise<void> {

    const deadline = Date.now() + 3000;
    while (!predicate() && Date.now() < deadline) await act(async () => {

        await setTimeout(5);

    });
    expect(predicate()).toBe(true);

}

function EditorHarness({ declaration, supplied }: { declaration: PipelineInputDeclaration; supplied?: PipelineJsonValue }) {

    const [value, setValue] = useState(supplied);
    const [editing, setEditing] = useState(true);

    return editing ? <PipelineInputEditor name="value" declaration={declaration}
        overrides={supplied === undefined ? {} : { value: supplied }}
        onSave={(next) => {

            setValue(next); setEditing(false);

        }}
        onCancel={() => setEditing(false)} /> : <Text>{JSON.stringify({ present: value !== undefined, value })}</Text>;

}

describe('pipeline input editor', () => {

    for (const [type, expected] of [['string', ''], ['boolean', false]] as const) {

        it(`explicitly saves untouched ${type} instead of treating it as absent`, async () => {

            const view = render(<FocusProvider><EditorHarness declaration={{ type, description: 'Deliberate edit', required: true }} /></FocusProvider>);
            await until(() => view.lastFrame()?.includes('› value') === true);
            await press(view, '\x1b[B');
            await until(() => view.lastFrame()?.includes('❯ [ Save ]') === true);
            await press(view, '\r');
            await until(() => view.lastFrame()?.includes('"present":true') === true);
            expect(view.lastFrame()).toContain(JSON.stringify(expected));
            view.unmount();

        });

    }

    it('cancels an untouched draft without supplying it', async () => {

        const view = render(<FocusProvider><EditorHarness declaration={{ type: 'boolean', description: 'Enabled', required: true }} /></FocusProvider>);
        await until(() => view.lastFrame()?.includes('› value') === true);
        await press(view, '\x1b');
        await until(() => view.lastFrame()?.includes('"present":false') === true);
        view.unmount();

    });

    it('saves the typed first choice even when its label collides with a string', async () => {

        const view = render(<FocusProvider><EditorHarness declaration={{ type: 'number', description: 'Choice', required: true, choices: [0, 2] }} /></FocusProvider>);
        await until(() => view.lastFrame()?.includes('› value') === true);
        await press(view, '\x1b[B');
        await until(() => view.lastFrame()?.includes('❯ [ Save ]') === true);
        await press(view, '\r');
        await until(() => view.lastFrame()?.includes('"present":true') === true);
        expect(view.lastFrame()).toContain('"value":0');
        expect(view.lastFrame()).not.toContain('"value":"0"');
        view.unmount();

    });

    it('saving an unchanged default commits presence', async () => {

        const view = render(<FocusProvider><EditorHarness declaration={{ type: 'integer', description: 'Count', required: true, default: 0 }} /></FocusProvider>);
        await until(() => view.lastFrame()?.includes('› value') === true);
        await press(view, '\x1b[B');
        await until(() => view.lastFrame()?.includes('❯ [ Save ]') === true);
        await press(view, '\r');
        await until(() => view.lastFrame()?.includes('"value":0') === true);
        view.unmount();

    });

    it('cancel preserves an explicitly supplied literal value', async () => {

        const value = '  λ café  ';
        const view = render(<FocusProvider><EditorHarness supplied={value} declaration={{ type: 'string', description: 'Literal', required: true }} /></FocusProvider>);
        await until(() => view.lastFrame()?.includes('› value') === true);
        await press(view, '\x1b');
        await until(() => view.lastFrame()?.includes(JSON.stringify(value)) === true);
        expect(view.lastFrame()).toContain('"present":true');
        view.unmount();

    });

    for (const [type, choices, expected] of [
        ['boolean', [false, true], false],
        ['string', ['0', 'false'], '0'],
    ] as const) {

        it(`preserves the ${type} choice's scalar type`, async () => {

            const view = render(<FocusProvider><EditorHarness declaration={{ type, description: 'Scalar choice', required: true, choices: [...choices] }} /></FocusProvider>);
            await until(() => view.lastFrame()?.includes('› value') === true);
            await press(view, '\x1b[B');
            await until(() => view.lastFrame()?.includes('❯ [ Save ]') === true);
            await press(view, '\r');
            await until(() => view.lastFrame()?.includes(`"value":${JSON.stringify(expected)}`) === true);
            view.unmount();

        });

    }

    for (const [type, raw, expected] of [
        ['string', '  λ café  ', '  λ café  '],
        ['integer', '0', 0],
        ['number', '-1.25e2', -125],
        ['object', '{"nested":[0,false]}', { nested: [0, false] }],
        ['array', '[0,false]', [0, false]],
    ] satisfies [PipelineInputDeclaration['type'], string, PipelineJsonValue][]) {

        it(`saves typed ${type} text through the native Form without changing its value`, async () => {

            const view = render(<FocusProvider><EditorHarness declaration={{ type, description: 'Typed input', required: true }} /></FocusProvider>);
            await until(() => view.lastFrame()?.includes('› value') === true);
            await press(view, '\r');
            await until(() => view.lastFrame()?.includes('esc revert') === true);
            await press(view, raw);
            await press(view, '\r');
            await until(() => view.lastFrame()?.includes('↵ edit') === true);
            await press(view, '\x1b[B');
            await until(() => view.lastFrame()?.includes('❯ [ Save ]') === true);
            await press(view, '\r');
            await until(() => view.lastFrame()?.includes(`"value":${JSON.stringify(expected)}`) === true);
            view.unmount();

        });

    }

    it('does not silently supply zero when an unset numeric draft is saved', async () => {

        const view = render(<FocusProvider><EditorHarness declaration={{ type: 'number', description: 'Number', required: true }} /></FocusProvider>);
        await until(() => view.lastFrame()?.includes('› value') === true);
        await press(view, '\x1b[B');
        await until(() => view.lastFrame()?.includes('❯ [ Save ]') === true);
        await press(view, '\r');
        await until(() => view.lastFrame()?.includes('Invalid number value for value') === true);
        expect(view.lastFrame()).not.toContain('"present":true');
        view.unmount();

    });

});
