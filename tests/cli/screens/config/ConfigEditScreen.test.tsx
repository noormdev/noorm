/**
 * ConfigEditScreen tests.
 *
 * Proves the rename-path delete is wired to pass a `SettingsProvider` into
 * `StateManager.deleteConfig` — belt-and-suspenders with the core-seam guard
 * (`assertCanDeleteConfig`), which is what actually enforces the locked-stage
 * block and is already covered by iteration 1's `state/manager.test.ts`.
 *
 * A full render assertion of the surfaced error text was tried and dropped:
 * at the 24-row ink-testing-library default terminal the Form windows its 10
 * fields to a budget, so which rows reach `lastFrame()` depends on where the
 * cursor sits - a text assertion would be testing the viewport, not the wiring.
 * Spying on the mock call args is deterministic and still proves the wiring is
 * load-bearing: revert the `settingsProvider` argument and this test goes red.
 */
import { describe, it, expect, vi, mock, beforeEach, afterEach, afterAll } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider } from '../../../../src/tui/app-context.js';
import { ToastProvider } from '../../../../src/tui/components/index.js';
import { ConfigEditScreen } from '../../../../src/tui/screens/config/ConfigEditScreen.js';
import { SettingsProvider } from '../../../../src/core/config/resolver.js';

// Pre-import actual modules for restoration
const actualCore = await import('../../../../src/core/index.js');
const actualIdentity = await import('../../../../src/core/identity/index.js');
const actualConnectionFactory = await import('../../../../src/core/connection/factory.js');

function makeConfig(name: string) {

    return {
        name,
        type: 'local' as const,
        isTest: false,
        access: { user: 'admin' as const, agent: 'admin' as const },
        connection: {
            dialect: 'postgres' as const,
            host: 'localhost',
            port: 5432,
            database: `${name}_db`,
            user: 'admin',
            password: 'secret',
        },
    };

}

const createMockStateManager = (configName: string, config: ReturnType<typeof makeConfig> | null) => ({
    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfig: vi.fn().mockReturnValue(null),
    getActiveConfigName: vi.fn().mockReturnValue(null),
    listConfigs: vi.fn().mockReturnValue([]),
    getConfig: vi.fn((name: string) => (name === configName ? config : null)),
    deleteConfig: vi.fn().mockResolvedValue(undefined),
    setConfig: vi.fn().mockResolvedValue(undefined),
    setActiveConfig: vi.fn().mockResolvedValue(undefined),
    hasPrivateKey: vi.fn().mockReturnValue(true),
    isLoaded: true,
});

const createMockSettingsManager = (stages: Record<string, { locked?: boolean }>) => ({
    load: vi.fn().mockResolvedValue({ version: '0.1.0' }),
    isLoaded: true,
    settings: { version: '0.1.0' },
    getStages: vi.fn().mockReturnValue({}),
    getStage: vi.fn((name: string) => stages[name]),
});

// Mutable so each test can swap in its own fixture; the mock.module factory
// closures read these at call time (matches init-flow.test.tsx).
let mockStateManager = createMockStateManager('prod', makeConfig('prod'));
let mockSettingsManager = createMockSettingsManager({ prod: { locked: true } });

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

/**
 * The implementation the mock falls back to, and the one it must be left on.
 *
 * `mock.module` is process-global and never restores, so this file's
 * `testConnection` stays installed for every file that runs after it in the
 * cli group. Leaving `testConnectionImpl` on a hanging implementation hands
 * those files a promise nobody will ever settle: `db-dry-run` sat forever on
 * "Truncating tables..." because its screen was waiting on this mock.
 */
const answersImmediately = async () => ({ ok: true });

// Mutable so a test can hold the connection open and decide when — or
// whether — it answers. Reset in `afterEach`, not just `beforeEach`, because
// the state that matters outlives this file.
let testConnectionImpl: () => Promise<{ ok: boolean; error?: string; aborted?: boolean }> =
    answersImmediately;

/**
 * Resolvers for connections a test is deliberately holding open.
 *
 * Registered here so `afterEach` can settle anything still parked; a suspended
 * submit handler would otherwise keep the screen it belongs to alive for the
 * rest of the process.
 */
const heldConnections: Array<(result: { ok: boolean }) => void> = [];

/**
 * A connection test that answers only when this file says so.
 */
function heldConnection(): Promise<{ ok: boolean }> {

    return new Promise<{ ok: boolean }>((resolve) => {

        heldConnections.push(resolve);

    });

}

const testConnectionMock = vi.fn(
    (_config: unknown, _options?: { testServerOnly?: boolean; signal?: AbortSignal }) =>
        testConnectionImpl(),
);

mock.module('../../../../src/core/connection/factory.js', () => ({
    ...actualConnectionFactory,
    testConnection: testConnectionMock,
}));

/**
 * Poll until `predicate` holds. A fixed sleep is the suite's known weak point:
 * under load it expires before the frame arrives and reads as a regression.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 3000) {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((r) => setTimeout(r, 10));

    }

}

/**
 * Move the cursor onto the submit button and press it.
 *
 * Counting arrow presses is what made this fragile: two Ups is only the right
 * number while the cursor starts on the first field, and a press written before
 * the focus effect has run lands on nothing. Drive until the frame shows the
 * cursor where it belongs instead.
 */
async function submitForm(
    stdin: { write: (data: string) => void },
    lastFrame: () => string | undefined,
): Promise<void> {

    const focused = '❯ [ Save Changes ]';

    await waitFor(() => Boolean(lastFrame()?.includes('[ Save Changes ]')));

    const deadline = Date.now() + 3000;

    while (!lastFrame()?.includes(focused) && Date.now() < deadline) {

        stdin.write('\x1B[A');

        await new Promise((r) => setTimeout(r, 30));

    }

    stdin.write('\r');

}

function TestWrapper({ children }: { children: React.ReactNode }) {

    return (
        <FocusProvider>
            <RouterProvider>
                <AppContextProvider autoLoad={true}>
                    <ToastProvider>{children}</ToastProvider>
                </AppContextProvider>
            </RouterProvider>
        </FocusProvider>
    );

}

describe('cli: ConfigEditScreen', () => {

    beforeEach(() => {

        vi.clearAllMocks();
        actualCore.observer.clear();
        testConnectionImpl = answersImmediately;

    });

    afterEach(async () => {

        actualCore.observer.clear();

        // Put the mock back on an implementation that answers, and let go of
        // anything still held. Both matter to the *next* file, not this one.
        testConnectionImpl = answersImmediately;

        while (heldConnections.length > 0) heldConnections.pop()?.({ ok: false });

        await new Promise((r) => setTimeout(r, 20));

    });

    afterAll(() => {

        mock.module('../../../../src/core/index.js', () => actualCore);
        mock.module('../../../../src/core/identity/index.js', () => actualIdentity);
        mock.module('../../../../src/core/connection/factory.js', () => actualConnectionFactory);

    });

    it('should not fire a "hooks order changed" warning across the async-load boundary', async () => {

        mockStateManager = createMockStateManager('prod', makeConfig('prod'));
        mockSettingsManager = createMockSettingsManager({ prod: { locked: true } });

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { unmount } = render(
            <TestWrapper>
                <ConfigEditScreen params={{ name: 'prod' }} />
            </TestWrapper>,
        );

        // AppContextProvider's autoLoad kicks off async stateManager/config
        // resolution; the initial render (config unresolved) takes the
        // early-return branch, then a later render (config resolved) reaches
        // the bottom of the component - the exact transition that changes
        // hook count if useWindowSize is called after the returns.
        await new Promise((r) => setTimeout(r, 200));

        const hooksOrderWarning = consoleErrorSpy.mock.calls.some(
            (call) => typeof call[0] === 'string' && call[0].includes('change in the order of Hooks'),
        );

        expect(hooksOrderWarning).toBe(false);

        consoleErrorSpy.mockRestore();
        unmount();

    });

    it('should pass a SettingsProvider into the rename-path deleteConfig call', async () => {

        mockStateManager = createMockStateManager('prod', makeConfig('prod'));
        mockSettingsManager = createMockSettingsManager({ prod: { locked: true } });

        const { stdin, lastFrame, unmount } = render(
            <TestWrapper>
                <ConfigEditScreen params={{ name: 'prod' }} />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 150));

        // Rename "prod" -> "prod2". The name field is active by default but the
        // Form starts in browse mode, so Enter opens it for editing, the digit
        // lands, and Enter commits back to browse.
        stdin.write('\r');
        await new Promise((r) => setTimeout(r, 50));
        stdin.write('2');
        await new Promise((r) => setTimeout(r, 50));
        stdin.write('\r');
        await new Promise((r) => setTimeout(r, 50));

        // Submission lives on the action row now.
        await submitForm(stdin, lastFrame);

        await waitFor(() => mockStateManager.deleteConfig.mock.calls.length > 0);

        expect(mockStateManager.deleteConfig).toHaveBeenCalledTimes(1);

        const [deletedName, settingsProviderArg] = mockStateManager.deleteConfig.mock.calls[0] as [
            string,
            unknown,
        ];

        expect(deletedName).toBe('prod');
        expect(settingsProviderArg).toBeInstanceOf(SettingsProvider);

        unmount();

    });

    it('should offer the escape hatch while a connection test is in flight', async () => {

        mockStateManager = createMockStateManager('prod', makeConfig('prod'));
        mockSettingsManager = createMockSettingsManager({ prod: { locked: true } });

        // Answers only when this test lets it: the hung connect the hatch
        // exists for.
        testConnectionImpl = heldConnection;

        const { stdin, lastFrame, unmount } = render(
            <TestWrapper>
                <ConfigEditScreen params={{ name: 'prod' }} />
            </TestWrapper>,
        );

        await submitForm(stdin, lastFrame);

        await waitFor(() => Boolean(lastFrame()?.includes('Testing connection')));

        // A busy state that can be cancelled has to say so, or nobody tries it.
        expect(lastFrame()).toContain('[Esc] Cancel');

        // The hatch is only real if the connection layer got a signal to act on.
        const options = testConnectionMock.mock.calls[0]?.[1];

        expect(options?.signal).toBeInstanceOf(AbortSignal);
        expect(options?.signal?.aborted).toBe(false);

        stdin.write('\x1B');

        await waitFor(() => Boolean(options?.signal?.aborted));

        expect(options?.signal?.aborted).toBe(true);

        unmount();

    }, 20_000);

    it('should return the form to a usable state on Escape, and drop the late answer', async () => {

        mockStateManager = createMockStateManager('prod', makeConfig('prod'));
        mockSettingsManager = createMockSettingsManager({ prod: { locked: true } });

        testConnectionImpl = heldConnection;

        const { stdin, lastFrame, unmount } = render(
            <TestWrapper>
                <ConfigEditScreen params={{ name: 'prod' }} />
            </TestWrapper>,
        );

        await submitForm(stdin, lastFrame);

        await waitFor(() => Boolean(lastFrame()?.includes('Testing connection')));

        stdin.write('\x1B');

        await waitFor(() => Boolean(lastFrame()?.includes('Stopped waiting')));

        // Back to a form, not a spinner: the action row is rendered again.
        expect(lastFrame()).toContain('Save Changes');
        expect(lastFrame()).not.toContain('Testing connection');

        // A driver that ignores the abort and answers "fine" a moment later.
        // Acting on that answer is how a cancelled screen saves anyway.
        heldConnections.pop()?.({ ok: true });

        await new Promise((r) => setTimeout(r, 150));

        expect(mockStateManager.setConfig).not.toHaveBeenCalled();
        expect(lastFrame()).toContain('Stopped waiting');

        unmount();

    }, 20_000);

});
