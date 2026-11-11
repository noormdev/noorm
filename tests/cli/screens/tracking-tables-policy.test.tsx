/** Opening a screen must not create noorm's tracking tables for a role that cannot write. */
import { describe, it, expect, vi, mock, spyOn, beforeEach, afterEach, afterAll } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReactElement } from 'react';

import type { ScreenProps } from '../../../src/tui/types.js';
import { FocusProvider } from '../../../src/tui/focus.js';
import { RouterProvider } from '../../../src/tui/router.js';
import { AppContextProvider } from '../../../src/tui/app-context.js';
import { ShutdownProvider } from '../../../src/tui/shutdown.js';
import { ToastProvider } from '../../../src/tui/components/index.js';
import { ConnectionProvider } from '../../../src/tui/providers/ConnectionProvider.js';
import { HomeScreen } from '../../../src/tui/screens/home.js';
import { LockStatusScreen } from '../../../src/tui/screens/lock/LockStatusScreen.js';
import { LockListScreen } from '../../../src/tui/screens/lock/LockListScreen.js';
import { VaultSetScreen } from '../../../src/tui/screens/vault/VaultSetScreen.js';
import { VaultRemoveScreen } from '../../../src/tui/screens/vault/VaultRemoveScreen.js';
import { ChangeListScreen } from '../../../src/tui/screens/change/ChangeListScreen.js';
import { ChangeHistoryScreen } from '../../../src/tui/screens/change/ChangeHistoryScreen.js';
import { ConfigUseScreen } from '../../../src/tui/screens/config/ConfigUseScreen.js';
import { clearIdentityOverride, setIdentityOverride } from '../../../src/core/identity/storage.js';
import { resetLifecycleManager } from '../../../src/core/lifecycle/index.js';
import { createConnection } from '../../../src/core/connection/factory.js';
import { ensureSchemaVersion } from '../../../src/core/version/index.js';
import { CURRENT_VERSIONS } from '../../../src/core/version/types.js';
import { LockManager } from '../../../src/core/lock/index.js';
import { ChangeHistory } from '../../../src/core/change/history.js';

const actualCore = await import('../../../src/core/index.js');
const actualIdentity = await import('../../../src/core/identity/index.js');

// Copied by value: `mock.module` rewrites these namespaces in place, so re-registering
// `actualCore` afterwards would hand the mocks back to every later file.
const realCore = {
    getStateManager: actualCore.getStateManager,
    getSettingsManager: actualCore.getSettingsManager,
    resetStateManager: actualCore.resetStateManager,
    resetSettingsManager: actualCore.resetSettingsManager,
};
const realLoadExistingIdentity = actualIdentity.loadExistingIdentity;

type Role = 'viewer' | 'operator';

function makeConfig(role: Role, database: string) {

    return {
        name: 'test',
        type: 'local' as const,
        isTest: false,
        access: { user: role, agent: false as const },
        connection: { dialect: 'sqlite' as const, database },
    };

}

const mockStateManager = {
    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfig: vi.fn(),
    getActiveConfigName: vi.fn().mockReturnValue('test'),
    listConfigs: vi.fn().mockReturnValue([]),
    getConfig: vi.fn(),
    setConfig: vi.fn().mockResolvedValue(undefined),
    setActiveConfig: vi.fn().mockResolvedValue(undefined),
    addKnownUsers: vi.fn().mockResolvedValue(undefined),
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

const IDENTITY = {
    identityHash: 'hash-self',
    name: 'Self',
    email: 'self@example.com',
    publicKey: 'pub-self',
    machine: 'test',
    os: 'test',
    createdAt: new Date().toISOString(),
};

mock.module('../../../src/core/index.js', () => ({
    ...actualCore,
    getStateManager: vi.fn(() => mockStateManager),
    getSettingsManager: vi.fn(() => mockSettingsManager),
    resetStateManager: vi.fn(),
    resetSettingsManager: vi.fn(),
}));

mock.module('../../../src/core/identity/index.js', () => ({
    ...actualIdentity,
    loadExistingIdentity: vi.fn().mockResolvedValue(IDENTITY),
}));

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate()) {

        if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

/**
 * Resolves once the first call to a spied read has settled.
 *
 * Mounted into a context that is still loading, these screens paint their empty
 * state before they connect, so a frame alone does not show that anything was read.
 */
async function settled(read: { mock: { results: { value?: unknown }[] } }): Promise<void> {

    await waitFor(() => read.mock.results.length > 0);
    await read.mock.results[0]?.value;

}

// eslint-disable-next-line no-control-regex
const plain = (frame: string | undefined) => (frame ?? '').replace(/\x1B\[[0-9;]*m/g, '');

function tableNames(database: string): string[] {

    if (!existsSync(database)) return [];

    const db = new Database(database);
    const rows = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    db.close();

    return rows.map((row) => row.name);

}

describe('cli: screens and tracking tables', () => {

    let dir: string;
    let database: string;

    function open(Screen: (props: ScreenProps) => ReactElement, role: Role, params: ScreenProps['params'] = {}) {

        const config = makeConfig(role, database);
        mockStateManager.getActiveConfig.mockReturnValue(config);
        mockStateManager.getConfig.mockReturnValue(config);
        mockStateManager.listConfigs.mockReturnValue([config]);

        return render(
            <ShutdownProvider projectRoot={dir}>
                <FocusProvider>
                    <RouterProvider>
                        <AppContextProvider autoLoad={true}>
                            <ConnectionProvider>
                                <ToastProvider><Screen params={params} /></ToastProvider>
                            </ConnectionProvider>
                        </AppContextProvider>
                    </RouterProvider>
                </FocusProvider>
            </ShutdownProvider>,
        );

    }

    /** Tracking tables one schema version behind, as an older noorm would have left them. */
    async function seedOlderTrackingTables(): Promise<void> {

        const connection = await createConnection({ dialect: 'sqlite', database });
        await ensureSchemaVersion(connection.db as Parameters<typeof ensureSchemaVersion>[0], 'sqlite');
        await connection.destroy();

        const db = new Database(database);
        db.run('UPDATE __noorm_version__ SET noorm_version = ?', [CURRENT_VERSIONS.schema - 1]);
        db.close();

    }

    const reads = {
        status: spyOn(LockManager.prototype, 'status'),
        getAllStatuses: spyOn(ChangeHistory.prototype, 'getAllStatuses'),
        getUnifiedHistory: spyOn(ChangeHistory.prototype, 'getUnifiedHistory'),
    };

    beforeEach(() => {

        dir = mkdtempSync(join(tmpdir(), 'noorm-screen-tracking-'));
        database = join(dir, 'fresh.db');

        for (const read of Object.values(reads)) read.mockClear();

    });

    afterEach(async () => {

        // ShutdownProvider stops the process-wide lifecycle manager on unmount; the next mount needs an idle one.
        await resetLifecycleManager();
        rmSync(dir, { recursive: true, force: true });

    });

    afterAll(() => {

        for (const read of Object.values(reads)) read.mockRestore();

        mock.module('../../../src/core/index.js', () => ({ ...actualCore, ...realCore }));
        mock.module('../../../src/core/identity/index.js', () => ({ ...actualIdentity, loadExistingIdentity: realLoadExistingIdentity }));

    });

    it('should show a viewer the home screen without creating tracking tables', async () => {

        const { lastFrame, unmount } = open(HomeScreen, 'viewer');

        await waitFor(() => plain(lastFrame()).includes('FREE'));
        const frame = plain(lastFrame());
        unmount();

        expect(frame).toContain('Connected');
        expect(frame).toContain('FREE');
        expect(frame).toContain('No recent activity');
        expect(tableNames(database)).toEqual([]);

    }, 20_000);

    it('should still create tracking tables when an operator opens the home screen', async () => {

        const { lastFrame, unmount } = open(HomeScreen, 'operator');

        await waitFor(() => plain(lastFrame()).includes('FREE'));
        unmount();

        expect(tableNames(database)).toContain('__noorm_version__');

    }, 20_000);

    it.each([
        ['status', LockStatusScreen],
        ['list', LockListScreen],
    ])('should show a viewer no lock on the lock %s screen without creating tracking tables', async (_name, Screen) => {

        const { lastFrame, unmount } = open(Screen, 'viewer');

        await settled(reads.status);
        await waitFor(() => plain(lastFrame()).includes('UNLOCKED'));
        const frame = plain(lastFrame());
        unmount();

        expect(frame).toContain('UNLOCKED');
        expect(existsSync(database)).toBe(true);
        expect(tableNames(database)).toEqual([]);

    }, 20_000);

    it.each([
        ['set', VaultSetScreen, {}],
        ['remove', VaultRemoveScreen, { name: 'API_KEY' }],
    ])('should refuse a viewer on the vault %s screen without opening a connection', async (_name, Screen, params) => {

        const { lastFrame, unmount } = open(Screen, 'viewer', params);

        await waitFor(() => plain(lastFrame()).includes('is not allowed'));
        const frame = plain(lastFrame());
        // A connection would be requested by an effect that runs after the refusal is painted.
        const opened = await waitFor(() => existsSync(database), 200).then(() => true, () => false);
        unmount();

        expect(frame).toContain('"vault:read" is not allowed');
        expect(frame).toContain('(role: viewer)');
        expect(opened).toBe(false);

    }, 20_000);

    it.each([
        ['list', ChangeListScreen, 'No changes found.', 'getAllStatuses'],
        ['history', ChangeHistoryScreen, 'No execution history found.', 'getUnifiedHistory'],
    ] as const)('should show a viewer an empty change %s without creating tracking tables', async (_name, Screen, empty, read) => {

        const { lastFrame, unmount } = open(Screen, 'viewer');

        await settled(reads[read]);
        await waitFor(() => plain(lastFrame()).includes(empty));
        const frame = plain(lastFrame());
        unmount();

        expect(frame).toContain(empty);
        expect(existsSync(database)).toBe(true);
        expect(tableNames(database)).toEqual([]);

    }, 20_000);

    it('should tell a viewer that older tracking tables need a role that can write', async () => {

        await seedOlderTrackingTables();

        const { lastFrame, unmount } = open(LockStatusScreen, 'viewer');

        await waitFor(() => plain(lastFrame()).includes('tracking tables are at schema version'));
        const frame = plain(lastFrame()).replace(/\s+/g, ' ');
        unmount();

        expect(frame).toContain(`tracking tables are at schema version ${CURRENT_VERSIONS.schema - 1}`);
        expect(frame).toContain('cannot migrate them');

        const db = new Database(database);
        const row = db.query<{ noorm_version: number }, []>('SELECT noorm_version FROM __noorm_version__ ORDER BY id DESC').get();
        db.close();

        expect(row?.noorm_version).toBe(CURRENT_VERSIONS.schema - 1);

    }, 20_000);

    describe('activating a config', () => {

        const USED = 'Switched to configuration';

        function activate(role: Role) {

            mockStateManager.getActiveConfigName.mockReturnValue('other');

            return open(ConfigUseScreen, role, { name: 'test' });

        }

        function rows<T>(statement: string): T[] {

            const db = new Database(database);
            const found = db.query<T, []>(statement).all();
            db.close();

            return found;

        }

        beforeEach(() => {

            setIdentityOverride(IDENTITY);

        });

        afterEach(() => {

            clearIdentityOverride();
            mockStateManager.getActiveConfigName.mockReturnValue('test');

        });

        it('should activate a viewer config on a fresh database without creating tracking tables', async () => {

            const { lastFrame, unmount } = activate('viewer');

            await waitFor(() => plain(lastFrame()).includes(USED));
            unmount();

            expect(mockStateManager.setActiveConfig).toHaveBeenCalledWith('test');
            expect(tableNames(database)).toEqual([]);

        }, 20_000);

        it('should create the tracking tables and register the identity for an operator', async () => {

            const { lastFrame, unmount } = activate('operator');

            await waitFor(() => plain(lastFrame()).includes(USED));
            unmount();

            expect(rows<{ email: string }>('SELECT email FROM __noorm_identities__')).toEqual([{ email: IDENTITY.email }]);

        }, 20_000);

        it('should leave older tracking tables unmigrated and unregistered for a viewer', async () => {

            await seedOlderTrackingTables();
            rows('DELETE FROM __noorm_identities__');

            const { lastFrame, unmount } = activate('viewer');

            await waitFor(() => plain(lastFrame()).includes(USED));
            unmount();

            expect(rows<{ noorm_version: number }>('SELECT noorm_version FROM __noorm_version__')).toEqual([{ noorm_version: CURRENT_VERSIONS.schema - 1 }]);
            expect(rows('SELECT email FROM __noorm_identities__')).toEqual([]);

        }, 20_000);

    });

});
