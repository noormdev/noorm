/**
 * Mouse transport tests.
 *
 * Ink 7.1.1 ships no mouse support, so everything here is ours: the escape
 * sequences that turn tracking on and off, the SGR report parser, the terminal
 * restore, and the two components that answer a click.
 *
 * What is pinned here:
 *
 * - **The flag off means nothing happens.** Not "nothing visible" — no escape
 *   sequence on the wire, no `process` listener, and an SGR report typed at a
 *   list moves no cursor. That is the whole reason the feature ships behind a
 *   flag, so it gets a test rather than a claim.
 * - **The terminal is restored on every path that can end the process.** A
 *   process that dies still holding `?1000h` leaves click-drag selection broken
 *   in every shell in that window, not just noorm's.
 * - **Coordinates are converted, not assumed.** SGR is 1-based against the
 *   terminal; `measureElement` is 0-based against the live region. The row a
 *   click lands on is read out of the rendered frame here rather than counted
 *   by hand, so an off-by-one in either direction fails.
 *
 * The suite runs at `FORCE_COLOR=0`, so where a `ResultTable` cursor sits
 * cannot be read from the `inverse` attribute. Those assertions go through the
 * `onHighlightChange` / `onSelect` callbacks instead. `SelectList` draws a
 * literal `❯`, which survives.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import React from 'react';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { FocusProvider } from '../../src/tui/focus.js';
import {
    MOUSE_ENABLE,
    MOUSE_DISABLE,
    MouseProvider,
    parseMouseReport,
    isMouseReport,
    installTerminalRestore,
    useRowMouse,
    DOUBLE_CLICK_MS,
} from '../../src/tui/mouse.js';
import { SelectList } from '../../src/tui/components/lists/index.js';
import { ResultTable, SqlInput } from '../../src/tui/components/terminal/index.js';
import { Form } from '../../src/tui/components/forms/index.js';
import type { FormValues } from '../../src/tui/components/forms/index.js';

const ESC = String.fromCharCode(27);

/** SGR press report. Column and row are 1-based, the way a terminal sends them. */
const press = (row: number, column = 1, button = 0) => `${ESC}[<${button};${column};${row}M`;

/** SGR release report — same shape, lowercase terminator. */
const release = (row: number, column = 1, button = 0) => `${ESC}[<${button};${column};${row}m`;

const WHEEL_UP = 64;
const WHEEL_DOWN = 65;

const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

/**
 * The frames the UI drew.
 *
 * `ink-testing-library`'s stdout collects every write, and the transport writes
 * escape sequences through the same stream, so `lastFrame()` can be the enable
 * sequence rather than the screen. Dropping those two writes leaves the frames.
 */
const uiFrames = (frames: string[]) => frames.filter((f) => f !== MOUSE_ENABLE && f !== MOUSE_DISABLE);

const lastUi = (frames: string[]) => uiFrames(frames).at(-1) ?? '';

/**
 * Which terminal row a piece of rendered text landed on, 1-based.
 *
 * Read out of the frame rather than counted by hand: that is what makes an
 * off-by-one in the coordinate conversion fail here instead of on someone's
 * terminal.
 */
function terminalRowOf(frame: string, needle: string): number {

    const index = frame.split('\n').findIndex((line) => line.includes(needle));

    if (index < 0) throw new Error(`"${needle}" is not in the frame:\n${frame}`);

    return index + 1;

}

function Harness({ children, mouse = true }: { children: React.ReactNode; mouse?: boolean }) {

    return (
        <MouseProvider enabled={mouse}>
            <FocusProvider>{children}</FocusProvider>
        </MouseProvider>
    );

}

const ITEMS = [
    { key: 'a', label: 'alpha', value: 'alpha' },
    { key: 'b', label: 'bravo', value: 'bravo' },
    { key: 'c', label: 'charlie', value: 'charlie' },
    { key: 'd', label: 'delta', value: 'delta' },
];

const COLUMNS = ['id', 'name'];

const ROWS = [
    { id: 1, name: 'ann' },
    { id: 2, name: 'bob' },
    { id: 3, name: 'cyd' },
    { id: 4, name: 'dee' },
];

describe('cli: mouse transport', () => {

    describe('parseMouseReport', () => {

        it('should convert 1-based terminal coordinates to 0-based live-region coordinates', () => {

            const event = parseMouseReport(press(5, 12));

            expect(event).toEqual({
                kind: 'press',
                button: 'left',
                row: 4,
                column: 11,
                shift: false,
                alt: false,
                ctrl: false,
            });

        });

        it('should read the report Ink hands to useInput, which has the escape byte stripped', () => {

            const withEscape = parseMouseReport(press(5, 12));
            const asUseInputDelivers = parseMouseReport('[<0;12;5M');

            expect(asUseInputDelivers).toEqual(withEscape);

        });

        it('should distinguish press from release by the terminator', () => {

            expect(parseMouseReport(press(3))?.kind).toBe('press');
            expect(parseMouseReport(release(3))?.kind).toBe('release');

        });

        it('should decode the three buttons', () => {

            expect(parseMouseReport(press(1, 1, 0))?.button).toBe('left');
            expect(parseMouseReport(press(1, 1, 1))?.button).toBe('middle');
            expect(parseMouseReport(press(1, 1, 2))?.button).toBe('right');

        });

        it('should decode wheel notches, which arrive even in press-only mode', () => {

            expect(parseMouseReport(press(1, 1, WHEEL_UP))?.button).toBe('wheel-up');
            expect(parseMouseReport(press(1, 1, WHEEL_DOWN))?.button).toBe('wheel-down');

        });

        it('should decode modifier bits', () => {

            expect(parseMouseReport(press(1, 1, 0 + 4))).toMatchObject({ button: 'left', shift: true });
            expect(parseMouseReport(press(1, 1, 0 + 8))).toMatchObject({ button: 'left', alt: true });
            expect(parseMouseReport(press(1, 1, 0 + 16))).toMatchObject({ button: 'left', ctrl: true });

        });

        it('should drop motion reports, which press-only tracking never asked for', () => {

            expect(parseMouseReport(press(1, 1, 32))).toBeNull();
            expect(parseMouseReport(press(1, 1, 32 + 2))).toBeNull();

        });

        it('should return null for anything that is not an SGR report', () => {

            expect(parseMouseReport('a')).toBeNull();
            expect(parseMouseReport(`${ESC}[B`)).toBeNull();
            expect(parseMouseReport(`${ESC}[<0;12M`)).toBeNull();
            expect(parseMouseReport(`${ESC}[<0;12;5X`)).toBeNull();
            expect(parseMouseReport('')).toBeNull();

        });

        it('should recognise a report it refuses to decode, so it is swallowed rather than typed', () => {

            expect(isMouseReport(press(1, 1, 32))).toBe(true);
            expect(parseMouseReport(press(1, 1, 32))).toBeNull();

            expect(isMouseReport('/')).toBe(false);
            expect(isMouseReport(`${ESC}[B`)).toBe(false);

        });

    });

    describe('escape sequences', () => {

        it('should enable press-and-release tracking with SGR coordinates and nothing stronger', () => {

            expect(MOUSE_ENABLE).toBe(`${ESC}[?1000h${ESC}[?1006h`);

            // ?1002 (drag) and ?1003 (motion) take the mouse away from the
            // terminal far more completely than this feature needs.
            expect(MOUSE_ENABLE).not.toContain('1002');
            expect(MOUSE_ENABLE).not.toContain('1003');

        });

        it('should disable in the reverse order it enabled', () => {

            expect(MOUSE_DISABLE).toBe(`${ESC}[?1006l${ESC}[?1000l`);

        });

    });

    describe('terminal restore', () => {

        it('should write the enable sequence on mount and the disable sequence on unmount', async () => {

            const { frames, unmount } = render(
                <Harness>
                    <SelectList items={ITEMS} />
                </Harness>,
            );

            await waitFor(() => frames.includes(MOUSE_ENABLE));

            expect(frames).toContain(MOUSE_ENABLE);
            expect(frames).not.toContain(MOUSE_DISABLE);

            unmount();
            await tick();

            expect(frames).toContain(MOUSE_DISABLE);

        });

        it('should restore on process exit, and stop once uninstalled', () => {

            // Asserted against `installTerminalRestore` rather than against a
            // rendered provider, because `process.emit('exit')` tears an
            // ink-testing-library render down: the unmount cleanup would write
            // the disable sequence even with the exit handler gone, and the
            // test would pass under exactly the bug it exists to catch.
            // Measured, not assumed — tmp/probe-emit-exit.tsx.
            //
            // The provider's half of the chain is the listener-count test
            // below, which pins that it registers one exit listener and takes
            // it away again.
            const restores: string[] = [];
            const uninstall = installTerminalRestore(() => restores.push(MOUSE_DISABLE));

            process.emit('exit', 0);

            expect(restores).toEqual([MOUSE_DISABLE]);

            uninstall();
            process.emit('exit', 0);

            expect(restores).toEqual([MOUSE_DISABLE]);

        });

        it('should restore on SIGINT and SIGTERM', async () => {

            // A standing listener stands in for the lifecycle manager's, which
            // the TUI always has. Without one the transport re-raises the signal
            // and the test runner dies — which is the point of the child-process
            // test below.
            const standIn = () => undefined;
            process.on('SIGINT', standIn);
            process.on('SIGTERM', standIn);

            const { frames, unmount } = render(
                <Harness>
                    <SelectList items={ITEMS} />
                </Harness>,
            );

            await waitFor(() => frames.includes(MOUSE_ENABLE));

            process.emit('SIGINT', 'SIGINT');
            expect(frames.filter((f) => f === MOUSE_DISABLE)).toHaveLength(1);

            process.emit('SIGTERM', 'SIGTERM');
            expect(frames.filter((f) => f === MOUSE_DISABLE)).toHaveLength(2);

            process.removeListener('SIGINT', standIn);
            process.removeListener('SIGTERM', standIn);

            unmount();
            await tick();

        });

        it('should restore and still die on a SIGINT it is the only listener for', () => {

            const fixture = join(import.meta.dir, 'fixtures', 'mouse-sigint-restore.ts');
            const child = spawnSync('bun', ['run', fixture], { encoding: 'utf8' });

            // Restored before the signal was allowed through...
            expect(child.stdout).toContain(MOUSE_DISABLE);

            // ...and the signal still ended the process, rather than the
            // transport's listener swallowing it and leaving the app wedged.
            expect(child.signal).toBe('SIGINT');
            expect(child.status).toBeNull();

        });

        it('should leave no process listeners behind after unmount', async () => {

            const before = {
                exit: process.listenerCount('exit'),
                sigint: process.listenerCount('SIGINT'),
                sigterm: process.listenerCount('SIGTERM'),
                sighup: process.listenerCount('SIGHUP'),
            };

            const { frames, unmount } = render(
                <Harness>
                    <SelectList items={ITEMS} />
                </Harness>,
            );

            await waitFor(() => frames.includes(MOUSE_ENABLE));

            expect(process.listenerCount('exit')).toBe(before.exit + 1);

            unmount();
            await tick();

            expect(process.listenerCount('exit')).toBe(before.exit);
            expect(process.listenerCount('SIGINT')).toBe(before.sigint);
            expect(process.listenerCount('SIGTERM')).toBe(before.sigterm);
            expect(process.listenerCount('SIGHUP')).toBe(before.sighup);

        });

    });

    describe('the flag off', () => {

        it('should write no escape sequence and register no process listener', async () => {

            const before = process.listenerCount('exit');

            const { frames, unmount } = render(
                <Harness mouse={false}>
                    <SelectList items={ITEMS} />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('alpha'));

            expect(frames).not.toContain(MOUSE_ENABLE);
            expect(frames).not.toContain(MOUSE_DISABLE);
            expect(process.listenerCount('exit')).toBe(before);

            unmount();
            await tick();

            expect(frames).not.toContain(MOUSE_DISABLE);

        });

        it('should hand out no row refs, so rows are not tracked at all', async () => {

            const seen: (undefined | 'function')[] = [];

            function Probe() {

                const { enabled, rowRef } = useRowMouse({
                    isActive: true,
                    onClick: () => undefined,
                    onActivate: () => undefined,
                    onWheel: () => undefined,
                });

                seen.push(typeof rowRef(0) === 'function' ? 'function' : undefined);

                return <Text>enabled:{String(enabled)}</Text>;

            }

            const off = render(
                <Harness mouse={false}>
                    <Probe />
                </Harness>,
            );

            await waitFor(() => lastUi(off.frames).includes('enabled:'));

            expect(lastUi(off.frames)).toContain('enabled:false');
            expect(seen.at(-1)).toBeUndefined();

            off.unmount();
            await tick();

            const on = render(
                <Harness>
                    <Probe />
                </Harness>,
            );

            await waitFor(() => lastUi(on.frames).includes('enabled:true'));

            expect(seen.at(-1)).toBe('function');

            on.unmount();
            await tick();

        });

        it('should leave a click inert in a list that would answer it when on', async () => {

            const selected: string[] = [];

            const { frames, stdin, unmount } = render(
                <Harness mouse={false}>
                    <SelectList items={ITEMS} onSelect={(item) => selected.push(item.key)} />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('alpha'));
            await tick();

            const row = terminalRowOf(lastUi(frames), 'charlie');
            const frameBefore = lastUi(frames);

            stdin.write(press(row));
            await tick();
            stdin.write(press(row));
            await tick();

            expect(lastUi(frames)).toBe(frameBefore);
            expect(lastUi(frames)).toContain('❯ alpha');
            expect(selected).toEqual([]);

            unmount();

        });

    });

    describe('SelectList', () => {

        it('should move the cursor to the row that was clicked', async () => {

            const { frames, stdin, unmount } = render(
                <Harness>
                    <SelectList items={ITEMS} />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('alpha'));
            await tick();

            expect(lastUi(frames)).toContain('❯ alpha');

            stdin.write(press(terminalRowOf(lastUi(frames), 'charlie')));
            await waitFor(() => lastUi(frames).includes('❯ charlie'));

            expect(lastUi(frames)).toContain('❯ charlie');
            expect(lastUi(frames)).not.toContain('❯ alpha');

            unmount();

        });

        it('should activate the row on a second click inside the double-click window', async () => {

            const selected: string[] = [];

            const { frames, stdin, unmount } = render(
                <Harness>
                    <SelectList items={ITEMS} onSelect={(item) => selected.push(item.key)} />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('alpha'));
            await tick();

            const row = terminalRowOf(lastUi(frames), 'bravo');

            stdin.write(press(row));
            await waitFor(() => lastUi(frames).includes('❯ bravo'));

            expect(selected).toEqual([]);

            stdin.write(press(row));
            await waitFor(() => selected.length > 0);

            expect(selected).toEqual(['b']);

            unmount();

        });

        it('should not activate when the second click falls outside the window', async () => {

            const selected: string[] = [];

            const { frames, stdin, unmount } = render(
                <Harness>
                    <SelectList items={ITEMS} onSelect={(item) => selected.push(item.key)} />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('alpha'));
            await tick();

            const row = terminalRowOf(lastUi(frames), 'bravo');

            stdin.write(press(row));
            await waitFor(() => lastUi(frames).includes('❯ bravo'));

            await new Promise((resolve) => setTimeout(resolve, DOUBLE_CLICK_MS + 60));

            stdin.write(press(row));
            await tick();

            expect(selected).toEqual([]);
            expect(lastUi(frames)).toContain('❯ bravo');

            unmount();

        });

        it('should not activate twice when a third click follows the double', async () => {

            const selected: string[] = [];

            const { frames, stdin, unmount } = render(
                <Harness>
                    <SelectList items={ITEMS} onSelect={(item) => selected.push(item.key)} />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('alpha'));
            await tick();

            const row = terminalRowOf(lastUi(frames), 'delta');

            stdin.write(press(row));
            await waitFor(() => lastUi(frames).includes('❯ delta'));

            stdin.write(press(row));
            await waitFor(() => selected.length > 0);

            // A triple click is a double followed by a fresh single, not two
            // doubles — otherwise every extra click reopens the row.
            stdin.write(press(row));
            await tick();

            expect(selected).toEqual(['d']);

            unmount();

        });

        it('should not activate when the two clicks land on different rows', async () => {

            const selected: string[] = [];

            const { frames, stdin, unmount } = render(
                <Harness>
                    <SelectList items={ITEMS} onSelect={(item) => selected.push(item.key)} />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('alpha'));
            await tick();

            stdin.write(press(terminalRowOf(lastUi(frames), 'bravo')));
            await waitFor(() => lastUi(frames).includes('❯ bravo'));

            stdin.write(press(terminalRowOf(lastUi(frames), 'charlie')));
            await waitFor(() => lastUi(frames).includes('❯ charlie'));

            expect(selected).toEqual([]);

            unmount();

        });

        it('should ignore a release report, so one click is one action', async () => {

            const selected: string[] = [];

            const { frames, stdin, unmount } = render(
                <Harness>
                    <SelectList items={ITEMS} onSelect={(item) => selected.push(item.key)} />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('alpha'));
            await tick();

            const row = terminalRowOf(lastUi(frames), 'bravo');

            stdin.write(press(row));
            await waitFor(() => lastUi(frames).includes('❯ bravo'));

            stdin.write(release(row));
            await tick();

            expect(selected).toEqual([]);

            unmount();

        });

        it('should ignore a click on a row that is not there', async () => {

            const { frames, stdin, unmount } = render(
                <Harness>
                    <SelectList items={ITEMS} />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('alpha'));
            await tick();

            const frameBefore = lastUi(frames);

            stdin.write(press(40));
            await tick();

            expect(lastUi(frames)).toBe(frameBefore);
            expect(lastUi(frames)).toContain('❯ alpha');

            unmount();

        });

        it('should step the cursor one row per wheel notch and clamp at the ends', async () => {

            const { frames, stdin, unmount } = render(
                <Harness>
                    <SelectList items={ITEMS} />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('alpha'));
            await tick();

            // Up at the top clamps rather than wrapping to the bottom, which is
            // what the arrow keys do — a wheel that wraps reads as a glitch.
            stdin.write(press(1, 1, WHEEL_UP));
            await tick();

            expect(lastUi(frames)).toContain('❯ alpha');

            stdin.write(press(1, 1, WHEEL_DOWN));
            await waitFor(() => lastUi(frames).includes('❯ bravo'));

            expect(lastUi(frames)).toContain('❯ bravo');

            stdin.write(press(1, 1, WHEEL_UP));
            await waitFor(() => lastUi(frames).includes('❯ alpha'));

            expect(lastUi(frames)).toContain('❯ alpha');

            unmount();

        });

        it('should not answer a click while another component holds focus', async () => {

            const selected: string[] = [];

            const { frames, stdin, unmount } = render(
                <Harness>
                    <SelectList
                        items={ITEMS}
                        isFocused={false}
                        onSelect={(item) => selected.push(item.key)}
                    />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('alpha'));
            await tick();

            const row = terminalRowOf(lastUi(frames), 'charlie');
            const frameBefore = lastUi(frames);

            stdin.write(press(row));
            await tick();
            stdin.write(press(row));
            await tick();

            expect(lastUi(frames)).toBe(frameBefore);
            expect(selected).toEqual([]);

            unmount();

        });

        it('should toggle rather than submit on a double click in multi-select', async () => {

            const toggled: string[] = [];
            const submitted: number[] = [];

            const { frames, stdin, unmount } = render(
                <Harness>
                    <SelectList
                        items={ITEMS}
                        multiSelect
                        onToggle={(item) => toggled.push(item.key)}
                        onSubmit={() => submitted.push(1)}
                    />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('alpha'));
            await tick();

            const row = terminalRowOf(lastUi(frames), 'charlie');

            stdin.write(press(row));
            await waitFor(() => lastUi(frames).includes('❯ charlie'));

            stdin.write(press(row));
            await waitFor(() => toggled.length > 0);

            // Enter in multi-select submits the whole list, which is not a
            // row-scoped action; a double click names one row, so it does the
            // row-scoped thing that Space does.
            expect(toggled).toEqual(['c']);
            expect(submitted).toEqual([]);

            unmount();

        });

    });

    describe('ResultTable', () => {

        it('should move the cursor to the row that was clicked', async () => {

            const moves: number[] = [];

            const { frames, stdin, unmount } = render(
                <Harness>
                    <ResultTable
                        columns={COLUMNS}
                        rows={ROWS}
                        autoSort={false}
                        onHighlightChange={(index) => moves.push(index)}
                    />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('cyd'));
            await tick();

            // The table reports a move to row 0 as it mounts, so a wait on
            // "any move at all" would return before the click was answered.
            const settled = moves.length;

            stdin.write(press(terminalRowOf(lastUi(frames), 'cyd')));
            await waitFor(() => moves.length > settled);

            expect(moves.at(-1)).toBe(2);

            unmount();

        });

        it('should open the row on a double click', async () => {

            const opened: Record<string, unknown>[] = [];

            const { frames, stdin, unmount } = render(
                <Harness>
                    <ResultTable
                        columns={COLUMNS}
                        rows={ROWS}
                        autoSort={false}
                        onSelect={(row) => opened.push(row)}
                    />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('dee'));
            await tick();

            const row = terminalRowOf(lastUi(frames), 'dee');

            stdin.write(press(row));
            await tick();

            expect(opened).toEqual([]);

            stdin.write(press(row));
            await waitFor(() => opened.length > 0);

            expect(opened).toEqual([{ id: 4, name: 'dee' }]);

            unmount();

        });

        it('should open the row the sort put there, not the row that was passed in', async () => {

            const opened: Record<string, unknown>[] = [];

            const { frames, stdin, unmount } = render(
                <Harness>
                    <ResultTable
                        columns={COLUMNS}
                        rows={ROWS}
                        onSelect={(row) => opened.push(row)}
                    />
                </Harness>,
            );

            // autoSort defaults on and `id` sorts descending, so the top data
            // row is id 4. A hit test that indexed the input array would open
            // id 1 here.
            await waitFor(() => lastUi(frames).includes('dee'));
            await tick();

            const row = terminalRowOf(lastUi(frames), 'ann');

            stdin.write(press(row));
            await tick();
            stdin.write(press(row));
            await waitFor(() => opened.length > 0);

            expect(opened).toEqual([{ id: 1, name: 'ann' }]);

            unmount();

        });

        it('should not answer a click while it is inactive', async () => {

            const moves: number[] = [];
            const opened: Record<string, unknown>[] = [];

            const { frames, stdin, unmount } = render(
                <Harness>
                    <ResultTable
                        columns={COLUMNS}
                        rows={ROWS}
                        autoSort={false}
                        active={false}
                        onHighlightChange={(index) => moves.push(index)}
                        onSelect={(row) => opened.push(row)}
                    />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('cyd'));
            await tick();

            const row = terminalRowOf(lastUi(frames), 'cyd');
            const settled = [...moves];

            stdin.write(press(row));
            await tick();
            stdin.write(press(row));
            await tick();

            expect(moves).toEqual(settled);
            expect(opened).toEqual([]);

            unmount();

        });

        it('should neither type the report into the filter box nor move the cursor behind it', async () => {

            const moves: number[] = [];

            const { frames, stdin, unmount } = render(
                <Harness>
                    <ResultTable
                        columns={COLUMNS}
                        rows={ROWS}
                        autoSort={false}
                        onHighlightChange={(index) => moves.push(index)}
                    />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('cyd'));
            await tick();

            stdin.write('/');
            await waitFor(() => lastUi(frames).includes('[Enter] Apply'));

            const settled = [...moves];

            stdin.write(press(terminalRowOf(lastUi(frames), 'cyd')));
            await tick();

            // The filter box owns the keys while it is open, and it owns the
            // clicks too — a cursor moving behind it is the grid acting on
            // input that was not addressed to it. Asserted before anything is
            // typed, because applying a filter resets the cursor on its own.
            expect(moves).toEqual(settled);

            stdin.write('b');
            await waitFor(() => lastUi(frames).includes('"b"'));

            expect(lastUi(frames)).toContain('"b"');
            expect(lastUi(frames)).not.toContain('[<');

            unmount();

        });

        it('should step the cursor one row per wheel notch', async () => {

            const moves: number[] = [];

            const { frames, stdin, unmount } = render(
                <Harness>
                    <ResultTable
                        columns={COLUMNS}
                        rows={ROWS}
                        autoSort={false}
                        onHighlightChange={(index) => moves.push(index)}
                    />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('cyd'));
            await tick();

            const settled = moves.length;

            stdin.write(press(1, 1, WHEEL_DOWN));
            await waitFor(() => moves.length > settled);

            expect(moves.at(-1)).toBe(1);

            stdin.write(press(1, 1, WHEEL_UP));
            await waitFor(() => moves.length > settled + 1);

            expect(moves.at(-1)).toBe(0);

            unmount();

        });

    });

    describe('SqlInput', () => {

        it('should not type the report into the SQL input', async () => {

            let value = '';

            const { frames, stdin, unmount } = render(
                <Harness>
                    <SqlInput
                        value={value}
                        onChange={(next) => {

                            value = next;

                        }}
                        onSubmit={() => undefined}
                        onHistoryNavigate={() => undefined}
                    />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('Enter SQL query'));
            await tick();

            stdin.write(press(3, 4));
            await tick();

            expect(value).toBe('');

            // The same handler still types real characters, so the guard is a
            // filter rather than a mute.
            stdin.write('x');
            await waitFor(() => value === 'x');

            expect(value).toBe('x');

            unmount();

        });

    });

    describe('Form in edit mode', () => {

        it('should not type the report into the field being edited', async () => {

            // The most intricate TextInput consumer: the field only exists
            // while the Form is in edit mode, and the Form's own handler is
            // registered alongside the field's. A click has to reach neither.
            const submitted: FormValues[] = [];

            const { frames, stdin, unmount } = render(
                <Harness>
                    <Form
                        fields={[{ key: 'name', label: 'Name', type: 'text' }]}
                        onSubmit={(values) => submitted.push(values)}
                    />
                </Harness>,
            );

            await waitFor(() => lastUi(frames).includes('Name'));
            await tick();

            stdin.write('\r');
            await tick();

            stdin.write('users');
            await waitFor(() => lastUi(frames).includes('users'));

            const row = terminalRowOf(lastUi(frames), 'Name');

            stdin.write(press(row, 12));
            await tick();
            stdin.write(release(row, 12));
            await tick();

            expect(lastUi(frames)).not.toContain('[<');

            // Commit, then walk to the submit action and fire it. What the Form
            // hands back is the assertion that matters — the frame could look
            // clean while the committed value carried the report.
            stdin.write('\r');
            await waitFor(() => !lastUi(frames).includes('❯'), 500);

            stdin.write('\x1B[B');
            await tick();
            stdin.write('\r');
            await waitFor(() => submitted.length > 0);

            expect(submitted).toEqual([{ name: 'users' }]);

            unmount();

        });

    });

});

afterEach(async () => {

    await tick();

});
