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
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { stripVTControlCharacters } from 'node:util';
import { join } from 'node:path';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider } from '../../../../src/tui/app-context.js';
import { ToastProvider } from '../../../../src/tui/components/index.js';
import { ConnectionProvider } from '../../../../src/tui/providers/ConnectionProvider.js';
import { LockForceScreen } from '../../../../src/tui/screens/lock/LockForceScreen.js';
import { LockAcquireScreen } from '../../../../src/tui/screens/lock/LockAcquireScreen.js';
import { LockReleaseScreen } from '../../../../src/tui/screens/lock/LockReleaseScreen.js';
import { resolveScreenIdentity } from '../../../../src/tui/utils/identity.js';
import { formatIdentity } from '../../../../src/core/identity/resolver.js';
import { ensureSchemaVersion } from '../../../../src/core/version/index.js';

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

const mockSettingsManager: Record<string, unknown> = {
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

    while (!predicate()) {

        if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);

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

// These screens call the lock manager directly, so the SDK gate never sees them.
describe('cli: lock screens policy', () => {

    const viewer = { ...makeConfig(), isTest: false, access: { user: 'viewer' as const, agent: false as const } };

    beforeEach(() => {

        vi.clearAllMocks();
        mockStateManager.getActiveConfig.mockReturnValue(viewer);
        mockStateManager.getConfig.mockReturnValue(viewer);
        seam.testConnection = neverAnswers;
        seam.createConnection = neverAnswers;

    });

    afterEach(() => {

        mockStateManager.getActiveConfig.mockReturnValue(makeConfig());
        mockStateManager.getConfig.mockReturnValue(makeConfig());
        seam.testConnection = realTestConnection;
        seam.createConnection = realCreateConnection;

    });

    it.each([
        ['acquire', LockAcquireScreen, 'lock:acquire'],
        ['release', LockReleaseScreen, 'lock:acquire'],
        ['force release', LockForceScreen, 'lock:force'],
    ])('should refuse a viewer on the %s screen', async (_name, Screen, permission) => {

        const { lastFrame, unmount } = render(
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider autoLoad={true}>
                        <ConnectionProvider>
                            <ToastProvider><Screen params={{}} /></ToastProvider>
                        </ConnectionProvider>
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>,
        );

        await waitFor(() => Boolean(lastFrame()?.includes(permission)));

        expect(lastFrame()).toContain(`"${permission}" is not allowed`);
        expect(lastFrame()).toContain('(role: viewer)');

        unmount();

    }, 20_000);

    // Connecting prepares the tracking tables, a write the role may not make.
    it.each([
        ['acquire', LockAcquireScreen],
        ['release', LockReleaseScreen],
        ['force release', LockForceScreen],
    ])('should open no connection when a viewer opens the %s screen', async (_name, Screen) => {

        const dir = mkdtempSync(join(tmpdir(), 'noorm-lock-screen-'));
        const database = join(dir, 'fresh.db');
        const fresh = { ...viewer, connection: { dialect: 'sqlite' as const, database } };
        mockStateManager.getActiveConfig.mockReturnValue(fresh);
        mockStateManager.getConfig.mockReturnValue(fresh);
        seam.testConnection = realTestConnection;
        seam.createConnection = realCreateConnection;

        const { lastFrame, unmount } = render(
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider autoLoad={true}>
                        <ConnectionProvider>
                            <ToastProvider><Screen params={{}} /></ToastProvider>
                        </ConnectionProvider>
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>,
        );

        await waitFor(() => Boolean(lastFrame()?.includes('is not allowed')));
        unmount();

        const opened = existsSync(database);
        rmSync(dir, { recursive: true, force: true });

        expect(opened).toBe(false);

    }, 20_000);

});

// The CLI answers a `confirm` cell with "requires confirmation"; the screens must ask for the phrase, not act.
describe('cli: lock screens confirmation', () => {

    const HOLDER = 'someone else';
    const PHRASE = 'Type yes-test to confirm';
    const plain = (frame: string | undefined) => stripVTControlCharacters(frame ?? '');
    const self = formatIdentity(resolveScreenIdentity(null));

    let dir: string;
    let database: string;

    function useConfig(user: string) {

        const config = {
            ...makeConfig(), isTest: false, access: { user, agent: false as const },
            connection: { dialect: 'sqlite' as const, database },
        };
        mockStateManager.getActiveConfig.mockReturnValue(config);
        mockStateManager.getConfig.mockReturnValue(config);

    }

    function open(Screen: typeof LockForceScreen) {

        return render(
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider autoLoad={true}>
                        <ConnectionProvider>
                            <ToastProvider><Screen params={{}} /></ToastProvider>
                        </ConnectionProvider>
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>,
        );

    }

    function lockHolders(): string[] {

        const db = new Database(database);
        const rows = db.query<{ locked_by: string }, []>('SELECT locked_by FROM __noorm_lock__').all();
        db.close();

        return rows.map((row) => row.locked_by);

    }

    async function seedLock(holder: string): Promise<void> {

        const connection = await realCreateConnection({ dialect: 'sqlite', database });
        await ensureSchemaVersion(connection.db as Parameters<typeof ensureSchemaVersion>[0], 'sqlite');
        await connection.destroy();

        const db = new Database(database);
        db.run(
            "INSERT INTO __noorm_lock__ (config_name, locked_by, locked_at, expires_at, reason) VALUES ('test', ?, ?, ?, '')",
            [holder, new Date().toISOString(), new Date(Date.now() + 600_000).toISOString()],
        );
        db.close();

    }

    beforeEach(() => {

        vi.clearAllMocks();
        dir = mkdtempSync(join(tmpdir(), 'noorm-lock-confirm-'));
        database = join(dir, 'locks.db');
        mockSettingsManager.settings = {
            version: '0.1.0',
            access: { roles: { careful: { extends: 'admin', permissions: { 'lock:acquire': 'confirm' } } } },
        };
        seam.testConnection = realTestConnection;
        seam.createConnection = realCreateConnection;

    });

    afterEach(() => {

        mockSettingsManager.settings = { version: '0.1.0' };
        mockStateManager.getActiveConfig.mockReturnValue(makeConfig());
        mockStateManager.getConfig.mockReturnValue(makeConfig());
        rmSync(dir, { recursive: true, force: true });

    });

    it('should ask an admin for the phrase before force-releasing on an unguarded config', async () => {

        useConfig('admin');
        await seedLock(HOLDER);

        const { lastFrame, unmount } = open(LockForceScreen);

        await waitFor(() => plain(lastFrame()).includes(PHRASE));
        const frame = plain(lastFrame());
        unmount();

        expect(frame).toContain(HOLDER);

        expect(frame).toContain(PHRASE);
        expect(lockHolders()).toEqual([HOLDER]);

    }, 20_000);

    it('should ask for the phrase before releasing when the role must confirm lock:acquire', async () => {

        useConfig('careful');
        await seedLock(self);

        const { lastFrame, unmount } = open(LockReleaseScreen);

        await waitFor(() => plain(lastFrame()).includes(PHRASE));
        const frame = plain(lastFrame());
        unmount();

        expect(frame).toContain(PHRASE);
        expect(lockHolders()).toEqual([self]);

    }, 20_000);

    it('should ask for the phrase before acquiring when the role must confirm lock:acquire', async () => {

        useConfig('careful');

        const { stdin, lastFrame, unmount } = open(LockAcquireScreen);
        const settled = () => /yes-test|Lock Acquired|Failed/.test(plain(lastFrame()));

        await waitFor(() => Boolean(lastFrame()?.includes('Timeout (minutes)')));

        // Two fields, then the submit action; a key sent before the form takes focus is dropped, so the walk repeats.
        const pace = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        for (let walk = 0; walk < 20 && !settled(); walk++) {

            stdin.write('\x1B[B');
            await pace(40);
            stdin.write('\r');
            await pace(100);

        }

        const frame = plain(lastFrame());
        unmount();

        expect(frame).toContain(PHRASE);
        expect(lockHolders()).toEqual([]);

    }, 20_000);

});
