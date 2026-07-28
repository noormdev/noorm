/**
 * ConfigEditScreen tests.
 *
 * Proves the rename-path delete is wired to pass a `SettingsProvider` into
 * `StateManager.deleteConfig` — belt-and-suspenders with the core-seam guard
 * (`assertCanDeleteConfig`), which is what actually enforces the locked-stage
 * block and is already covered by iteration 1's `state/manager.test.ts`.
 *
 * A full render assertion of the surfaced error text was tried and dropped:
 * the Form's fixed-height `overflowY="hidden"` container (10 fields at the
 * 24-row ink-testing-library default terminal) clips the bottom status-error
 * row before it reaches `lastFrame()`, making a text assertion flaky/false-
 * negative independent of the wiring. Spying on the mock call args is
 * deterministic and still proves the wiring is load-bearing: revert the
 * `settingsProvider` argument and this test goes red.
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
        access: { user: 'admin' as const, mcp: 'admin' as const },
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

mock.module('../../../../src/core/connection/factory.js', () => ({
    ...actualConnectionFactory,
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
}));

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

    });

    afterEach(() => {

        actualCore.observer.clear();

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
        // hook count if useStdout is called after the returns.
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

        const { stdin, unmount } = render(
            <TestWrapper>
                <ConfigEditScreen params={{ name: 'prod' }} />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 150));

        // Rename "prod" -> "prod2" (name field is active by default) and
        // submit via Enter, which TextInput routes straight to handleSubmit.
        stdin.write('2');
        await new Promise((r) => setTimeout(r, 50));
        stdin.write('\r');

        await new Promise((r) => setTimeout(r, 200));

        expect(mockStateManager.deleteConfig).toHaveBeenCalledTimes(1);

        const [deletedName, settingsProviderArg] = mockStateManager.deleteConfig.mock.calls[0] as [
            string,
            unknown,
        ];

        expect(deletedName).toBe('prod');
        expect(settingsProviderArg).toBeInstanceOf(SettingsProvider);

        unmount();

    });

});
