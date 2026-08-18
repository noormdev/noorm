/**
 * TextInput parity and mouse-report tests.
 *
 * `src/tui/components/forms/TextInput.tsx` is a copy of `@inkjs/ui`'s
 * `TextInput` with one deliberate difference: a mouse report is dropped rather
 * than typed into the field. Everything else has to match, because the swap
 * reached 11 files and 21 call sites and none of them asked for a keyboard
 * change.
 *
 * "Match" is asserted differentially rather than by hand: the same keystroke
 * script is driven through both components and their `onChange` / `onSubmit`
 * logs are compared. A hand-written expectation would only pin what the author
 * remembered to write down, and would keep passing if both drifted. Rendering
 * parity is covered the same way, in a child process at `FORCE_COLOR=1` —
 * the suite runs with colour off, where the cursor is an ordinary space and a
 * cursor assertion cannot fail.
 */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { TextInput as UpstreamTextInput } from '@inkjs/ui';
import React from 'react';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { TextInput } from '../../../src/tui/components/forms/TextInput.js';
import type { TextInputProps } from '../../../src/tui/components/forms/TextInput.js';

const ESC = String.fromCharCode(27);

const KEYS = {
    UP: `${ESC}[A`,
    DOWN: `${ESC}[B`,
    RIGHT: `${ESC}[C`,
    LEFT: `${ESC}[D`,
    ENTER: '\r',
    TAB: '\t',
    BACKSPACE: '\x7F',
    DELETE: `${ESC}[3~`,
};

/** SGR press report. */
const press = (row = 5, column = 12) => `${ESC}[<0;${column};${row}M`;

/** SGR release report — same gesture, lowercase terminator. */
const release = (row = 5, column = 12) => `${ESC}[<0;${column};${row}m`;

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

interface Log {
    changes: string[];
    submits: string[];
    frames: string[];
}

/**
 * Drives one component through a keystroke script and returns what it reported.
 *
 * Takes the component rather than an element so the same script can be run
 * against ours and upstream's without the caller repeating the props.
 */
async function drive(
    Component: (props: TextInputProps) => React.ReactElement,
    props: TextInputProps,
    keystrokes: string[],
): Promise<Log> {

    const changes: string[] = [];
    const submits: string[] = [];

    const { stdin, frames, lastFrame, unmount } = render(
        <Component
            {...props}
            onChange={(value) => changes.push(value)}
            onSubmit={(value) => submits.push(value)}
        />,
    );

    await tick();

    for (const keystroke of keystrokes) {

        stdin.write(keystroke);
        await tick();

    }

    const finalFrame = lastFrame() ?? '';

    unmount();
    await tick();

    return { changes, submits, frames: [...frames, finalFrame] };

}

/**
 * Runs the script through both implementations and asserts they agree.
 *
 * Returns ours so a caller can add assertions about the absolute values too —
 * parity alone would be satisfied by two components that are both wrong.
 */
async function expectParity(
    props: TextInputProps,
    keystrokes: string[],
): Promise<Log> {

    const ours = await drive(TextInput, props, keystrokes);
    const upstream = await drive(UpstreamTextInput, props, keystrokes);

    expect(ours.changes).toEqual(upstream.changes);
    expect(ours.submits).toEqual(upstream.submits);
    expect(ours.frames.at(-1)).toBe(upstream.frames.at(-1) ?? '');

    return ours;

}

describe('cli: components/TextInput', () => {

    describe('keyboard parity with @inkjs/ui', () => {

        it('should report the same changes for plain typing', async () => {

            const ours = await expectParity({}, ['hello']);

            expect(ours.changes).toEqual(['hello']);

        });

        it('should insert at the cursor after moving left', async () => {

            const ours = await expectParity({}, ['abc', KEYS.LEFT, KEYS.LEFT, 'X']);

            expect(ours.changes.at(-1)).toBe('aXbc');

        });

        it('should erase the character before the cursor on backspace', async () => {

            const ours = await expectParity({}, ['abcd', KEYS.LEFT, KEYS.BACKSPACE]);

            expect(ours.changes.at(-1)).toBe('abd');

        });

        it('should erase backwards on the Delete key, the way upstream always has', async () => {

            // tui-development.md tells new code to guard on key.backspace
            // alone. This is not new code: 21 call sites have had upstream's
            // `key.backspace || key.delete` all along, and changing it here
            // would smuggle a keyboard change into a mouse fix.
            const ours = await expectParity({}, ['abcd', KEYS.DELETE]);

            expect(ours.changes.at(-1)).toBe('abc');

        });

        it('should move the cursor back right', async () => {

            const ours = await expectParity({}, ['abc', KEYS.LEFT, KEYS.LEFT, KEYS.RIGHT, 'X']);

            expect(ours.changes.at(-1)).toBe('abXc');

        });

        it('should submit the current value on Enter without changing it', async () => {

            const ours = await expectParity({}, ['hi', KEYS.ENTER]);

            expect(ours.submits).toEqual(['hi']);
            expect(ours.changes.at(-1)).toBe('hi');

        });

        it('should ignore Tab, the arrows that belong to the parent, and Ctrl+C', async () => {

            const ours = await expectParity({}, ['ab', KEYS.TAB, KEYS.UP, KEYS.DOWN, '\x03']);

            expect(ours.changes).toEqual(['ab']);

        });

        it('should ignore every keystroke while disabled', async () => {

            const ours = await expectParity(
                { isDisabled: true, defaultValue: 'fixed' },
                ['typed', KEYS.BACKSPACE, KEYS.ENTER],
            );

            expect(ours.changes).toEqual([]);
            expect(ours.submits).toEqual([]);

        });

        it('should complete a suggestion on Enter', async () => {

            const ours = await expectParity(
                { suggestions: ['alpha', 'beta'] },
                ['al', KEYS.ENTER],
            );

            expect(ours.submits).toEqual(['alpha']);
            expect(ours.changes.at(-1)).toBe('alpha');

        });

        it('should report nothing on mount', async () => {

            const ours = await expectParity({ defaultValue: 'preset' }, []);

            expect(ours.changes).toEqual([]);

        });

        it('should start the cursor at the end of the default value', async () => {

            const ours = await expectParity({ defaultValue: 'abc' }, ['Z']);

            expect(ours.changes.at(-1)).toBe('abcZ');

        });

    });

    describe('the one deliberate difference', () => {

        it('should drop a press report instead of typing it into the field', async () => {

            const ours = await drive(TextInput, {}, ['hello', press()]);
            const upstream = await drive(UpstreamTextInput, {}, ['hello', press()]);

            expect(ours.changes).toEqual(['hello']);

            // Upstream is what makes this test able to fail: it proves the
            // report really does reach a TextInput's handler, so a green
            // assertion above is the guard working rather than the report
            // never arriving.
            expect(upstream.changes.at(-1)).toContain('[<0;12;5M');

        });

        it('should drop a release report as well as a press', async () => {

            // One gesture emits both. A guard that only matched `M` would let
            // the release through, which is half the damage.
            const ours = await drive(TextInput, {}, ['hello', release()]);
            const upstream = await drive(UpstreamTextInput, {}, ['hello', release()]);

            expect(ours.changes).toEqual(['hello']);
            expect(upstream.changes.at(-1)).toContain('[<0;12;5m');

        });

        it('should stay intact across a whole click gesture and keep taking input after it', async () => {

            const ours = await drive(
                TextInput,
                {},
                ['hello', press(), release(), press(), release(), ' world'],
            );

            expect(ours.changes.at(-1)).toBe('hello world');
            expect(ours.frames.at(-1)).not.toContain('[<');

        });

        it('should not move the cursor when a report lands mid-string', async () => {

            const ours = await drive(
                TextInput,
                {},
                ['abc', KEYS.LEFT, press(), release(), 'X'],
            );

            expect(ours.changes.at(-1)).toBe('abXc');

        });

    });

    describe('rendering', () => {

        it('should draw the cursor, placeholder and suggestion exactly as upstream does', () => {

            // In a child process, because chalk decides whether to emit SGR at
            // import time from the environment. The suite runs at
            // FORCE_COLOR=false, where `inverse` renders as a plain space and
            // a cursor assertion cannot fail.
            const fixture = join(import.meta.dir, '..', 'fixtures', 'text-input-render-parity.tsx');
            const child = spawnSync('bun', ['run', fixture], {
                encoding: 'utf8',
                env: { ...process.env, FORCE_COLOR: '1' },
            });

            expect(child.stderr).toBe('');
            expect(child.status).toBe(0);

            const cases = JSON.parse(child.stdout);

            expect(Object.keys(cases).length).toBeGreaterThan(0);

            for (const [name, pair] of Object.entries<{ ours: string; upstream: string }>(cases)) {

                // Both halves matter: identical output is only meaningful if
                // the escape codes are actually being emitted.
                expect(`${name}: ${pair.ours}`).toBe(`${name}: ${pair.upstream}`);

            }

            expect(cases['cursor at end'].ours).toContain(`${ESC}[7m`);
            expect(cases['placeholder'].ours).toContain(`${ESC}[2m`);

        });

    });

});
