/** Hotkey: a click on a `[key] Label` hint presses that key, through the same path the keyboard takes. */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';
import React from 'react';

import { FocusProvider, useBusy, useIsGuarded } from '../../../src/tui/focus.js';
import { MouseProvider, MOUSE_ENABLE, MOUSE_DISABLE, isMouseReport, useRowMouse } from '../../../src/tui/mouse.js';
import { Hotkey, KeyTarget, resolveHotkey } from '../../../src/tui/components/layout/index.js';
import { TextInput } from '../../../src/tui/components/forms/index.js';
import { Confirm, ProtectedConfirm } from '../../../src/tui/components/dialogs/index.js';

const ESC = String.fromCharCode(27);

const press = (row: number, column = 1, button = 0) => `${ESC}[<${button};${column};${row}M`;
const move = (row: number, column = 1) => press(row, column, 35);

const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

const uiFrames = (frames: string[]) => frames.filter((f) => f !== MOUSE_ENABLE && f !== MOUSE_DISABLE);
const lastUi = (frames: string[]) => uiFrames(frames).at(-1) ?? '';
const plain = (text: string) => text.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');

/** 1-based row and column of `needle`, pointing at its second character. */
function locate(frame: string, needle: string): { row: number; column: number } {

    const lines = plain(frame).split('\n');
    const index = lines.findIndex((line) => line.includes(needle));

    if (index < 0) throw new Error(`"${needle}" is not in the frame:\n${frame}`);

    return { row: index + 1, column: (lines[index] ?? '').indexOf(needle) + 2 };

}

function clickOn(stdin: { write: (data: string) => void }, frame: string, needle: string): void {

    const { row, column } = locate(frame, needle);

    stdin.write(press(row, column));

}

interface Pressed {
    input: string;
    escape: boolean;
    enter: boolean;
    tab: boolean;
}

/** Stands in for whatever screen holds focus: records what reaches a `useInput` handler. */
function Listener({ log }: { log: Pressed[] }) {

    useInput((input, key) => {

        if (isMouseReport(input)) return;

        log.push({ input, escape: key.escape, enter: key.return, tab: key.tab });

    });

    return null;

}

function Harness({ children }: { children: React.ReactNode }) {

    return (
        <MouseProvider enabled>
            <FocusProvider>{children}</FocusProvider>
        </MouseProvider>
    );

}

async function mount(children: React.ReactNode) {

    const log: Pressed[] = [];
    const rendered = render(
        <Harness>
            <Listener log={log} />
            <Box flexDirection="column">{children}</Box>
        </Harness>,
    );

    await waitFor(() => lastUi(rendered.frames).includes('['));
    await tick();

    return { ...rendered, log };

}

describe('cli: resolveHotkey', () => {

    it('should map named keys and single characters to the input the keyboard sends', () => {

        expect(resolveHotkey('Esc')).toBe(ESC);
        expect(resolveHotkey('esc')).toBe(ESC);
        expect(resolveHotkey('Enter')).toBe('\r');
        expect(resolveHotkey('Tab')).toBe('\t');
        expect(resolveHotkey('Space')).toBe(' ');
        expect(resolveHotkey('r')).toBe('r');
        expect(resolveHotkey('+')).toBe('+');
        expect(resolveHotkey('/')).toBe('/');
        expect(resolveHotkey('Shift+L')).toBe('L');

    });

    it('should take the first alternative of a compound label', () => {

        expect(resolveHotkey('Enter/Esc')).toBe('\r');
        expect(resolveHotkey('y/Enter')).toBe('y');

    });

    it('should name no key for navigation hints, which stay plain text', () => {

        // `Ctrl+U/D` must not become a bare `D`, which toggles dry-run globally.
        for (const label of ['↑↓', '↑/↓', '^U/^D', 'any', 'Esc Esc', 'Up/Down', 'Ctrl+U/D']) {

            expect(resolveHotkey(label)).toBeNull();

        }

    });

});

describe('cli: Hotkey click', () => {

    it('should press the letter, so whatever holds focus answers it', async () => {

        const { frames, stdin, log, unmount } = await mount(<Hotkey keys="a">Add</Hotkey>);
        const { row, column } = locate(lastUi(frames), '[a] Add');

        stdin.write(press(row, column));
        await waitFor(() => log.some((entry) => entry.input === 'a'));

        expect(log.some((entry) => entry.input === 'a')).toBe(true);

        unmount();

    });

    it('should press Escape and Enter as the keys they are', async () => {

        const { frames, stdin, log, unmount } = await mount(
            <Box columnGap={2}>
                <Hotkey keys="Esc">Back</Hotkey>
                <Hotkey keys="Enter">Use</Hotkey>
            </Box>,
        );

        clickOn(stdin, lastUi(frames), '[Esc] Back');
        await waitFor(() => log.some((entry) => entry.escape));

        clickOn(stdin, lastUi(frames), '[Enter] Use');
        await waitFor(() => log.some((entry) => entry.enter));

        expect(log.some((entry) => entry.escape)).toBe(true);
        expect(log.some((entry) => entry.enter)).toBe(true);

        unmount();

    });

    it('should press once on a double click, so two quick clicks do not leave two screens', async () => {

        const { frames, stdin, log, unmount } = await mount(<Hotkey keys="Esc">Back</Hotkey>);
        const { row, column } = locate(lastUi(frames), '[Esc] Back');

        stdin.write(press(row, column));
        await tick();
        stdin.write(press(row, column));
        await tick();

        expect(log.filter((entry) => entry.escape)).toHaveLength(1);

        unmount();

    });

    it('should do nothing for a hint that names no single key', async () => {

        const { frames, stdin, log, unmount } = await mount(<Hotkey keys="↑↓">Scroll</Hotkey>);
        const { row, column } = locate(lastUi(frames), '[↑↓] Scroll');

        stdin.write(press(row, column));
        await tick();

        expect(log).toHaveLength(0);

        unmount();

    });

    it('should not type a letter into a field that is taking input, but still press Escape', async () => {

        const { frames, stdin, log, unmount } = await mount(
            <>
                <TextInput defaultValue="" />
                <Box columnGap={2}>
                    <Hotkey keys="r">Retry</Hotkey>
                    <Hotkey keys="Esc">Back</Hotkey>
                </Box>
            </>,
        );

        const retry = locate(lastUi(frames), '[r] Retry');

        stdin.write(press(retry.row, retry.column));
        await tick();

        expect(log.some((entry) => entry.input === 'r')).toBe(false);

        const back = locate(lastUi(frames), '[Esc] Back');

        stdin.write(press(back.row, back.column));
        await waitFor(() => log.some((entry) => entry.escape));

        expect(log.some((entry) => entry.escape)).toBe(true);

        unmount();

    });

    it('should shade the hint under the pointer', async () => {

        const level = chalk.level;

        chalk.level = 1;

        const { frames, stdin, unmount } = await mount(
            <>
                <Hotkey keys="a">Add</Hotkey>
                <Hotkey keys="d">Delete</Hotkey>
            </>,
        );

        const shaded = (name: string) => (lastUi(frames).split('\n').find((line) => line.includes(name)) ?? '').includes(`${ESC}[100m`);
        const add = locate(lastUi(frames), '[a] Add');

        expect(shaded('[a] Add')).toBe(false);

        stdin.write(move(add.row, add.column));
        await waitFor(() => shaded('[a] Add'));

        expect(shaded('[a] Add')).toBe(true);
        expect(shaded('[d] Delete')).toBe(false);

        unmount();
        chalk.level = level;

    });

    it('should render the hint text exactly as the plain footer did', async () => {

        const { frames, unmount } = await mount(<Hotkey keys="Enter/Esc">Back</Hotkey>);

        expect(plain(lastUi(frames))).toContain('[Enter/Esc] Back');

        unmount();

    });

});

describe('cli: Hotkey with a colored key', () => {

    it('should keep the label undimmed and the text contiguous', async () => {

        const { frames, unmount } = await mount(<Hotkey keys="a" keyColor="cyan" dim={false}>Acquire - Obtain lock</Hotkey>);

        expect(plain(lastUi(frames))).toContain('[a] Acquire - Obtain lock');

        unmount();

    });

});

describe('cli: Hotkey guards', () => {

    it('should drop the second press of a double click when a new screen drew a hint under the pointer', async () => {

        const escapes: string[] = [];

        function Screens() {

            const [screen, setScreen] = React.useState(0);

            useInput((_input, key) => {

                if (!key.escape) return;

                escapes.push(`screen ${screen}`);
                setScreen((current) => current + 1);

            });

            // A fresh instance at the same cell each time, as a screen that went back draws.
            return <Hotkey key={screen} keys="Esc">Back</Hotkey>;

        }

        const { frames, stdin, unmount } = await mount(<Screens />);
        const { row, column } = locate(lastUi(frames), '[Esc] Back');

        stdin.write(press(row, column));
        await tick();
        stdin.write(press(row, column));
        await tick();

        // Two Escapes would have left two screens.
        expect(escapes).toEqual(['screen 0']);

        unmount();

    });

    it('should ignore the second press of a double click on a target that is not the one that took the first', async () => {

        const log: string[] = [];

        function Target({ id, onFirst }: { id: string; onFirst: () => void }) {

            const { rowRef } = useRowMouse({
                isActive: true,
                onClick: () => {

                    log.push(id);
                    onFirst();

                },
                onActivate: () => log.push(`${id}:double`),
                onWheel: () => undefined,
            });

            return <Box ref={rowRef(0)}><Text>target</Text></Box>;

        }

        function Swap() {

            const [n, setN] = React.useState(0);

            return <Target key={n} id={`#${n}`} onFirst={() => setN(1)} />;

        }

        const { frames, stdin, unmount } = await mount(<Swap />);
        const { row, column } = locate(lastUi(frames), 'target');

        stdin.write(press(row, column));
        await tick();
        stdin.write(press(row, column));
        await tick();

        // The new target at the same cell is not a double click's second half.
        expect(log).toEqual(['#0']);

        unmount();

    });

    it('should not press behind a confirmation that holds the screen', async () => {

        const answers: string[] = [];

        const { frames, stdin, unmount } = await mount(
            <>
                <Confirm message="Delete it?" onConfirm={() => answers.push('yes')} onCancel={() => answers.push('no')} />
                <Hotkey keys="Enter">Edit</Hotkey>
            </>,
        );

        // Enter on the confirmation would answer Yes, which is not what `[Enter] Edit` says.
        clickOn(stdin, lastUi(frames), '[Enter] Edit');
        await tick();

        expect(answers).toEqual([]);

        unmount();

    });

    it('should not shade a hint whose press would be dropped', async () => {

        chalk.level = 1;

        const { frames, stdin, unmount } = await mount(
            <>
                <TextInput defaultValue="" />
                <Hotkey keys="h">History</Hotkey>
            </>,
        );

        const { row, column } = locate(lastUi(frames), '[h] History');

        stdin.write(move(row, column));
        await tick();

        expect((lastUi(frames).split('\n').find((line) => line.includes('[h] History')) ?? '')).not.toContain(`${ESC}[100m`);

        unmount();

    });

    it('should neither press nor shade a disabled target, like a row the keyboard also skips', async () => {

        chalk.level = 1;

        const { frames, stdin, log, unmount } = await mount(
            <KeyTarget keys="3" disabled><Text>[3] Procedures 0</Text></KeyTarget>,
        );

        const { row, column } = locate(lastUi(frames), '[3] Procedures');

        stdin.write(move(row, column));
        await tick();
        stdin.write(press(row, column));
        await tick();

        expect(log.some((entry) => entry.input === '3')).toBe(false);
        expect(lastUi(frames).split('\n').find((line) => line.includes('Procedures')) ?? '').not.toContain(`${ESC}[100m`);

        unmount();

    });

    it('should press an enabled numbered target, so a category row answers its number key', async () => {

        const { frames, stdin, log, unmount } = await mount(
            <KeyTarget keys="1" block><Text>[1] Tables 74</Text></KeyTarget>,
        );

        clickOn(stdin, lastUi(frames), '[1] Tables');
        await waitFor(() => log.some((entry) => entry.input === '1'));

        expect(log.some((entry) => entry.input === '1')).toBe(true);

        unmount();

    });

    it('should answer a click on the protected confirmation buttons', async () => {

        const answers: string[] = [];

        const { frames, stdin, unmount } = await mount(
            <ProtectedConfirm configName="prod" action="delete" confirmPhrase="yes-prod" onConfirm={() => answers.push('confirm')} onCancel={() => answers.push('cancel')} />,
        );

        // The phrase is not typed, so Enter must not confirm.
        clickOn(stdin, lastUi(frames), '[Enter] Confirm');
        await tick();

        expect(answers).toEqual([]);
        expect(plain(lastUi(frames))).toContain('Type "yes-prod" to confirm');

        clickOn(stdin, lastUi(frames), '[Esc] Cancel');
        await waitFor(() => answers.length > 0);

        expect(answers).toEqual(['cancel']);

        unmount();

    });

    it('should hold the busy guard only while a component asks for it', async () => {

        function Probe({ busy }: { busy: boolean }) {

            useBusy(busy);

            const isGuarded = useIsGuarded();

            return <Text>guarded:{String(isGuarded('busy'))}</Text>;

        }

        const first = render(<FocusProvider><Probe busy={true} /></FocusProvider>);

        await waitFor(() => lastUi(first.frames).includes('guarded:'));
        first.rerender(<FocusProvider><Probe busy={true} /></FocusProvider>);
        await tick();

        // The guard is read at event time: a later render sees what the effect set.
        expect(lastUi(first.frames)).toContain('guarded:true');

        first.unmount();

        const second = render(<FocusProvider><Probe busy={false} /></FocusProvider>);

        await waitFor(() => lastUi(second.frames).includes('guarded:'));

        expect(lastUi(second.frames)).toContain('guarded:false');

        second.unmount();

    });

});
