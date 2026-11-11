// The identity sync connects through the real createConnection, so the stage caFile names an absent file
// and its path in the SslFileError proves which config the sync was given.
import { describe, it, expect, vi, mock, beforeEach, afterEach } from 'bun:test';
import { stripVTControlCharacters } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider, useAppContext } from '../../../../src/tui/app-context.js';
import { ConfigUseScreen } from '../../../../src/tui/screens/config/ConfigUseScreen.js';
import { SslFileError } from '../../../../src/core/connection/ssl-files.js';
import { clearIdentityOverride, getIdentityOverride, setIdentityOverride } from '../../../../src/core/identity/storage.js';
import type { Config } from '../../../../src/core/config/types.js';
import type { NoormEvents } from '../../../../src/core/observer.js';
import type { StageDefaults } from '../../../../src/core/settings/types.js';

const actualCore = await import('../../../../src/core/index.js');
const actualIdentity = await import('../../../../src/core/identity/index.js');

type StoredConfig = Pick<Config, 'name' | 'type' | 'access' | 'connection'> & { isTest?: boolean };

const caFile = join(tmpdir(), 'noorm-config-use-absent', 'stage-ca.pem');

const previous: StoredConfig = {
    name: 'previous',
    type: 'local',
    isTest: false,
    access: { user: 'admin', agent: 'admin' },
    connection: { dialect: 'sqlite', database: ':memory:' },
};

/** A server config that stores no `ssl` and no `isTest`: both can only come from its stage. */
function storedCi(userRole = 'viewer'): StoredConfig {

    return {
        name: 'ci',
        type: 'local',
        access: { user: userRole, agent: 'viewer' },
        connection: { dialect: 'postgres', host: '127.0.0.1', port: 1, database: 'app', user: 'app' },
    };

}

/** The sync connects to it for real. A viewer may not record, so `identity:synced` fires only when the bound policy context trusts `isTest`. */
function storedSqliteCi(isTest?: boolean): StoredConfig {

    return {
        name: 'ci',
        type: 'local',
        ...(isTest === undefined ? {} : { isTest }),
        access: { user: 'viewer', agent: 'viewer' },
        connection: { dialect: 'sqlite', database: ':memory:' },
    };

}

function createStateManager(target: StoredConfig) {

    const configs = [previous, target];
    let activeName = previous.name;

    return {
        load: vi.fn().mockResolvedValue(undefined),
        getActiveConfigName: vi.fn(() => activeName),
        getConfig: vi.fn((name: string) => configs.find((config) => config.name === name) ?? null),
        listConfigs: vi.fn(() => []),
        setActiveConfig: vi.fn(async (name: string) => {

            activeName = name;

        }),
        addKnownUsers: vi.fn().mockResolvedValue(undefined),
        hasPrivateKey: vi.fn().mockReturnValue(true),
        isLoaded: true,
    };

}

function createSettingsManager(defaults: StageDefaults) {

    return {
        load: vi.fn().mockResolvedValue({ version: '0.1.0' }),
        isLoaded: true,
        settings: { version: '0.1.0' },
        getStages: vi.fn().mockReturnValue({}),
        getStage: vi.fn((name: string) => (name === 'ci' ? { defaults } : undefined)),
    };

}

let stateManager = createStateManager(storedCi());
let settingsManager = createSettingsManager({});

mock.module('../../../../src/core/index.js', () => ({
    ...actualCore,
    getStateManager: vi.fn(() => stateManager),
    getSettingsManager: vi.fn(() => settingsManager),
}));

// Replacing this export also replaces it for `identity/sync.ts`, which imports it from `factory.js`,
// so a stand-in that returned null would end the sync before it connects.
mock.module('../../../../src/core/identity/index.js', () => ({
    ...actualIdentity,
    loadExistingIdentity: async () => getIdentityOverride(),
}));

async function waitFor(predicate: () => boolean, timeoutMs = 4000) {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

describe('cli: ConfigUseScreen', () => {

    let errors: NoormEvents['error'][] = [];
    let synced: NoormEvents['identity:synced'][] = [];

    /** Mounts the screen once the managers are loaded, so its first effect sees them. */
    function UseWhenReady(): React.ReactElement | null {

        return useAppContext().loadingStatus === 'ready' ? <ConfigUseScreen params={{ name: 'ci' }} /> : null;

    }

    function switchToCi(target: StoredConfig, defaults: StageDefaults) {

        stateManager = createStateManager(target);
        settingsManager = createSettingsManager(defaults);

        const screen = render(
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider projectRoot={tmpdir()}>
                        <UseWhenReady />
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>,
        );

        return { ...screen, frame: () => stripVTControlCharacters(screen.lastFrame() ?? '') };

    }

    beforeEach(() => {

        actualCore.observer.clear();
        errors = [];
        synced = [];
        actualCore.observer.on('error', (event) => errors.push(event));
        actualCore.observer.on('identity:synced', (event) => synced.push(event));
        setIdentityOverride({
            identityHash: 'test-hash',
            name: 'Ada Lovelace',
            email: 'ada@example.com',
            publicKey: 'test-public-key',
            machine: 'test-machine',
            os: 'test-os',
            createdAt: '2026-01-01T00:00:00.000Z',
        });

    });

    afterEach(() => {

        clearIdentityOverride();
        actualCore.observer.clear();

    });

    it('should sync identity with the stage caFile a config with no stored ssl lacks', async () => {

        const { unmount } = switchToCi(storedCi(), { ssl: { caFile } });

        await waitFor(() => errors.some((event) => event.source === 'identity:sync:connection'));

        const event = errors.find((candidate) => candidate.source === 'identity:sync:connection');

        expect(event?.error).toBeInstanceOf(SslFileError);
        expect(event?.error.message).toBe(`Cannot read ssl.caFile '${caFile}': ENOENT`);
        unmount();

    });

    it('should show the validation error for a config with an unknown role', async () => {

        const { frame, unmount } = switchToCi(storedCi('ghost'), { ssl: { caFile } });

        await waitFor(() => frame().includes('ghost'));

        expect(frame()).toContain('ghost');
        expect(frame()).not.toContain('Switched to');
        expect(stateManager.setActiveConfig).not.toHaveBeenCalled();
        expect(errors).toHaveLength(0);
        unmount();

    });

    // The screen reports the switch after the sync returns, then re-renders as already active once the app context refreshes.
    const switched = /Switched to|is already active/;

    it('should hand the sync no trusted-test grant when only the stage sets isTest', async () => {

        const { frame, unmount } = switchToCi(storedSqliteCi(), { isTest: true });

        await waitFor(() => switched.test(frame()));

        expect(frame()).toMatch(switched);
        expect(errors).toHaveLength(0);
        expect(synced).toHaveLength(0);
        unmount();

    });

    it('should let the sync register when the stored config sets isTest', async () => {

        const { frame, unmount } = switchToCi(storedSqliteCi(true), {});

        await waitFor(() => switched.test(frame()));

        expect(synced).toHaveLength(1);
        expect(synced[0]?.configName).toBe('ci');
        unmount();

    });

});
