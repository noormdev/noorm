// Connects through the real createConnection, with ssl.caFile naming an absent file.
import { describe, it, expect, vi, mock, beforeEach, afterEach } from 'bun:test';
import { stripVTControlCharacters } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider } from '../../../../src/tui/app-context.js';
import { ConnectionProvider } from '../../../../src/tui/providers/ConnectionProvider.js';
import { ToastProvider } from '../../../../src/tui/components/index.js';
import { DbListScreen } from '../../../../src/tui/screens/db/DbListScreen.js';
import type { Config } from '../../../../src/core/config/types.js';

const actualCore = await import('../../../../src/core/index.js');
const actualIdentity = await import('../../../../src/core/identity/index.js');

const caFile = join(tmpdir(), 'noorm-db-list-absent', 'does not exist', 'ca.pem');

const activeConfig: Config = {
    name: 'app',
    type: 'local',
    isTest: false,
    access: { user: 'admin', agent: 'admin' },
    connection: { dialect: 'postgres', host: '127.0.0.1', database: 'app', user: 'app', ssl: { caFile } },
};

const stateManager = {
    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfigName: vi.fn(() => activeConfig.name),
    getConfig: vi.fn(() => activeConfig),
    listConfigs: vi.fn(() => []),
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

mock.module('../../../../src/core/index.js', () => ({
    ...actualCore,
    getStateManager: vi.fn(() => stateManager),
    getSettingsManager: vi.fn(() => settingsManager),
}));

mock.module('../../../../src/core/identity/index.js', () => ({
    ...actualIdentity,
    loadExistingIdentity: vi.fn().mockResolvedValue(null),
}));

async function waitFor(predicate: () => boolean, timeoutMs = 4000) {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

describe('cli: DbListScreen connection badge', () => {

    beforeEach(() => {

        actualCore.observer.clear();

    });

    afterEach(() => {

        actualCore.observer.clear();

    });

    it('should show ERROR and the message for a caFile missing under a directory named "does not exist"', async () => {

        const { lastFrame, unmount } = render(
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider projectRoot={tmpdir()}>
                        <ConnectionProvider>
                            <ToastProvider>
                                <DbListScreen params={{}} />
                            </ToastProvider>
                        </ConnectionProvider>
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>,
        );
        const frame = () => stripVTControlCharacters(lastFrame() ?? '');

        await waitFor(() => /Cannot read ssl\.caFile|NOT CREATED/.test(frame()));

        expect(frame()).toContain('ERROR');
        expect(frame()).toContain('Connection failed: Cannot read ssl.caFile');
        expect(frame()).not.toContain('NOT CREATED');
        unmount();

    });

});
