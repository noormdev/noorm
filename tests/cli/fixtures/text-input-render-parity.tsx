/**
 * Child process for the TextInput rendering-parity case.
 *
 * `chalk` fixes its colour level when it is imported, and the suite runs at
 * `FORCE_COLOR=false`, so inside the runner `inverse` and `dim` emit nothing
 * and a cursor assertion has nothing to assert on. Here the parent spawns with
 * `FORCE_COLOR=1`, so the escape codes are real and the two implementations can
 * be compared byte for byte.
 *
 * Prints one JSON object of `{ case: { ours, upstream } }` on stdout.
 */
import { render } from 'ink-testing-library';
import { TextInput as UpstreamTextInput } from '@inkjs/ui';
import React from 'react';

import { TextInput } from '../../../src/tui/components/forms/TextInput.js';
import type { TextInputProps } from '../../../src/tui/components/forms/TextInput.js';

const ESC = String.fromCharCode(27);
const LEFT = `${ESC}[D`;

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

const CASES: Record<string, { props: TextInputProps; keystrokes: string[] }> = {
    'cursor at end': { props: { defaultValue: 'abc' }, keystrokes: [] },
    'cursor mid-string': { props: { defaultValue: 'abc' }, keystrokes: [LEFT, LEFT] },
    'cursor on the last character': { props: { defaultValue: 'abc' }, keystrokes: [LEFT] },
    'placeholder': { props: { placeholder: 'name' }, keystrokes: [] },
    'placeholder while disabled': { props: { placeholder: 'name', isDisabled: true }, keystrokes: [] },
    'empty with no placeholder': { props: {}, keystrokes: [] },
    'empty with no placeholder while disabled': { props: { isDisabled: true }, keystrokes: [] },
    'value while disabled': { props: { defaultValue: 'abc', isDisabled: true }, keystrokes: [] },
    'suggestion at the end': { props: { defaultValue: 'al', suggestions: ['alpha'] }, keystrokes: [] },
    'suggestion with the cursor inside the value': {
        props: { defaultValue: 'al', suggestions: ['alpha'] },
        keystrokes: [LEFT],
    },
};

async function frameOf(
    Component: (props: TextInputProps) => React.ReactElement,
    props: TextInputProps,
    keystrokes: string[],
): Promise<string> {

    const { stdin, lastFrame, unmount } = render(<Component {...props} />);

    await tick();

    for (const keystroke of keystrokes) {

        stdin.write(keystroke);
        await tick();

    }

    const frame = lastFrame() ?? '';

    unmount();

    return frame;

}

const results: Record<string, { ours: string; upstream: string }> = {};

for (const [name, { props, keystrokes }] of Object.entries(CASES)) {

    results[name] = {
        ours: await frameOf(TextInput, props, keystrokes),
        upstream: await frameOf(UpstreamTextInput, props, keystrokes),
    };

}

process.stdout.write(JSON.stringify(results));
