/**
 * SQL screens: reading a stored result without leaving for another tool.
 *
 * The complaint that produced this was `select * from ai_usage` in the SQL
 * terminal: fifteen columns crammed to their floor, headers wrapped onto two
 * lines, values broken mid-value. `ResultTable` now chops instead, which makes
 * some columns unreachable on the grid, and Enter on a row is what makes that
 * trade honest.
 *
 * `SqlHistoryScreen` is the screen mounted here because it draws the same
 * `ResultBrowser` the terminal does and needs no live connection to get a
 * result on screen — the stored result is read off disk. What the terminal adds
 * on top is the query that produced it, not a different grid.
 *
 * What is pinned:
 *
 * - The grid drops columns and says how many, rather than squeezing all of them.
 * - Enter opens the cursor's row and shows a column the grid dropped.
 * - Escape unwinds one level at a time: document, then result, then screen.
 * - The filter box keeps its own Escape. Before this, the screen claimed Escape
 *   while a result was up, so cancelling a filter closed the whole result.
 */
import { describe, it, expect, vi, mock, beforeEach, afterEach } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SqlExecutionResult } from '../../../../src/core/sql-terminal/types.js';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider } from '../../../../src/tui/app-context.js';
import { ToastProvider } from '../../../../src/tui/components/index.js';
import { SqlHistoryScreen } from '../../../../src/tui/screens/db/SqlHistoryScreen.js';
import { SqlHistoryManager } from '../../../../src/core/sql-terminal/index.js';

const actualCore = await import('../../../../src/core/index.js');

/** Sqlite admin config, matching the shape `db-dry-run.test.tsx` uses. */
function makeConfig() {

    return {
        name: 'test',
        type: 'local' as const,
        isTest: true,
        access: { user: 'admin' as const, agent: 'admin' as const },
        connection: {
            dialect: 'sqlite' as const,
            database: ':memory:',
        },
    };

}

const createMockStateManager = () => ({
    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfig: vi.fn().mockReturnValue(makeConfig()),
    getActiveConfigName: vi.fn().mockReturnValue('test'),
    listConfigs: vi.fn().mockReturnValue([makeConfig()]),
    getConfig: vi.fn().mockReturnValue(makeConfig()),
    setConfig: vi.fn().mockResolvedValue(undefined),
    setActiveConfig: vi.fn().mockResolvedValue(undefined),
    hasPrivateKey: vi.fn().mockReturnValue(true),
    isLoaded: true,
});

const createMockSettingsManager = () => ({
    load: vi.fn().mockResolvedValue({ version: '0.1.0' }),
    isLoaded: true,
    settings: { version: '0.1.0' },
    getStages: vi.fn().mockReturnValue({}),
    getStage: vi.fn().mockReturnValue(undefined),
});

let mockStateManager = createMockStateManager();
let mockSettingsManager = createMockSettingsManager();

mock.module('../../../../src/core/index.js', () => ({
    observer: actualCore.observer,
    getStateManager: vi.fn(() => mockStateManager),
    getSettingsManager: vi.fn(() => mockSettingsManager),
    resetStateManager: vi.fn(),
    resetSettingsManager: vi.fn(),
}));

mock.module('../../../../src/core/identity/index.js', () => ({
    loadExistingIdentity: vi.fn().mockResolvedValue(null),
}));

const KEY = {
    down: '[B',
    enter: '\r',
    escape: '',
    filter: '/',
    format: 'f',
    end: '\u001B[F',
} as const;

/** A line only the grid prints, so a wait cannot pass on the document. */
const GRID_MARKER = '[/] Filter';

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

/**
 * Wait until the grid's own input handler is listening.
 *
 * Ink registers `useInput` in an effect, which runs after the frame it belongs
 * to is painted, so the keystroke that opens a row lands on nothing if it is
 * written the moment the grid appears. `/` is the probe because filter mode
 * announces itself, and Escape out of it clears whatever the probe typed.
 */
async function settleGrid(
    stdin: { write: (data: string) => void },
    frame: () => string,
): Promise<void> {

    const deadline = Date.now() + 2000;

    while (!frame().includes('[Tab] Column') && Date.now() < deadline) {

        stdin.write(KEY.filter);

        await new Promise((resolve) => setTimeout(resolve, 20));

    }

    stdin.write(KEY.escape);

    await waitFor(() => !frame().includes('[Tab] Column'));

}

/**
 * Wait until the row document viewer's own focus scope is live.
 *
 * Same reason, one level deeper: `useFocusScope` pushes onto the stack in an
 * effect too. `f` is the probe because it changes the header rather than the
 * document, and pressing it twice puts the format back where it started.
 */
async function settleRowView(
    stdin: { write: (data: string) => void },
    frame: () => string,
): Promise<void> {

    const start = frame().includes('[f] JSON') ? '[f] JSON' : '[f] YAML';
    const flipped = start === '[f] JSON' ? '[f] YAML' : '[f] JSON';

    const deadline = Date.now() + 2000;

    while (!frame().includes(flipped) && Date.now() < deadline) {

        stdin.write(KEY.format);

        await new Promise((resolve) => setTimeout(resolve, 20));

    }

    stdin.write(KEY.format);

    await waitFor(() => frame().includes(start));

}

/** Fifteen columns of uuid-ish values: the shape that produced the complaint. */
function wideResult(): SqlExecutionResult {

    const columns = Array.from({ length: 15 }, (_, index) => `col_${String(index).padStart(2, '0')}`);

    const row = (seed: number): Record<string, unknown> => {

        const out: Record<string, unknown> = {};

        for (const column of columns) out[column] = `${column}-${seed}`.padEnd(20, 'x');

        out['col_00'] = `row-${seed}`;
        out['col_14'] = `tail-${seed}`;

        return out;

    };

    return {
        success: true,
        columns,
        rows: [row(0), row(1)],
        durationMs: 12,
    };

}

describe('cli: screens/db sql result browsing', () => {

    let tempDir: string;

    beforeEach(async () => {

        vi.clearAllMocks();
        actualCore.observer.clear();

        mockStateManager = createMockStateManager();
        mockSettingsManager = createMockSettingsManager();

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-sql-row-test-'));

    });

    afterEach(async () => {

        actualCore.observer.clear();

        await rm(tempDir, { recursive: true, force: true });

    });

    /** Seed one stored result and put the screen in front of it. */
    async function screen() {

        const manager = new SqlHistoryManager(tempDir, 'test');

        await manager.addEntry('select * from ai_usage', wideResult());

        const view = render(
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider projectRoot={tempDir} autoLoad={true}>
                        <ToastProvider>
                            <SqlHistoryScreen params={{}} />
                        </ToastProvider>
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>,
        );

        const frame = () => view.lastFrame() ?? '';

        await waitFor(() => frame().includes('select * from ai_usage'));

        return { ...view, frame };

    }

    it('should chop a wide stored result instead of squeezing every column', async () => {

        const view = await screen();

        view.stdin.write(KEY.enter);
        await waitFor(() => view.frame().includes(GRID_MARKER));
        await settleGrid(view.stdin, view.frame);

        const frame = view.frame();
        const lines = frame.split('\n');
        // Inside the Panel, so the run of box-drawing has to be told apart from
        // the Panel's own top border, which also carries one.
        const rule = lines.findIndex((line) => line.startsWith('│') && line.includes('────'));

        // On the header line, not on the frame: squeezing fifteen columns into
        // the row truncates `col_14` to `col`, so a frame-wide `not.toContain`
        // would pass on exactly the bug this is about.
        expect(lines[rule - 1]).toContain('col_00');
        expect(lines[rule - 1]).toContain('col_04');
        expect(lines[rule - 1]).not.toContain('col_14');
        expect(frame).toContain('more columns');

        // Two rows, two lines, each carrying its whole first cell. Squeezing
        // wrapped every cell and cut `row-0` down to `row`.
        expect(lines.filter((line) => /row-[01]/.test(line))).toHaveLength(2);

        view.unmount();

    });

    it('should open a stored row as a document, dropped columns included', async () => {

        const view = await screen();

        view.stdin.write(KEY.enter);
        await waitFor(() => view.frame().includes(GRID_MARKER));
        await settleGrid(view.stdin, view.frame);

        expect(view.frame()).toContain('[↵] Open row');

        view.stdin.write(KEY.enter);
        await waitFor(() => view.frame().includes('row 1 of 2'));
        await settleRowView(view.stdin, view.frame);

        expect(view.frame()).toContain('Stored result');

        // Fifteen fields do not fit a 24-row terminal, so the column the grid
        // dropped is at the bottom of a document that scrolls. Reaching it is
        // the point: End is bound here for exactly this.
        view.stdin.write(KEY.end);
        await waitFor(() => view.frame().includes('col_14'));

        expect(view.frame()).toContain('col_14: tail-0');

        view.unmount();

    });

    it('should unwind one level per Escape: document, result, screen', async () => {

        const view = await screen();

        view.stdin.write(KEY.enter);
        await waitFor(() => view.frame().includes(GRID_MARKER));
        await settleGrid(view.stdin, view.frame);

        view.stdin.write(KEY.enter);
        await waitFor(() => view.frame().includes('row 1 of 2'));
        await settleRowView(view.stdin, view.frame);

        view.stdin.write(KEY.escape);
        await waitFor(() => view.frame().includes(GRID_MARKER));

        // Back on the grid, not back on the history list.
        expect(view.frame()).toContain('Query Result');

        view.stdin.write(KEY.escape);
        await waitFor(() => view.frame().includes('[r] Re-run'));

        expect(view.frame()).toContain('select * from ai_usage');

        view.unmount();

    });

    it('should let the filter box keep its own Escape', async () => {

        const view = await screen();

        view.stdin.write(KEY.enter);
        await waitFor(() => view.frame().includes(GRID_MARKER));
        await settleGrid(view.stdin, view.frame);

        view.stdin.write(KEY.filter);
        await waitFor(() => view.frame().includes('[Tab] Column'));

        view.stdin.write('row-1');
        await waitFor(() => view.frame().includes('filtered from 2'));

        view.stdin.write(KEY.escape);
        await waitFor(() => !view.frame().includes('filtered from 2'));

        // Escape cancelled the filter. The whole result view used to go with it.
        expect(view.frame()).toContain('Query Result');
        expect(view.frame()).toContain(GRID_MARKER);

        view.unmount();

    });

});
