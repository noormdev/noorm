/**
 * ConfigRemoveScreen tests.
 *
 * Verifies the locked-stage guard surfaces as a blocked panel naming the
 * locking stage, and that an unlocked-stage config still deletes normally
 * (no over-blocking).
 */
import { describe, it, expect, vi, mock, beforeEach, afterEach, afterAll } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider } from '../../../../src/tui/app-context.js';
import { ToastProvider } from '../../../../src/tui/components/index.js';
import { ConfigRemoveScreen } from '../../../../src/tui/screens/config/ConfigRemoveScreen.js';

// Pre-import actual modules for restoration
const actualCore = await import('../../../../src/core/index.js');
const actualIdentity = await import('../../../../src/core/identity/index.js');

/**
 * Builds a config fixture with an `access` role that always passes the
 * `config:rm` policy check (admin), so tests exercise the lock guard in
 * isolation from the policy-denied branch.
 */
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

// Mutable so each test can swap in its own fixture; the mock.module
// factory closures read these at call time (matches init-flow.test.tsx).
let mockStateManager = createMockStateManager('prod', makeConfig('prod'));
let mockSettingsManager = createMockSettingsManager({});

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

describe('cli: ConfigRemoveScreen', () => {

    beforeEach(() => {

        vi.clearAllMocks();
        actualCore.observer.clear();
        // Skips confirm-phrase prompts so tests land on the plain "Are you
        // sure" branch instead of ProtectedConfirm's type-to-confirm UI.
        process.env['NOORM_YES'] = '1';

    });

    afterEach(() => {

        actualCore.observer.clear();
        delete process.env['NOORM_YES'];

    });

    afterAll(() => {

        mock.module('../../../../src/core/index.js', () => actualCore);
        mock.module('../../../../src/core/identity/index.js', () => actualIdentity);

    });

    it('should render a blocked panel naming the locking stage for a locked-stage config', async () => {

        mockStateManager = createMockStateManager('prod', makeConfig('prod'));
        mockSettingsManager = createMockSettingsManager({ prod: { locked: true } });

        const { lastFrame, unmount } = render(
            <TestWrapper>
                <ConfigRemoveScreen params={{ name: 'prod' }} />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 50));

        const frame = lastFrame();

        expect(frame).toContain('locked stage');
        expect(frame).toContain('prod');
        expect(frame).not.toContain('Are you sure');

        unmount();

    });

    it('should render the normal confirmation for an unlocked-stage config', async () => {

        mockStateManager = createMockStateManager('dev', makeConfig('dev'));
        mockSettingsManager = createMockSettingsManager({ dev: { locked: false } });

        const { lastFrame, unmount } = render(
            <TestWrapper>
                <ConfigRemoveScreen params={{ name: 'dev' }} />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 50));

        const frame = lastFrame();

        expect(frame).toContain('Are you sure');
        expect(frame).not.toContain('locked stage');

        unmount();

    });

});
