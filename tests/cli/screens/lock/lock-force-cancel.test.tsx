/**
 * LockForceScreen: the escape hatch on a spinner that has no form behind it.
 *
 * The other cancellable screens sit on a `Form`, which owns Escape while busy.
 * This one is a phase machine, so the wiring is its own and needs its own
 * proof: a "Checking lock status..." spinner over an unreachable database used
 * to be a dead end with no key that did anything.
 */
import { describe, it, expect, vi, mock, beforeEach, afterEach, afterAll } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider } from '../../../../src/tui/app-context.js';
import { ToastProvider } from '../../../../src/tui/components/index.js';
import { LockForceScreen } from '../../../../src/tui/screens/lock/LockForceScreen.js';

const actualCore = await import('../../../../src/core/index.js');
const actualConnection = await import('../../../../src/core/connection/index.js');

function makeConfig() {

    return {
        name: 'test',
        type: 'local' as const,
        isTest: true,
        access: { user: 'admin' as const, agent: 'admin' as const },
        connection: {
            dialect: 'postgres' as const,
            host: 'localhost',
            port: 5432,
            database: 'test_db',
            user: 'admin',
        },
    };

}

const mockStateManager = {
    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfig: vi.fn().mockReturnValue(makeConfig()),
    getActiveConfigName: vi.fn().mockReturnValue('test'),
    listConfigs: vi.fn().mockReturnValue([makeConfig()]),
    getConfig: vi.fn().mockReturnValue(makeConfig()),
    setConfig: vi.fn().mockResolvedValue(undefined),
    setActiveConfig: vi.fn().mockResolvedValue(undefined),
    hasPrivateKey: vi.fn().mockReturnValue(true),
    isLoaded: true,
};

const mockSettingsManager = {
    load: vi.fn().mockResolvedValue({ version: '0.1.0' }),
    isLoaded: true,
    settings: { version: '0.1.0' },
    getStages: vi.fn().mockReturnValue({}),
    getStage: vi.fn().mockReturnValue(undefined),
};

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
 * What the connection seam does right now.
 *
 * `mock.module` is process-global and never restores, so whatever is installed
 * here serves every file that runs after this one — the `afterAll` below is a
 * courtesy, not a restore. Defaulting to the real implementations and putting
 * them back in `afterEach` is what keeps a deliberately hung connect from
 * becoming a hung connect for the rest of the group.
 *
 * The real implementations are captured into consts *before* `mock.module`
 * runs: a module namespace is a live binding, so reading
 * `actualConnection.testConnection` afterwards hands back the mock, and the
 * mock delegating to itself is an infinite recursion.
 */
const realTestConnection = actualConnection.testConnection;
const realCreateConnection = actualConnection.createConnection;

const seam = {
    testConnection: realTestConnection,
    createConnection: realCreateConnection,
};

/** A call that never answers: the hung connect this screen had no way out of. */
const neverAnswers = () => new Promise<never>(() => undefined);

const testConnectionMock = vi.fn(
    (config: Parameters<typeof actualConnection.testConnection>[0],
        options?: Parameters<typeof actualConnection.testConnection>[1]) =>
        seam.testConnection(config, options),
);

mock.module('../../../../src/core/connection/index.js', () => ({
    ...actualConnection,
    testConnection: testConnectionMock,
    createConnection: (...args: Parameters<typeof actualConnection.createConnection>) =>
        seam.createConnection(...args),
}));

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

describe('cli: LockForceScreen cancellation', () => {

    beforeEach(() => {

        vi.clearAllMocks();

        seam.testConnection = neverAnswers;
        seam.createConnection = neverAnswers;

    });

    afterEach(() => {

        // Hand the real implementations back before the next file runs. The
        // promises already parked belong to screens this file unmounted, so
        // nothing is left waiting on them.
        seam.testConnection = realTestConnection;
        seam.createConnection = realCreateConnection;

    });

    afterAll(() => {

        mock.module('../../../../src/core/index.js', () => actualCore);
        mock.module('../../../../src/core/connection/index.js', () => actualConnection);

    });

    it('should advertise the hatch while the lock check is in flight', async () => {

        const { lastFrame, unmount } = render(
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider autoLoad={true}>
                        <ToastProvider><LockForceScreen params={{}} /></ToastProvider>
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>,
        );

        await waitFor(() => Boolean(lastFrame()?.includes('Checking lock status')));

        expect(lastFrame()).toContain('[Esc] Cancel');

        unmount();

    }, 20_000);

    it('should leave the spinner for a dismissible message on Escape', async () => {

        const { stdin, lastFrame, unmount } = render(
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider autoLoad={true}>
                        <ToastProvider><LockForceScreen params={{}} /></ToastProvider>
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>,
        );

        await waitFor(() => Boolean(lastFrame()?.includes('Checking lock status')));

        stdin.write('\x1B');

        await waitFor(() => Boolean(lastFrame()?.includes('Stopped waiting')));

        expect(lastFrame()).not.toContain('Checking lock status');
        expect(lastFrame()).toContain('Stopped waiting');
        expect(lastFrame()).toContain('[Enter/Esc] Back');

        unmount();

    }, 20_000);

    it('should abort the signal it handed the connection layer', async () => {

        const { stdin, lastFrame, unmount } = render(
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider autoLoad={true}>
                        <ToastProvider><LockForceScreen params={{}} /></ToastProvider>
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>,
        );

        await waitFor(() => Boolean(lastFrame()?.includes('Checking lock status')));

        const options = testConnectionMock.mock.calls[0]?.[1];
        const signal = options?.signal;

        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal?.aborted).toBe(false);

        stdin.write('\x1B');

        await waitFor(() => Boolean(signal?.aborted));

        expect(signal?.aborted).toBe(true);

        unmount();

    }, 20_000);

});
