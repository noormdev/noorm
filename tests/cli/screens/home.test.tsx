// Both cases connect through the real createConnection: one names an absent ssl.caFile, the other dials
// a local socket that answers the PostgreSQL startup with SQLSTATE 3D000.
import { describe, it, expect, vi, mock, beforeEach, afterEach } from 'bun:test';
import { stripVTControlCharacters } from 'node:util';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../src/tui/focus.js';
import { RouterProvider } from '../../../src/tui/router.js';
import { ShutdownProvider } from '../../../src/tui/shutdown.js';
import { AppContextProvider } from '../../../src/tui/app-context.js';
import { ConnectionProvider } from '../../../src/tui/providers/ConnectionProvider.js';
import { HomeScreen } from '../../../src/tui/screens/home.js';
import { resetLifecycleManager } from '../../../src/core/lifecycle/manager.js';
import type { Config } from '../../../src/core/config/types.js';

const actualCore = await import('../../../src/core/index.js');
const actualIdentity = await import('../../../src/core/identity/index.js');

function makeConfig(connection: Partial<Config['connection']>): Config {

    return {
        name: 'app',
        type: 'local',
        isTest: false,
        access: { user: 'admin', agent: 'admin' },
        connection: { dialect: 'postgres', host: '127.0.0.1', database: 'app', user: 'app', ...connection },
    };

}

let activeConfig = makeConfig({});

const stateManager = {
    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfigName: vi.fn(() => activeConfig.name),
    getConfig: vi.fn(() => activeConfig),
    listConfigs: vi.fn(() => [{
        name: activeConfig.name,
        type: activeConfig.type,
        isTest: activeConfig.isTest,
        access: activeConfig.access,
        isActive: true,
        dialect: activeConfig.connection.dialect,
        database: activeConfig.connection.database,
    }]),
    hasPrivateKey: vi.fn().mockReturnValue(true),
    isLoaded: true,
};

const settingsManager = {
    load: vi.fn().mockResolvedValue({ version: '0.1.0' }),
    isLoaded: true,
    settings: { version: '0.1.0' },
    getStages: vi.fn().mockReturnValue({}),
    getStage: vi.fn().mockReturnValue(undefined),
};

mock.module('../../../src/core/index.js', () => ({
    ...actualCore,
    getStateManager: vi.fn(() => stateManager),
    getSettingsManager: vi.fn(() => settingsManager),
}));

mock.module('../../../src/core/identity/index.js', () => ({
    ...actualIdentity,
    loadExistingIdentity: vi.fn().mockResolvedValue(null),
}));

async function waitFor(predicate: () => boolean, timeoutMs = 4000) {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

/** One PostgreSQL ErrorResponse: severity FATAL, SQLSTATE 3D000, and the server's wording. */
function missingDatabaseResponse(): Buffer {

    const fields = Buffer.from('SFATAL\0C3D000\0Mdatabase "app" does not exist\0\0');
    const header = Buffer.alloc(5);

    header.write('E');
    header.writeInt32BE(fields.length + 4, 1);

    return Buffer.concat([header, fields]);

}

describe('cli: HomeScreen connection state', () => {

    let server: Server | null = null;

    function renderHome() {

        const screen = render(
            <FocusProvider>
                <RouterProvider>
                    <ShutdownProvider projectRoot={tmpdir()}>
                        <AppContextProvider projectRoot={tmpdir()}>
                            <ConnectionProvider>
                                <HomeScreen params={{}} />
                            </ConnectionProvider>
                        </AppContextProvider>
                    </ShutdownProvider>
                </RouterProvider>
            </FocusProvider>,
        );

        return { ...screen, frame: () => stripVTControlCharacters(screen.lastFrame() ?? '') };

    }

    beforeEach(() => {

        actualCore.observer.clear();

    });

    afterEach(async () => {

        actualCore.observer.clear();
        await resetLifecycleManager();
        await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
        server = null;

    });

    it.each(['does not exist', 'unknown database'])(
        'should show the error state and the message for a caFile missing under a directory named "%s"',
        async (directory) => {

            const caFile = join(tmpdir(), 'noorm-home-absent', directory, 'ca.pem');

            activeConfig = makeConfig({ ssl: { caFile } });

            const { frame, unmount } = renderHome();

            await waitFor(() => frame().includes('Error'));

            expect(frame()).toContain('Error');
            expect(frame()).toContain('Connection failed: Cannot read ssl.caFile');
            expect(frame()).not.toContain('Not Created');
            unmount();

        },
    );

    it('should show the database-missing state for a missing-database server message', async () => {

        const listening = createServer((socket) => socket.once('data', () => socket.end(missingDatabaseResponse())));

        server = listening;
        await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));

        const address = listening.address();

        if (address === null || typeof address === 'string') throw new Error('the test server has no port');

        activeConfig = makeConfig({ port: address.port });

        const { frame, unmount } = renderHome();

        await waitFor(() => frame().includes('Not Created'));

        expect(frame()).toContain('Not Created');
        expect(frame()).toContain('Database does not exist');
        unmount();

    });

});
