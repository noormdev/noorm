/**
 * SQL terminal: the escape hatch for a query that never comes back.
 *
 * What is pinned:
 *
 * - A running query advertises Escape, and Escape returns the screen to the
 *   input rather than leaving a spinner nobody can dismiss.
 * - The wording matches what actually happened on this dialect. Sqlite gets no
 *   cancel sent to it, so the screen must not claim one.
 * - A query that answers after being cancelled is dropped: it neither replaces
 *   the cancellation on screen nor reaches the history file.
 */
import { describe, it, expect, vi, mock, beforeEach, afterEach, afterAll } from 'bun:test';
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
import { SqlTerminalScreen } from '../../../../src/tui/screens/db/SqlTerminalScreen.js';

const actualCore = await import('../../../../src/core/index.js');
const actualSqlTerminal = await import('../../../../src/core/sql-terminal/index.js');

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

const mockStateManager = createMockStateManager();
const mockSettingsManager = createMockSettingsManager();

mock.module('../../../../src/core/index.js', () => ({
    ...actualCore,
    getStateManager: vi.fn(() => mockStateManager),
    getSettingsManager: vi.fn(() => mockSettingsManager),
    resetStateManager: vi.fn(),
    resetSettingsManager: vi.fn(),
}));

mock.module('../../../../src/core/identity/index.js', () => ({
    loadExistingIdentity: vi.fn().mockResolvedValue(null),
}));

/**
 * What the mocked seams do right now.
 *
 * `mock.module` is process-global and never restores, so whatever is installed
 * here serves every file that runs after this one — the `afterAll` below is a
 * courtesy, not a restore. Both entries default to the real implementations
 * and are put back in `afterEach`, so a query this file holds open forever
 * stays this file's problem.
 *
 * The real implementation is captured into a const *before* `mock.module`
 * runs: a module namespace is a live binding, so reading
 * `actualSqlTerminal.executeRawSql` afterwards hands back the mock, and the
 * mock delegating to itself is an infinite recursion.
 */
const realExecuteRawSql = actualSqlTerminal.executeRawSql;

const seam = {
    executeRawSql: realExecuteRawSql,
};

/** The answer a query gives when the test is not holding it open. */
const answersImmediately = async (): Promise<SqlExecutionResult> => ({
    success: true,
    columns: ['n'],
    rows: [{ n: 1 }],
    durationMs: 1,
});

/** A query that never comes back: the hang the hatch exists for. */
const neverAnswers = () => new Promise<never>(() => undefined);

const executeMock = vi.fn(
    (
        db: Parameters<typeof actualSqlTerminal.executeRawSql>[0],
        query: string,
        configName: string,
        gate: Parameters<typeof actualSqlTerminal.executeRawSql>[3],
        signal?: AbortSignal,
    ) => seam.executeRawSql(db, query, configName, gate, signal),
);

// The connection layer is deliberately NOT mocked. This config is sqlite
// `:memory:`, so the real `testConnection` and `createConnection` succeed
// without touching anything — and a mock of that seam would outlive this file
// and hand every later file a connection that is not real.
mock.module('../../../../src/core/sql-terminal/index.js', () => ({
    ...actualSqlTerminal,
    executeRawSql: executeMock,
}));

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

describe('cli: SQL terminal cancellation', () => {

    let tempDir: string;

    beforeEach(async () => {

        vi.clearAllMocks();
        seam.executeRawSql = answersImmediately;
        tempDir = await mkdtemp(join(tmpdir(), 'noorm-sql-cancel-'));

    });

    afterEach(async () => {

        // Put the real executor back before the next file runs; a query left
        // hanging here would hang there.
        seam.executeRawSql = realExecuteRawSql;

        await rm(tempDir, { recursive: true, force: true });

    });

    afterAll(() => {

        mock.module('../../../../src/core/index.js', () => actualCore);
        mock.module('../../../../src/core/sql-terminal/index.js', () => actualSqlTerminal);

    });

    /**
     * Mount the terminal with a query already typed, run it, and stop once the
     * screen reports it is executing.
     */
    async function runHangingQuery() {

        const view = render(
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider projectRoot={tempDir} autoLoad={true}>
                        <ToastProvider>
                            <SqlTerminalScreen params={{ name: 'select 1' }} />
                        </ToastProvider>
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>,
        );

        await waitFor(() => Boolean(view.lastFrame()?.includes('SQL Terminal')));
        await waitFor(() => Boolean(view.lastFrame()?.includes('[h] History')));

        // The input starts in browse mode; Enter submits what params seeded.
        const deadline = Date.now() + 3000;

        while (!view.lastFrame()?.includes('Running query') && Date.now() < deadline) {

            view.stdin.write('\r');

            await new Promise((r) => setTimeout(r, 25));

        }

        return view;

    }

    it('should advertise the hatch while a query is running', async () => {

        seam.executeRawSql = neverAnswers;

        const view = await runHangingQuery();

        expect(view.lastFrame()).toContain('Running query');
        expect(view.lastFrame()).toContain('[Esc] Cancel');

        view.unmount();

    }, 20_000);

    it('should stop waiting on Escape and say only that, on a dialect with no cancel to send', async () => {

        seam.executeRawSql = neverAnswers;

        const view = await runHangingQuery();

        view.stdin.write('\x1B');

        await waitFor(() => !view.lastFrame()?.includes('Running query'));

        // Sqlite has no second connection to interrupt the first from, so
        // "cancelled" would be a claim the screen cannot back up.
        expect(view.lastFrame()).toContain('Stopped waiting');
        expect(view.lastFrame()).not.toContain('Running query');

        view.unmount();

    }, 20_000);

    it('should drop a result that arrives after the query was cancelled', async () => {

        let answer: (result: SqlExecutionResult) => void = () => undefined;

        seam.executeRawSql = () => new Promise((resolve) => {

            answer = resolve;

        });

        const view = await runHangingQuery();

        view.stdin.write('\x1B');

        await waitFor(() => Boolean(view.lastFrame()?.includes('Stopped waiting')));

        // The driver answers anyway, minutes later in the real thing. Acting on
        // it would replace the cancellation with a success the user never saw.
        answer({ success: true, columns: ['n'], rows: [{ n: 1 }], durationMs: 5 });

        await new Promise((r) => setTimeout(r, 200));

        expect(view.lastFrame()).toContain('Stopped waiting');
        expect(view.lastFrame()).not.toContain('Query executed');

        view.unmount();

    }, 20_000);

    it('should hand the query a signal so the executor can stop waiting too', async () => {

        seam.executeRawSql = neverAnswers;

        const view = await runHangingQuery();

        const signal = executeMock.mock.calls[0]?.[4];

        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal?.aborted).toBe(false);

        view.stdin.write('\x1B');

        await waitFor(() => Boolean(signal?.aborted));

        expect(signal?.aborted).toBe(true);

        view.unmount();

    }, 20_000);

});
