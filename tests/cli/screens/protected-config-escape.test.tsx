import { describe, it, expect, vi, mock, beforeEach, afterEach, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../src/tui/focus.js';
import { RouterProvider } from '../../../src/tui/router.js';
import { AppContextProvider } from '../../../src/tui/app-context.js';
import { ToastProvider, ToastRenderer } from '../../../src/tui/components/index.js';
import { ConfigCopyScreen } from '../../../src/tui/screens/config/ConfigCopyScreen.js';
import { ConfigAddScreen } from '../../../src/tui/screens/config/ConfigAddScreen.js';
import { ConfigEditScreen } from '../../../src/tui/screens/config/ConfigEditScreen.js';
import { SettingsAccessListScreen } from '../../../src/tui/screens/settings/SettingsAccessListScreen.js';
import { SettingsAccessEditScreen } from '../../../src/tui/screens/settings/SettingsAccessEditScreen.js';
import { MATRIX } from '../../../src/core/policy/index.js';
import { StateManager } from '../../../src/core/state/manager.js';
import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { encrypt, decrypt } from '../../../src/core/state/encryption/index.js';
import type { EncryptedPayload } from '../../../src/core/state/types.js';
import type { Config } from '../../../src/core/config/types.js';

const actualCore = await import('../../../src/core/index.js');
const actualIdentity = await import('../../../src/core/identity/index.js');
const actualConnectionFactory = await import('../../../src/core/connection/factory.js');

function makeConfig(name: string): Config {

    return {
        name,
        type: 'local',
        isTest: false,
        access: { user: 'admin', agent: 'admin' },
        connection: { dialect: 'postgres', host: 'localhost', port: 5432, database: `${name}_db`, user: 'u', password: 'p' },
    };

}

const stages: Record<string, { defaults: { protected?: boolean } }> = {
    prod: { defaults: { protected: true } },
    staging: { defaults: { protected: true } },
    dev: { defaults: {} },
};

const lockedRole = {
    permissions: Object.fromEntries(Object.keys(MATRIX).map((permission) => [permission, 'deny' as const])),
};

const mockSettingsManager = {
    load: vi.fn().mockResolvedValue({ version: '0.1.0' }),
    isLoaded: true,
    settings: { version: '0.1.0', access: { roles: { locked: lockedRole } } },
    getAccessRoles: vi.fn(() => ({ locked: lockedRole })),
    setAccessRole: vi.fn().mockResolvedValue(undefined),
    getStages: vi.fn().mockReturnValue(stages),
    getStage: vi.fn((name: string) => stages[name]),
};

let state: StateManager;
let privateKey: string;

mock.module('../../../src/core/index.js', () => ({
    observer: actualCore.observer,
    getStateManager: vi.fn(() => state),
    getSettingsManager: vi.fn(() => mockSettingsManager),
    resetStateManager: vi.fn(),
    resetSettingsManager: vi.fn(),
}));

mock.module('../../../src/core/identity/index.js', () => ({
    loadExistingIdentity: vi.fn().mockResolvedValue(null),
}));

mock.module('../../../src/core/connection/factory.js', () => ({
    ...actualConnectionFactory,
    testConnection: vi.fn(async () => ({ ok: true })),
}));

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((r) => setTimeout(r, 10));

    }

}

function TestWrapper({ children }: { children: React.ReactNode }) {

    return (
        <FocusProvider>
            <RouterProvider>
                <AppContextProvider autoLoad={true}>
                    <ToastProvider>{children}<ToastRenderer /></ToastProvider>
                </AppContextProvider>
            </RouterProvider>
        </FocusProvider>
    );

}

describe('cli: config screens protected-stage escape', () => {

    let dir: string;

    beforeEach(async () => {

        dir = mkdtempSync(join(process.cwd(), 'tmp', 'noorm-tui-escape-'));
        privateKey = (await generateKeyPair()).privateKey;
        state = new StateManager(dir, { privateKey });
        await state.load();
        await state.setConfig('prod', makeConfig('prod'));

    });

    afterEach(() => {

        actualCore.observer.clear();
        rmSync(dir, { recursive: true, force: true });

    });

    afterAll(() => {

        mock.module('../../../src/core/index.js', () => actualCore);
        mock.module('../../../src/core/identity/index.js', () => actualIdentity);
        mock.module('../../../src/core/connection/factory.js', () => actualConnectionFactory);

    });

    it('should refuse copying a protected-stage config to an unprotected name', async () => {

        const { stdin, lastFrame, unmount } = render(
            <TestWrapper>
                <ConfigCopyScreen params={{ name: 'prod' }} />
            </TestWrapper>,
        );

        await waitFor(() => Boolean(lastFrame()?.includes('Copy')));
        await new Promise((r) => setTimeout(r, 50));
        stdin.write('scratch');
        await waitFor(() => Boolean(lastFrame()?.includes('scratch')));
        stdin.write('\r');

        await waitFor(() => Boolean(lastFrame()?.includes('protected-stage')));

        expect(lastFrame()).toContain('protected-stage');
        expect(state.getConfig('scratch')).toBeNull();

        unmount();

    });

    it('should copy a protected-stage config to another protected stage name', async () => {

        const { stdin, lastFrame, unmount } = render(
            <TestWrapper>
                <ConfigCopyScreen params={{ name: 'prod' }} />
            </TestWrapper>,
        );

        await waitFor(() => Boolean(lastFrame()?.includes('Copy')));
        await new Promise((r) => setTimeout(r, 50));
        stdin.write('staging');
        await waitFor(() => Boolean(lastFrame()?.includes('staging')));
        stdin.write('\r');

        await waitFor(() => state.getConfig('staging') !== null);

        expect(state.getConfig('staging')?.name).toBe('staging');

        unmount();

    });

    it('should refuse renaming a protected-stage config to an unprotected name', async () => {

        const { stdin, lastFrame, unmount } = render(
            <TestWrapper>
                <ConfigEditScreen params={{ name: 'prod' }} />
            </TestWrapper>,
        );

        await waitFor(() => Boolean(lastFrame()?.includes('[ Save Changes ]')));
        await new Promise((r) => setTimeout(r, 50));

        stdin.write('\r');
        await new Promise((r) => setTimeout(r, 50));
        stdin.write('\x7F\x7F\x7F\x7F');
        await new Promise((r) => setTimeout(r, 50));
        stdin.write('dev');
        await new Promise((r) => setTimeout(r, 50));
        stdin.write('\r');
        await waitFor(() => Boolean(lastFrame()?.includes('dev')));

        const focused = '❯ [ Save Changes ]';
        const deadline = Date.now() + 3000;

        while (!lastFrame()?.includes(focused) && Date.now() < deadline) {

            stdin.write('\x1B[A');
            await new Promise((r) => setTimeout(r, 30));

        }

        stdin.write('\r');

        await waitFor(() => Boolean(lastFrame()?.includes('protected-stage')));

        expect(lastFrame()).toContain('protected-stage');
        expect(state.getConfig('prod')).not.toBeNull();
        expect(state.getConfig('dev')).toBeNull();

        unmount();

    }, 20_000);

    describe('config with malformed access', () => {

        async function seedMalformed(name: string): Promise<unknown> {

            await state.setConfig(name, makeConfig(name));

            const path = state.getStatePath();
            const stored = JSON.parse(decrypt(JSON.parse(readFileSync(path, 'utf8')) as EncryptedPayload, privateKey));
            stored.configs[name].access = { user: 'admin' };
            writeFileSync(path, JSON.stringify(encrypt(JSON.stringify(stored), privateKey)));
            state = new StateManager(dir, { privateKey });
            await state.load();

            return stored.configs[name];

        }

        it('should refuse copying onto its name and keep it unchanged', async () => {

            await state.setConfig('dev', makeConfig('dev'));
            const before = await seedMalformed('broken');

            const { stdin, lastFrame, unmount } = render(
                <TestWrapper>
                    <ConfigCopyScreen params={{ name: 'dev' }} />
                </TestWrapper>,
            );

            await waitFor(() => Boolean(lastFrame()?.includes('Copy')));
            await new Promise((r) => setTimeout(r, 50));
            stdin.write('broken');
            await waitFor(() => Boolean(lastFrame()?.includes('broken')));
            stdin.write('\r');

            await waitFor(() => Boolean(lastFrame()?.includes('Refusing to overwrite')));

            expect(lastFrame()).toContain('repair-access');
            expect(JSON.parse(decrypt(
                JSON.parse(readFileSync(state.getStatePath(), 'utf8')) as EncryptedPayload, privateKey,
            )).configs.broken).toEqual(before);

            unmount();

        });

        it('should refuse creating a config under its name and keep it unchanged', async () => {

            const before = await seedMalformed('broken');

            const { stdin, lastFrame, unmount } = render(
                <TestWrapper>
                    <ConfigAddScreen params={{}} />
                </TestWrapper>,
            );

            await waitFor(() => Boolean(lastFrame()?.includes('Create Config')));
            await new Promise((r) => setTimeout(r, 50));

            const type = async (text: string) => {

                stdin.write('\r');
                await new Promise((r) => setTimeout(r, 50));
                stdin.write(text);
                await new Promise((r) => setTimeout(r, 50));
                stdin.write('\r');
                await new Promise((r) => setTimeout(r, 50));

            };
            const next = async (count: number) => {

                for (let i = 0; i < count; i++) {

                    stdin.write('\x1B[B');
                    await new Promise((r) => setTimeout(r, 30));

                }

            };

            await type('broken');
            await next(4);
            await type('other_db');

            const focused = '❯ [ Create Config ]';
            const deadline = Date.now() + 3000;

            while (!lastFrame()?.includes(focused) && Date.now() < deadline) {

                stdin.write('\x1B[B');
                await new Promise((r) => setTimeout(r, 30));

            }

            stdin.write('\r');

            await waitFor(() => Boolean(lastFrame()?.includes('Refusing to overwrite')));

            expect(lastFrame()).toContain('repair-access');
            expect(JSON.parse(decrypt(
                JSON.parse(readFileSync(state.getStatePath(), 'utf8')) as EncryptedPayload, privateKey,
            )).configs.broken).toEqual(before);

            unmount();

        }, 20_000);

    });

    describe('user role that denies every permission', () => {

        beforeEach(async () => {

            await state.setConfig('dev', { ...makeConfig('dev'), access: { user: 'locked', agent: 'locked' } });
            await state.setActiveConfig('dev');

        });

        it('should still list and edit the role in Settings -> Access', async () => {

            const list = render(
                <TestWrapper>
                    <SettingsAccessListScreen params={{}} />
                </TestWrapper>,
            );

            await waitFor(() => Boolean(list.lastFrame()?.includes('locked')));
            expect(list.lastFrame()).toContain('locked');
            list.unmount();

            const edit = render(
                <TestWrapper>
                    <SettingsAccessEditScreen params={{ name: 'locked' }} />
                </TestWrapper>,
            );

            await waitFor(() => Boolean(edit.lastFrame()?.includes('Permissions: locked')));
            expect(edit.lastFrame()).toContain('The user channel always reads');
            await waitFor(() => {

                edit.stdin.write('s');

                return mockSettingsManager.setAccessRole.mock.calls.length > 0;

            });

            expect(mockSettingsManager.setAccessRole).toHaveBeenCalledWith('locked', expect.anything());

            edit.unmount();

        });

        it('should still change the config role assignment in config edit', async () => {

            const { stdin, lastFrame, unmount } = render(
                <TestWrapper>
                    <ConfigEditScreen params={{ name: 'dev' }} />
                </TestWrapper>,
            );

            await waitFor(() => Boolean(lastFrame()?.includes('[ Save Changes ]')));
            await new Promise((r) => setTimeout(r, 50));

            const pressUntil = async (key: string, reached: () => boolean) => {

                const deadline = Date.now() + 3000;

                while (!reached() && Date.now() < deadline) {

                    stdin.write(key);
                    await new Promise((r) => setTimeout(r, 30));

                }

            };

            await pressUntil('\x1B[B', () => Boolean(lastFrame()?.includes('› User Role')));
            stdin.write('\r');
            await new Promise((r) => setTimeout(r, 50));
            stdin.write('\x1B[A');
            await new Promise((r) => setTimeout(r, 50));
            stdin.write('\r');
            await waitFor(() => Boolean(lastFrame()?.includes('User Role      admin')));
            await pressUntil('\x1B[B', () => Boolean(lastFrame()?.includes('❯ [ Save Changes ]')));
            stdin.write('\r');

            await waitFor(() => state.getConfig('dev')?.access.user === 'admin');

            expect(state.getConfig('dev')?.access.user).toBe('admin');

            unmount();

        }, 20_000);

    });

});
