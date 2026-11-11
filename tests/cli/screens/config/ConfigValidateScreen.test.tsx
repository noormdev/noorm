import { describe, it, expect, vi, mock, beforeEach, afterEach } from 'bun:test';
import { stripVTControlCharacters } from 'node:util';
import { tmpdir } from 'node:os';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider, useAppContext } from '../../../../src/tui/app-context.js';
import { ConfigValidateScreen } from '../../../../src/tui/screens/config/ConfigValidateScreen.js';
import type { Config } from '../../../../src/core/config/types.js';
import type { ConnectionConfig } from '../../../../src/core/connection/types.js';

const actualCore = await import('../../../../src/core/index.js');
const actualIdentity = await import('../../../../src/core/identity/index.js');
const actualConnectionFactory = await import('../../../../src/core/connection/factory.js');

const caFile = './certs/stage-ca.pem';

function storedCi(userRole: string, connection: Partial<ConnectionConfig> = {}): Config {

    return {
        name: 'ci',
        type: 'local',
        isTest: false,
        access: { user: userRole, agent: 'viewer' },
        connection: { dialect: 'postgres', host: 'db', database: 'app', user: 'app', ...connection },
    };

}

let stored = storedCi('viewer');

const stateManager = {
    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfigName: vi.fn().mockReturnValue(null),
    getConfig: vi.fn((name: string) => (name === stored.name ? stored : null)),
    listConfigs: vi.fn(() => []),
    hasPrivateKey: vi.fn().mockReturnValue(true),
    isLoaded: true,
};

const settingsManager = {
    load: vi.fn().mockResolvedValue({ version: '0.1.0' }),
    isLoaded: true,
    settings: { version: '0.1.0' },
    getStages: vi.fn().mockReturnValue({}),
    getStage: vi.fn((name: string) => (name === 'ci' ? { defaults: { ssl: { caFile } } } : undefined)),
};

mock.module('../../../../src/core/index.js', () => ({
    ...actualCore,
    getStateManager: vi.fn(() => stateManager),
    getSettingsManager: vi.fn(() => settingsManager),
}));

mock.module('../../../../src/core/identity/index.js', () => ({
    ...actualIdentity,
    loadExistingIdentity: vi.fn().mockResolvedValue(null),
}));

const tested: ConnectionConfig[] = [];

// Answers at once: this replacement outlives the file, and a later screen waits on it.
mock.module('../../../../src/core/connection/factory.js', () => ({
    ...actualConnectionFactory,
    testConnection: async (connection: ConnectionConfig) => {

        tested.push(connection);

        return { ok: true };

    },
}));

async function waitFor(predicate: () => boolean, timeoutMs = 4000) {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

/** Mounts the screen once the managers are loaded, so it finds the config. */
function ValidateWhenReady(): React.ReactElement | null {

    return useAppContext().loadingStatus === 'ready' ? <ConfigValidateScreen params={{ name: 'ci' }} /> : null;

}

describe('cli: ConfigValidateScreen', () => {

    async function validate(config: Config) {

        stored = config;

        const screen = render(
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider projectRoot={tmpdir()}>
                        <ValidateWhenReady />
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>,
        );
        const frame = () => stripVTControlCharacters(screen.lastFrame() ?? '');

        await waitFor(() => frame().includes('Status:'));

        return { ...screen, frame };

    }

    beforeEach(() => {

        actualCore.observer.clear();
        tested.length = 0;

    });

    afterEach(() => {

        actualCore.observer.clear();

    });

    it('should test the connection with the stage caFile a config with no stored ssl lacks', async () => {

        const { unmount } = await validate(storedCi('viewer'));

        expect(tested).toHaveLength(1);
        expect(tested[0]?.ssl).toEqual({ caFile });
        unmount();

    });

    it('should validate a config whose role the project does not define', async () => {

        const { frame, unmount } = await validate(storedCi('ghost'));

        expect(frame()).toContain('Status:');
        expect(tested[0]?.ssl).toEqual({ caFile });
        unmount();

    });

    it('should report a config its stage defaults make invalid without testing a connection', async () => {

        // Above the default pool.max of 10, which the stored config alone does not carry.
        const { frame, unmount } = await validate(storedCi('viewer', { pool: { min: 11 } }));

        expect(frame()).toContain('INCOMPLETE');
        expect(frame()).toContain('pool');
        expect(tested).toHaveLength(0);
        unmount();

    });

});
