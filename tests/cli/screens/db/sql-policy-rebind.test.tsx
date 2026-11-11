// A trusted isTest gives every role at least the admin cell, and the active config's isTest field can come from a stage.
import { describe, it, expect, vi, mock, beforeEach, afterEach } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider } from '../../../../src/tui/app-context.js';
import { ToastProvider, ToastRenderer } from '../../../../src/tui/components/index.js';
import { SqlTerminalScreen } from '../../../../src/tui/screens/db/SqlTerminalScreen.js';
import { parseSettings } from '../../../../src/core/settings/schema.js';

const actualCore = await import('../../../../src/core/index.js');
const actualIdentity = await import('../../../../src/core/identity/index.js');

const DDL = 'create table if not exists rebind_probe (id integer)';

const stateManager = {
    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfigName: vi.fn().mockReturnValue('ci'),
    listConfigs: vi.fn().mockReturnValue([]),
    getConfig: vi.fn(),
    hasPrivateKey: vi.fn().mockReturnValue(true),
    isLoaded: true,
};

const settingsManager = {
    load: vi.fn().mockResolvedValue({ version: '0.1.0' }),
    isLoaded: true,
    projectRoot: '',
    settings: parseSettings({}),
    getStages: vi.fn().mockReturnValue({}),
    getStage: vi.fn((name: string) => (name === 'ci' ? { defaults: { isTest: true } } : undefined)),
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

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

describe('cli: SQL terminal policy re-bind', () => {

    let tempDir: string;

    beforeEach(async () => {

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-sql-rebind-'));
        settingsManager.projectRoot = tempDir;

    });

    afterEach(async () => {

        await rm(tempDir, { recursive: true, force: true });

    });

    async function submitDdl(stored: Record<string, unknown>): Promise<string> {

        stateManager.getConfig.mockReturnValue(stored);

        const view = render(
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider projectRoot={tempDir} autoLoad={true}>
                        <ToastProvider>
                            <SqlTerminalScreen params={{ name: DDL }} />
                            <ToastRenderer />
                        </ToastProvider>
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>,
        );
        const frame = () => stripVTControlCharacters(view.lastFrame() ?? '').replace(/\s+/g, ' ');

        await waitFor(() => frame().includes('[h] History'));

        const deadline = Date.now() + 4000;

        while (!/not allowed|✓/.test(frame()) && Date.now() < deadline) {

            view.stdin.write('\r');

            await new Promise((resolve) => setTimeout(resolve, 25));

        }

        const last = frame();

        view.unmount();

        return last;

    }

    const stored = {
        name: 'ci',
        type: 'local',
        access: { user: 'viewer', agent: 'viewer' },
        connection: { dialect: 'sqlite', database: ':memory:' },
    };

    const denial = '"sql:ddl" is not allowed on config "ci" (role: viewer)';

    it('should keep a denied statement denied when only the stage sets isTest', async () => {

        const frame = await submitDdl(stored);

        expect(frame).toContain(denial);
        expect(frame).not.toContain('✓');

    }, 20_000);

    it('should keep the relaxation of a stored isTest across the re-bind', async () => {

        const frame = await submitDdl({ ...stored, isTest: true });

        expect(frame).not.toContain('not allowed');
        expect(frame).toContain('✓');

    }, 20_000);

});
