/**
 * ConfigEditScreen tests.
 *
 * Proves the rename path passes a `SettingsProvider` into
 * `StateManager.renameConfig`; the seam's own guards (locked stage, protected
 * stage escape) are covered by `state/manager.test.ts`.
 *
 * A full render assertion of the surfaced error text was tried and dropped:
 * at the 24-row ink-testing-library default terminal the Form windows its
 * fields to a budget, so which rows reach `lastFrame()` depends on where the
 * cursor sits - a text assertion would be testing the viewport, not the wiring.
 * Spying on the mock call args is deterministic and still proves the wiring is
 * load-bearing: revert the `settingsProvider` argument and this test goes red.
 */
import { describe, it, expect, vi, mock, beforeEach, afterEach, afterAll } from 'bun:test';
import { stripVTControlCharacters } from 'node:util';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider } from '../../../../src/tui/app-context.js';
import { ToastProvider } from '../../../../src/tui/components/index.js';
import { ConfigEditScreen } from '../../../../src/tui/screens/config/ConfigEditScreen.js';
import { SettingsProvider } from '../../../../src/core/config/resolver.js';
import type { ConnectionConfig } from '../../../../src/core/connection/types.js';
import type { StageDefaults } from '../../../../src/core/settings/types.js';

// Pre-import actual modules for restoration
const actualCore = await import('../../../../src/core/index.js');
const actualIdentity = await import('../../../../src/core/identity/index.js');
const actualConnectionFactory = await import('../../../../src/core/connection/factory.js');

const CTRL_S = '\x13';
const DOWN = '\x1B[B';

function makeConfig(name: string, userRole = 'admin', extra: Partial<ConnectionConfig> = {}) {

    return {
        name,
        type: 'local' as const,
        isTest: false,
        access: { user: userRole, agent: 'admin' as const },
        connection: {
            dialect: 'postgres' as const,
            host: 'localhost',
            port: 5432,
            database: `${name}_db`,
            user: 'admin',
            password: 'secret',
            ...extra,
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
    renameConfig: vi.fn().mockResolvedValue(undefined),
    setConfig: vi.fn().mockResolvedValue(undefined),
    setActiveConfig: vi.fn().mockResolvedValue(undefined),
    hasPrivateKey: vi.fn().mockReturnValue(true),
    isLoaded: true,
});

const createMockSettingsManager = (stages: Record<string, { locked?: boolean; defaults?: StageDefaults }>) => ({
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

    it('should pass a SettingsProvider into the rename-path renameConfig call', async () => {

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

        await waitFor(() => mockStateManager.renameConfig.mock.calls.length > 0);

        expect(mockStateManager.renameConfig).toHaveBeenCalledTimes(1);

        const [oldName, renamed, settingsProviderArg] = mockStateManager.renameConfig.mock.calls[0] as [
            string,
            { name: string },
            unknown,
        ];

        expect(oldName).toBe('prod');
        expect(renamed.name).toBe('prod2');
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

    /**
     * A database behind a tunnel that is not up yet cannot pass the connection
     * test, and the test used to be the only way to save. The bypass skips that
     * one step and nothing else.
     */
    describe('save without verifying', () => {

        /** The frame as one line without the panel border, so a wrapped status message still matches. */
        const flat = (frame: string | undefined) => (frame ?? '').replace(/[│\s]+/g, ' ');

        it('should still block the normal save on a failed test, and name the way out', async () => {

            mockStateManager = createMockStateManager('prod', makeConfig('prod'));
            mockSettingsManager = createMockSettingsManager({});
            testConnectionImpl = async () => ({ ok: false, error: 'connect ECONNREFUSED' });

            const { stdin, lastFrame, unmount } = render(
                <TestWrapper>
                    <ConfigEditScreen params={{ name: 'prod' }} />
                </TestWrapper>,
            );

            await submitForm(stdin, lastFrame);

            await waitFor(() => flat(lastFrame()).includes('ECONNREFUSED'));

            expect(testConnectionMock).toHaveBeenCalledTimes(1);
            expect(mockStateManager.setConfig).not.toHaveBeenCalled();

            // The error is where the user is looking when they need the key.
            expect(flat(lastFrame())).toContain('Ctrl+S to save without verifying');

            unmount();

        }, 20_000);

        it('should save on the bypass key without opening a connection', async () => {

            mockStateManager = createMockStateManager('prod', makeConfig('prod'));
            mockSettingsManager = createMockSettingsManager({});

            // A test that would fail: the bypass must not depend on it.
            testConnectionImpl = async () => ({ ok: false, error: 'connect ECONNREFUSED' });

            const { stdin, lastFrame, unmount } = render(
                <TestWrapper>
                    <ConfigEditScreen params={{ name: 'prod' }} />
                </TestWrapper>,
            );

            // The active-row marker, not the hint: the hint renders before the
            // form has focus, and a chord written then lands on nothing.
            await waitFor(() => Boolean(lastFrame()?.includes('›')));

            expect(lastFrame()).toContain('ctrl+s save without verifying');

            stdin.write(CTRL_S);

            await waitFor(() => mockStateManager.setConfig.mock.calls.length > 0);

            expect(testConnectionMock).not.toHaveBeenCalled();
            expect(mockStateManager.setConfig).toHaveBeenCalledTimes(1);

            const [savedName, saved] = mockStateManager.setConfig.mock.calls[0] as [
                string,
                ReturnType<typeof makeConfig>,
            ];

            expect(savedName).toBe('prod');
            expect(saved.connection.database).toBe('prod_db');

            unmount();

        }, 20_000);

        it('should still reject an unknown access role on the bypass key', async () => {

            // Skipping the connection test must not become a way to store a
            // config whose roles the project does not define.
            mockStateManager = createMockStateManager('prod', makeConfig('prod', 'ghost'));
            mockSettingsManager = createMockSettingsManager({});

            const { stdin, lastFrame, unmount } = render(
                <TestWrapper>
                    <ConfigEditScreen params={{ name: 'prod' }} />
                </TestWrapper>,
            );

            await waitFor(() => Boolean(lastFrame()?.includes('›')));

            stdin.write(CTRL_S);

            await waitFor(() => flat(lastFrame()).includes('Unknown access role'));

            expect(flat(lastFrame())).toContain('Unknown access role "ghost"');
            expect(testConnectionMock).not.toHaveBeenCalled();
            expect(mockStateManager.setConfig).not.toHaveBeenCalled();

            unmount();

        }, 20_000);

    });

    describe('ssl fields', () => {

        type Screen = { stdin: { write: (data: string) => void }; lastFrame: () => string | undefined };

        const frameOf = (screen: Screen) => stripVTControlCharacters(screen.lastFrame() ?? '');

        const isOnRow = (screen: Screen, label: string) =>
            frameOf(screen).split('\n').some((line) => line.includes('›') && line.includes(label));

        async function focusRow(screen: Screen, label: string) {

            await waitFor(() => frameOf(screen).includes('›'));

            const deadline = Date.now() + 4000;

            while (!isOnRow(screen, label) && Date.now() < deadline) {

                screen.stdin.write(DOWN);

                await new Promise((r) => setTimeout(r, 30));

            }

        }

        async function typeInto(screen: Screen, label: string, text: string) {

            await focusRow(screen, label);

            screen.stdin.write('\r');
            await waitFor(() => frameOf(screen).includes('↵ commit'));
            screen.stdin.write(text);
            await waitFor(() => frameOf(screen).includes(text));
            screen.stdin.write('\r');
            await waitFor(() => !frameOf(screen).includes('↵ commit'));

        }

        async function toggle(screen: Screen, label: string) {

            await focusRow(screen, label);

            const isChecked = () => frameOf(screen).split('\n').some((row) => row.includes(label) && row.includes('☑'));
            const before = isChecked();

            screen.stdin.write(' ');
            await waitFor(() => isChecked() !== before);

        }

        const stageCa = { prod: { defaults: { ssl: { caFile: './certs/stage-ca.pem' } } } };

        function editScreen(extra: Partial<ConnectionConfig> = {}, stages: Record<string, { defaults?: StageDefaults }> = {}) {

            mockStateManager = createMockStateManager('prod', makeConfig('prod', 'admin', extra));
            mockSettingsManager = createMockSettingsManager(stages);

            return render(
                <TestWrapper>
                    <ConfigEditScreen params={{ name: 'prod' }} />
                </TestWrapper>,
            );

        }

        function isSavedConfig(value: unknown): value is ReturnType<typeof makeConfig> {

            return typeof value === 'object' && value !== null && 'connection' in value
                && typeof value.connection === 'object' && value.connection !== null;

        }

        async function saved(screen: Screen): Promise<ReturnType<typeof makeConfig>> {

            await waitFor(() => frameOf(screen).includes('›'));

            screen.stdin.write(CTRL_S);

            await waitFor(() => mockStateManager.setConfig.mock.calls.length > 0);

            const config: unknown = mockStateManager.setConfig.mock.calls[0]?.[1];

            if (!isSavedConfig(config)) throw new Error('setConfig was not called with a config');

            return config;

        }

        it('should show the stored SSL values and save them unchanged', async () => {

            const screen = editScreen({ ssl: { caFile: './certs/ca.pem' }, tlsServerName: 'db.corp' });

            await focusRow(screen, 'TLS Server Name');

            const frame = frameOf(screen);

            expect(frame).toContain('Use SSL');
            expect(frame).toContain('☑ Yes');
            expect(frame).toContain('./certs/ca.pem');
            expect(frame).toContain('db.corp');

            const config = await saved(screen);

            expect(config.connection.ssl).toEqual({ caFile: './certs/ca.pem' });
            expect(config.connection.tlsServerName).toBe('db.corp');

            screen.unmount();

        }, 20_000);

        it('should show a placeholder on a field whose stored form is inline PEM', async () => {

            const screen = editScreen({ ssl: { ca: 'PEM-CA' } });

            await focusRow(screen, 'CA File');

            expect(frameOf(screen)).toContain('(inline certificate stored)');

            screen.unmount();

        }, 20_000);

        it('should keep pool, inline PEM and timeouts through an edit of the host', async () => {

            const extra: Partial<ConnectionConfig> = {
                pool: { max: 20 },
                connectTimeoutMs: 5000,
                applicationName: 'billing',
                keepAliveInitialDelayMs: 1000,
                ssl: { ca: 'PEM-CA', cert: 'PEM-CERT', rejectUnauthorized: false },
            };
            const screen = editScreen(extra);

            await typeInto(screen, 'Host', '2');

            const config = await saved(screen);

            expect(config.connection).toEqual({ ...makeConfig('prod').connection, ...extra, host: 'localhost2' });

            screen.unmount();

        }, 20_000);

        it('should replace inline PEM with a typed path for that field only', async () => {

            const screen = editScreen({ ssl: { ca: 'PEM-CA', cert: 'PEM-CERT' } });

            await typeInto(screen, 'CA File', './ca.pem');

            const config = await saved(screen);

            expect(config.connection.ssl).toEqual({ caFile: './ca.pem', cert: 'PEM-CERT' });

            screen.unmount();

        }, 20_000);

        it('should store ssl false when Use SSL is unchecked from a stored truthy ssl', async () => {

            const screen = editScreen({ ssl: true });

            await toggle(screen, 'Use SSL');

            const config = await saved(screen);

            expect(config.connection.ssl).toBe(false);

            screen.unmount();

        }, 20_000);

        it('should refuse a TLS server name with Use SSL unchecked on a config with no stored ssl', async () => {

            const screen = editScreen();

            await typeInto(screen, 'TLS Server Name', 'db.corp');

            screen.stdin.write(CTRL_S);

            await waitFor(() => frameOf(screen).replace(/[│\s]+/g, ' ').includes('TLS server name needs Use SSL'));

            expect(frameOf(screen).replace(/[│\s]+/g, ' ')).toContain('TLS server name needs Use SSL');
            expect(mockStateManager.setConfig).not.toHaveBeenCalled();

            screen.unmount();

        }, 20_000);

        it('should test with a stage caFile and keep ssl absent from the saved config', async () => {

            mockStateManager = createMockStateManager('prod', makeConfig('prod'));
            mockSettingsManager = createMockSettingsManager({ prod: { defaults: { ssl: { caFile: './certs/stage-ca.pem' } } } });

            const screen = render(
                <TestWrapper>
                    <ConfigEditScreen params={{ name: 'prod' }} />
                </TestWrapper>,
            );

            await submitForm(screen.stdin, screen.lastFrame);
            await waitFor(() => mockStateManager.setConfig.mock.calls.length > 0);

            const config: unknown = mockStateManager.setConfig.mock.calls[0]?.[1];

            expect(testConnectionMock.mock.calls[0]?.[0]).toMatchObject({ database: 'prod_db', ssl: { caFile: './certs/stage-ca.pem' } });
            expect(isSavedConfig(config) && 'ssl' in config.connection).toBe(false);

            screen.unmount();

        }, 20_000);

        it('should show Use SSL checked and the stage placeholder for a config whose ssl comes from its stage', async () => {

            const screen = editScreen({}, stageCa);

            await focusRow(screen, 'CA File');

            const rows = frameOf(screen).split('\n');

            expect(rows.some((row) => row.includes('Use SSL') && row.includes('☑'))).toBe(true);
            expect(rows.some((row) => row.includes('CA File') && row.includes('(stage: ./certs/stage-ca.pem)'))).toBe(true);

            screen.unmount();

        }, 20_000);

        it('should store ssl false when Use SSL is unchecked on a config whose ssl comes from its stage', async () => {

            const screen = editScreen({}, stageCa);

            await toggle(screen, 'Use SSL');

            const config = await saved(screen);

            expect(config.connection.ssl).toBe(false);

            screen.unmount();

        }, 20_000);

        it('should keep SSL on when a rename leaves the stage that supplied it', async () => {

            const screen = editScreen({}, stageCa);

            await typeInto(screen, 'Config Name', '-eu');

            screen.stdin.write(CTRL_S);

            await waitFor(() => mockStateManager.renameConfig.mock.calls.length > 0);

            const renamed: unknown = mockStateManager.renameConfig.mock.calls[0]?.[1];

            if (!isSavedConfig(renamed)) throw new Error('renameConfig was not called with a config');

            expect(renamed.name).toBe('prod-eu');
            expect(renamed.connection.ssl).toBe(true);

            screen.unmount();

        }, 20_000);

        it('should store rejectUnauthorized false when Verify Certificate is unchecked', async () => {

            const screen = editScreen({ ssl: true });

            await toggle(screen, 'Verify Certificate');

            const config = await saved(screen);

            expect(config.connection.ssl).toEqual({ rejectUnauthorized: false });

            screen.unmount();

        }, 20_000);

        it('should remove a stored rejectUnauthorized false when Verify Certificate is checked again', async () => {

            const screen = editScreen({ ssl: { caFile: './ca.pem', rejectUnauthorized: false } });

            await toggle(screen, 'Verify Certificate');

            const config = await saved(screen);

            expect(config.connection.ssl).toEqual({ caFile: './ca.pem' });

            screen.unmount();

        }, 20_000);

        it('should show a stored ssl false unchecked with no stage placeholder, and store true when checked', async () => {

            const screen = editScreen({ ssl: false }, stageCa);

            await focusRow(screen, 'CA File');

            expect(frameOf(screen).split('\n').some((row) => row.includes('Use SSL') && row.includes('☐'))).toBe(true);
            expect(frameOf(screen)).not.toContain('(stage:');

            screen.unmount();

            const checked = editScreen({ ssl: false }, stageCa);

            await toggle(checked, 'Use SSL');

            const config = await saved(checked);

            expect(config.connection.ssl).toBe(true);

            checked.unmount();

        }, 20_000);

        it('should show none of the six SSL fields for a SQLite config', async () => {

            const screen = editScreen({ dialect: 'sqlite', database: ':memory:' });

            // The form shows a window of its rows, so every frame on the way to the last field is read.
            await focusRow(screen, 'Test Database');

            const frames = stripVTControlCharacters(screen.frames.join(''));

            expect(frames).toContain('Test Database');

            for (const label of ['Use SSL', 'Verify Certificate', 'CA File', 'Client Cert File', 'Client Key File', 'TLS Server Name']) {

                expect(frames).not.toContain(label);

            }

            screen.unmount();

        }, 20_000);

        it('should store no ssl key for a config with no stored ssl and Use SSL unchecked', async () => {

            const screen = editScreen();

            const config = await saved(screen);

            expect('ssl' in config.connection).toBe(false);

            screen.unmount();

        }, 20_000);

    });

});
