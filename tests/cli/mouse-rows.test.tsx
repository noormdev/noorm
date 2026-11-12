/**
 * Mouse on the lists that draw their own rows.
 *
 * These screens do not go through `SelectList`, so before they called
 * `useRowMouse` a click and the pointer did nothing on them while the same
 * gestures worked one screen over. What is pinned is that each one behaves the
 * way `SelectList` does: a click moves the cursor, a second click does what
 * Enter does, a wheel notch steps the cursor, the row under the pointer is
 * shaded unless the cursor is on it, and a mode that owns its keys owns its
 * clicks too.
 *
 * The suite runs under both `FORCE_COLOR=0` and `FORCE_COLOR=true`, so every
 * assertion on text goes through `plain`, and shading is asserted with chalk
 * pinned to a level that emits the hover background.
 */
import { describe, it, expect, vi, mock, beforeEach, afterEach } from 'bun:test';
import { render } from 'ink-testing-library';
import { stripVTControlCharacters } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';
import React from 'react';

import type { KnownUser } from '../../src/core/identity/index.js';
import type { SqlExecutionResult } from '../../src/core/sql-terminal/types.js';

import { FocusProvider } from '../../src/tui/focus.js';
import { MouseProvider } from '../../src/tui/mouse.js';
import { RouterProvider } from '../../src/tui/router.js';
import { AppContextProvider } from '../../src/tui/app-context.js';
import { ToastProvider } from '../../src/tui/components/index.js';
import { LogViewerOverlay } from '../../src/tui/components/overlays/LogViewerOverlay.js';
import { SqlClearScreen } from '../../src/tui/screens/db/SqlClearScreen.js';
import { SqlHistoryScreen } from '../../src/tui/screens/db/SqlHistoryScreen.js';
import { KnownUsersScreen } from '../../src/tui/screens/identity/KnownUsersScreen.js';
import { SqlHistoryManager } from '../../src/core/sql-terminal/index.js';

const actualCore = await import('../../src/core/index.js');
const actualIdentity = await import('../../src/core/identity/index.js');

const ESC = String.fromCharCode(27);

/** SGR press report. Column and row are 1-based, the way a terminal sends them. */
const press = (row: number, column = 1, button = 0) => `${ESC}[<${button};${column};${row}M`;

/** SGR motion report with no button held. */
const move = (row: number, column = 1) => press(row, column, 35);

const WHEEL_UP = 64;
const WHEEL_DOWN = 65;
const HOVER_BG = `${ESC}[100m`;

const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

    // A silent timeout lets a test pass with the feature broken.
    if (!predicate()) throw new Error(`waitFor timed out after ${timeoutMs}ms`);

}

/** The frame without colour, so a column or a marker reads the same under any FORCE_COLOR. */
const plain = (frame: string | undefined) => stripVTControlCharacters(frame ?? '');

/** Which terminal row a piece of rendered text landed on, 1-based. */
function terminalRowOf(frame: string, needle: string): number {

    const index = frame.split('\n').findIndex((line) => line.includes(needle));

    if (index < 0) throw new Error(`"${needle}" is not in the frame:\n${frame}`);

    return index + 1;

}

const lineOf = (frame: string, needle: string) => frame.split('\n').find((line) => line.includes(needle)) ?? '';

function makeConfig() {

    return {
        name: 'test',
        type: 'local' as const,
        isTest: true,
        access: { user: 'admin' as const, agent: 'admin' as const },
        connection: { dialect: 'sqlite' as const, database: ':memory:' },
    };

}

let knownUsers: Record<string, KnownUser> = {};
let logPath = '';

const createMockStateManager = () => ({
    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfig: vi.fn().mockReturnValue(makeConfig()),
    getActiveConfigName: vi.fn().mockReturnValue('test'),
    listConfigs: vi.fn().mockReturnValue([makeConfig()]),
    getConfig: vi.fn().mockReturnValue(makeConfig()),
    getKnownUsers: vi.fn(() => knownUsers),
    setConfig: vi.fn().mockResolvedValue(undefined),
    setActiveConfig: vi.fn().mockResolvedValue(undefined),
    hasPrivateKey: vi.fn().mockReturnValue(true),
    isLoaded: true,
});

const createMockSettingsManager = () => ({
    load: vi.fn().mockResolvedValue({ version: '0.1.0' }),
    isLoaded: true,
    settings: { version: '0.1.0', logging: { file: logPath } },
    getStages: vi.fn().mockReturnValue({}),
    getStage: vi.fn().mockReturnValue(undefined),
});

let mockStateManager = createMockStateManager();
let mockSettingsManager = createMockSettingsManager();

// `mock.module` never restores, so this file runs in its own process in CI
// (see the "Run mouse rows tests (isolated)" step), like cli-logger-settings.
mock.module('../../src/core/index.js', () => ({
    ...actualCore,
    getStateManager: vi.fn(() => mockStateManager),
    getSettingsManager: vi.fn(() => mockSettingsManager),
}));

mock.module('../../src/core/identity/index.js', () => ({
    ...actualIdentity,
    loadExistingIdentity: vi.fn().mockResolvedValue(null),
}));

function Harness({ projectRoot, children }: { projectRoot: string; children: React.ReactNode }) {

    return (
        <MouseProvider enabled={true}>
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider projectRoot={projectRoot} autoLoad={true}>
                        <ToastProvider>{children}</ToastProvider>
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>
        </MouseProvider>
    );

}

describe('cli: mouse on self-drawn lists', () => {

    let tempDir: string;
    let colorLevel: typeof chalk.level;

    beforeEach(async () => {

        vi.clearAllMocks();
        actualCore.observer.clear();

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-mouse-rows-'));
        logPath = join(tempDir, 'noorm.log');
        knownUsers = {};

        mockStateManager = createMockStateManager();
        mockSettingsManager = createMockSettingsManager();

        colorLevel = chalk.level;

    });

    afterEach(async () => {

        chalk.level = colorLevel;
        actualCore.observer.clear();

        await tick();
        await rm(tempDir, { recursive: true, force: true });

    });

    describe('LogViewerOverlay', () => {

        const entry = (type: string, time: string) => JSON.stringify({ time, level: 'info', type, message: `${type} message` });

        /** The log is read newest-first, so the last line written is the top row. */
        async function overlay(types = ['alpha:evt', 'bravo:evt', 'charlie:evt']) {

            await writeFile(logPath, types.map((type, i) => entry(type, `2026-01-01T10:00:${String(i).padStart(2, '0')}.000Z`)).join('\n'));

            const view = render(
                <Harness projectRoot={tempDir}>
                    <LogViewerOverlay onClose={() => undefined} />
                </Harness>,
            );

            const frame = () => plain(view.lastFrame());

            await waitFor(() => frame().includes(types[0]!) || frame().includes(types.at(-1)!));
            await tick();

            return { ...view, frame };

        }

        const cursorOn = (frame: string, type: string) => /^\s*>/.test(lineOf(frame, type).replace(/^[\s│]*/, ''));

        it('should move the cursor to the clicked entry', async () => {

            const view = await overlay();

            expect(cursorOn(view.frame(), 'charlie:evt')).toBe(true);

            view.stdin.write(press(terminalRowOf(view.frame(), 'alpha:evt')));
            await waitFor(() => cursorOn(view.frame(), 'alpha:evt'));

            expect(cursorOn(view.frame(), 'alpha:evt')).toBe(true);
            expect(cursorOn(view.frame(), 'charlie:evt')).toBe(false);

            view.unmount();

        });

        it('should open the detail view on a double click, as Enter does', async () => {

            const view = await overlay();
            const row = terminalRowOf(view.frame(), 'bravo:evt');

            view.stdin.write(press(row));
            await waitFor(() => cursorOn(view.frame(), 'bravo:evt'));

            expect(view.frame()).not.toContain('Log Entry Detail');

            view.stdin.write(press(row));
            await waitFor(() => view.frame().includes('Log Entry Detail'));

            expect(view.frame()).toContain('"type": "bravo:evt"');

            view.unmount();

        });

        it('should open the clicked entry on a double click when the log is longer than the window', async () => {

            const types = Array.from({ length: 30 }, (_, i) => `evt-${String(i).padStart(2, '0')}:evt`);
            const view = await overlay(types);

            // Newest first: evt-29 is the top row. A click below the middle must not scroll the list.
            const row = terminalRowOf(view.frame(), 'evt-21:evt');

            view.stdin.write(press(row));
            await waitFor(() => cursorOn(view.frame(), 'evt-21:evt'));

            expect(cursorOn(view.frame(), 'evt-21:evt')).toBe(true);
            expect(terminalRowOf(view.frame(), 'evt-21:evt')).toBe(row);

            view.stdin.write(press(row));
            await waitFor(() => view.frame().includes('Log Entry Detail'));

            expect(view.frame()).toContain('"type": "evt-21:evt"');

            view.unmount();

        });

        it('should step the cursor one entry per wheel notch and clamp at the ends', async () => {

            const view = await overlay();

            view.stdin.write(press(1, 1, WHEEL_UP));
            await tick();

            expect(cursorOn(view.frame(), 'charlie:evt')).toBe(true);

            view.stdin.write(press(1, 1, WHEEL_DOWN));
            await waitFor(() => cursorOn(view.frame(), 'bravo:evt'));

            expect(cursorOn(view.frame(), 'bravo:evt')).toBe(true);

            view.unmount();

        });

        it('should leave a click alone while the search box is taking keystrokes', async () => {

            const view = await overlay();

            view.stdin.write('/');
            await waitFor(() => !view.frame().includes('type / to search'));

            view.stdin.write(press(terminalRowOf(view.frame(), 'alpha:evt')));
            await tick();

            expect(cursorOn(view.frame(), 'charlie:evt')).toBe(true);
            expect(view.frame()).not.toContain('[<');

            view.unmount();

        });

        it('should shade the entry under the pointer unless the cursor is on it', async () => {

            chalk.level = 1;

            const view = await overlay();
            const raw = () => view.lastFrame() ?? '';

            view.stdin.write(move(terminalRowOf(view.frame(), 'bravo:evt')));
            await waitFor(() => lineOf(raw(), 'bravo:evt').includes(HOVER_BG));

            expect(lineOf(raw(), 'bravo:evt')).toContain(HOVER_BG);
            expect(lineOf(raw(), 'alpha:evt')).not.toContain(HOVER_BG);

            view.stdin.write(move(terminalRowOf(view.frame(), 'charlie:evt')));
            await waitFor(() => !lineOf(raw(), 'bravo:evt').includes(HOVER_BG));

            expect(lineOf(raw(), 'charlie:evt')).not.toContain(HOVER_BG);

            view.unmount();

        });

    });

    describe('SqlClearScreen', () => {

        async function screen() {

            const view = render(
                <Harness projectRoot={tempDir}>
                    <SqlClearScreen params={{}} />
                </Harness>,
            );

            const frame = () => plain(view.lastFrame());

            await waitFor(() => frame().includes('Clear all history'));
            await tick();

            return { ...view, frame };

        }

        it('should move the cursor to the clicked option', async () => {

            const view = await screen();

            expect(view.frame()).toContain('> Clear last 3 months');

            view.stdin.write(press(terminalRowOf(view.frame(), 'Clear all history')));
            await waitFor(() => view.frame().includes('> Clear all history'));

            expect(view.frame()).toContain('> Clear all history');
            expect(view.frame()).not.toContain('> Clear last 3 months');

            view.unmount();

        });

        it('should go to the confirmation for the clicked option on a double click', async () => {

            const view = await screen();
            const row = terminalRowOf(view.frame(), 'Clear all history');

            view.stdin.write(press(row));
            await waitFor(() => view.frame().includes('> Clear all history'));

            expect(view.frame()).not.toContain('Are you sure');

            view.stdin.write(press(row));
            await waitFor(() => view.frame().includes('Are you sure'));

            expect(view.frame()).toContain('clear ALL history');

            view.unmount();

        });

        it('should step the cursor with the wheel', async () => {

            const view = await screen();

            view.stdin.write(press(1, 1, WHEEL_DOWN));
            await waitFor(() => view.frame().includes('> Clear all history'));

            view.stdin.write(press(1, 1, WHEEL_DOWN));
            await tick();

            expect(view.frame()).toContain('> Clear all history');

            view.stdin.write(press(1, 1, WHEEL_UP));
            await waitFor(() => view.frame().includes('> Clear last 3 months'));

            view.unmount();

        });

        it('should shade the hovered option unless the cursor is on it', async () => {

            chalk.level = 1;

            const view = await screen();
            const raw = () => view.lastFrame() ?? '';

            view.stdin.write(move(terminalRowOf(view.frame(), 'Clear all history')));
            await waitFor(() => lineOf(raw(), 'Clear all history').includes(HOVER_BG));

            view.stdin.write(move(terminalRowOf(view.frame(), 'Clear last 3 months')));
            await waitFor(() => !lineOf(raw(), 'Clear all history').includes(HOVER_BG));

            expect(lineOf(raw(), 'Clear last 3 months')).not.toContain(HOVER_BG);

            view.unmount();

        });

    });

    describe('SqlHistoryScreen', () => {

        const result = (): SqlExecutionResult => ({
            success: true,
            columns: ['id'],
            rows: [{ id: 1 }],
            durationMs: 3,
        });

        /** Entries are stored newest-first, so `select charlie` is the top row. */
        async function screen() {

            const manager = new SqlHistoryManager(tempDir, 'test');

            await manager.addEntry('select alpha', result());
            await manager.addEntry('select bravo', result());
            await manager.addEntry('select charlie', result());

            const view = render(
                <Harness projectRoot={tempDir}>
                    <SqlHistoryScreen params={{}} />
                </Harness>,
            );

            const frame = () => plain(view.lastFrame());

            await waitFor(() => frame().includes('select alpha'));
            await tick();

            return { ...view, frame };

        }

        it('should move the cursor to the clicked query', async () => {

            const view = await screen();

            expect(view.frame()).toContain('> select charlie');

            view.stdin.write(press(terminalRowOf(view.frame(), 'select alpha')));
            await waitFor(() => view.frame().includes('> select alpha'));

            expect(view.frame()).toContain('> select alpha');
            expect(view.frame()).not.toContain('> select charlie');

            view.unmount();

        });

        it('should open the stored result on a double click, as Enter does', async () => {

            const view = await screen();
            const row = terminalRowOf(view.frame(), 'select bravo');

            view.stdin.write(press(row));
            await waitFor(() => view.frame().includes('> select bravo'));

            view.stdin.write(press(row));
            await waitFor(() => view.frame().includes('Query Result'));

            expect(view.frame()).toContain('[/] Filter');

            view.unmount();

        });

        it('should step the cursor with the wheel', async () => {

            const view = await screen();

            view.stdin.write(press(1, 1, WHEEL_DOWN));
            await waitFor(() => view.frame().includes('> select bravo'));

            view.stdin.write(press(1, 1, WHEEL_UP));
            await waitFor(() => view.frame().includes('> select charlie'));

            view.stdin.write(press(1, 1, WHEEL_UP));
            await tick();

            expect(view.frame()).toContain('> select charlie');

            view.unmount();

        });

        it('should shade the hovered query unless the cursor is on it', async () => {

            chalk.level = 1;

            const view = await screen();
            const raw = () => view.lastFrame() ?? '';

            view.stdin.write(move(terminalRowOf(view.frame(), 'select bravo')));
            await waitFor(() => lineOf(raw(), 'select bravo').includes(HOVER_BG));

            view.stdin.write(move(terminalRowOf(view.frame(), 'select charlie')));
            await waitFor(() => !lineOf(raw(), 'select bravo').includes(HOVER_BG));

            expect(lineOf(raw(), 'select charlie')).not.toContain(HOVER_BG);

            view.unmount();

        });

    });

    describe('KnownUsersScreen', () => {

        const user = (email: string): KnownUser => ({
            identityHash: `hash-${email}`.padEnd(64, '0'),
            email,
            name: `Name ${email}`,
            publicKey: 'ab'.repeat(32),
            machine: 'laptop',
            os: 'darwin 25',
            lastSeen: '2026-01-01T10:00:00.000Z',
            source: 'prod',
        });

        async function screen() {

            knownUsers = {
                a: user('ann@example.com'),
                b: user('bob@example.com'),
                c: user('cyd@example.com'),
            };

            const view = render(
                <Harness projectRoot={tempDir}>
                    <KnownUsersScreen params={{}} />
                </Harness>,
            );

            const frame = () => plain(view.lastFrame());

            await waitFor(() => frame().includes('cyd@example.com'));
            await tick();

            return { ...view, frame };

        }

        it('should move the cursor to the clicked user', async () => {

            const view = await screen();

            expect(view.frame()).toContain('> [+] ann@example.com');

            view.stdin.write(press(terminalRowOf(view.frame(), 'cyd@example.com')));
            await waitFor(() => view.frame().includes('> [+] cyd@example.com'));

            expect(view.frame()).toContain('> [+] cyd@example.com');
            expect(view.frame()).not.toContain('> [+] ann@example.com');

            view.unmount();

        });

        it('should expand the clicked user on a double click, as Enter does', async () => {

            const view = await screen();
            const row = terminalRowOf(view.frame(), 'bob@example.com');

            view.stdin.write(press(row));
            await waitFor(() => view.frame().includes('> [+] bob@example.com'));

            expect(view.frame()).not.toContain('Hash:');

            view.stdin.write(press(row));
            await waitFor(() => view.frame().includes('[-] bob@example.com'));

            expect(view.frame()).toContain('Hash:');

            view.unmount();

        });

        it('should step the cursor with the wheel', async () => {

            const view = await screen();

            view.stdin.write(press(1, 1, WHEEL_DOWN));
            await waitFor(() => view.frame().includes('> [+] bob@example.com'));

            view.stdin.write(press(1, 1, WHEEL_UP));
            await waitFor(() => view.frame().includes('> [+] ann@example.com'));

            view.stdin.write(press(1, 1, WHEEL_UP));
            await tick();

            expect(view.frame()).toContain('> [+] ann@example.com');

            view.unmount();

        });

        it('should shade the hovered user unless the cursor is on it', async () => {

            chalk.level = 1;

            const view = await screen();
            const raw = () => view.lastFrame() ?? '';

            view.stdin.write(move(terminalRowOf(view.frame(), 'bob@example.com')));
            await waitFor(() => lineOf(raw(), 'bob@example.com').includes(HOVER_BG));

            view.stdin.write(move(terminalRowOf(view.frame(), 'ann@example.com')));
            await waitFor(() => !lineOf(raw(), 'bob@example.com').includes(HOVER_BG));

            expect(lineOf(raw(), 'ann@example.com')).not.toContain(HOVER_BG);

            view.unmount();

        });

    });

});
