/** ConfigImportScreen tests: each encrypts a payload for a throwaway key, opens it and reads the config handed to `setConfig`. */
import { describe, it, expect, vi, mock, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider } from '../../../../src/tui/app-context.js';
import { ToastProvider } from '../../../../src/tui/components/index.js';
import { ConfigImportScreen } from '../../../../src/tui/screens/config/ConfigImportScreen.js';
import { encryptForRecipient, generateKeyPair } from '../../../../src/core/identity/crypto.js';
import type { Config } from '../../../../src/core/config/types.js';

const actualCore = await import('../../../../src/core/index.js');
const actualIdentity = await import('../../../../src/core/identity/index.js');
const actualStorage = await import('../../../../src/core/identity/storage.js');

const keys = generateKeyPair();

const stateManager = {
    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfig: vi.fn().mockReturnValue(null),
    getActiveConfigName: vi.fn().mockReturnValue(null),
    listConfigs: vi.fn().mockReturnValue([]),
    getConfig: vi.fn().mockReturnValue(null),
    setConfig: vi.fn().mockResolvedValue(undefined),
    setSecret: vi.fn().mockResolvedValue(undefined),
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
    getStateManager: () => stateManager,
    getSettingsManager: () => settingsManager,
}));

mock.module('../../../../src/core/identity/index.js', () => ({
    ...actualIdentity,
    loadExistingIdentity: async () => null,
}));

mock.module('../../../../src/core/identity/storage.js', () => ({
    ...actualStorage,
    loadPrivateKey: async () => keys.privateKey,
}));

const DOWN = '\x1B[B';
const UP = '\x1B[A';
const ENTER = '\r';

async function waitFor(predicate: () => boolean, timeoutMs = 4000) {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((r) => setTimeout(r, 10));

    }

}

type Screen = { stdin: { write: (data: string) => void }; lastFrame: () => string | undefined };

const frameOf = (screen: Screen) => stripVTControlCharacters(screen.lastFrame() ?? '');

/** Press `key` until a row of the frame holds every one of `marks`. */
async function moveTo(screen: Screen, key: string, ...marks: string[]) {

    const arrived = () => frameOf(screen).split('\n').some((row) => marks.every((mark) => row.includes(mark)));
    const deadline = Date.now() + 4000;

    while (!arrived() && Date.now() < deadline) {

        screen.stdin.write(key);

        await new Promise((r) => setTimeout(r, 30));

    }

}

async function typeInto(screen: Screen, label: string, text: string) {

    await moveTo(screen, DOWN, '›', label);

    screen.stdin.write(ENTER);
    await waitFor(() => frameOf(screen).includes('↵ commit'));
    // A password renders masked, so the typed text cannot be the signal.
    const empty = frameOf(screen);

    screen.stdin.write(text);
    await waitFor(() => frameOf(screen) !== empty);
    screen.stdin.write(ENTER);
    await waitFor(() => !frameOf(screen).includes('↵ commit'));

}

let workDir = '';

/** Write `connection` as an export file and open it at the preview. `configFields` and `rest` replace what an export writes beside it. */
async function openImport(
    connection: Record<string, unknown>,
    configFields: Record<string, unknown> = {},
    rest: Record<string, unknown> = { secrets: {} },
) {

    const file = join(workDir, 'dev.noorm.enc');
    const config = { name: 'dev', type: 'local', isTest: false, access: { user: 'admin', agent: 'viewer' }, connection, ...configFields };
    const payload = { config, ...rest };

    writeFileSync(file, JSON.stringify(encryptForRecipient(JSON.stringify(payload), keys.publicKey, 'ada@example.com', 'bob@example.com')));

    const screen = render(
        <FocusProvider>
            <RouterProvider>
                <AppContextProvider autoLoad={true}>
                    <ToastProvider>
                        <ConfigImportScreen params={{ path: file }} />
                    </ToastProvider>
                </AppContextProvider>
            </RouterProvider>
        </FocusProvider>,
    );

    await waitFor(() => frameOf(screen).includes('Database User'));

    return screen;

}

function isConfig(value: unknown): value is Config {

    return typeof value === 'object' && value !== null && 'connection' in value
        && typeof value.connection === 'object' && value.connection !== null;

}

/** Import `connection` with the given credentials and return the saved config's connection. */
async function importedConnection(connection: Record<string, unknown>): Promise<Config['connection']> {

    const screen = await openImport(connection);

    await typeInto(screen, 'Database User', 'form-user');
    await typeInto(screen, 'Database Password', 'form-pw');
    await moveTo(screen, UP, '❯ [ Import ]');
    screen.stdin.write(ENTER);
    await waitFor(() => stateManager.setConfig.mock.calls.length > 0 || frameOf(screen).includes('Press any key'));

    const saved: unknown = stateManager.setConfig.mock.calls[0]?.[1];

    screen.unmount();

    if (!isConfig(saved)) throw new Error(`Nothing was saved: ${frameOf(screen)}`);

    return saved.connection;

}

const server = { dialect: 'postgres', host: 'db.internal', port: 6543, database: 'app' };

describe('cli: ConfigImportScreen imported connection', () => {

    beforeEach(() => {

        vi.clearAllMocks();
        actualCore.observer.clear();
        workDir = mkdtempSync(join(tmpdir(), 'noorm-import-'));

    });

    afterEach(() => {

        actualCore.observer.clear();
        rmSync(workDir, { recursive: true, force: true });

    });

    it('should save every connection field the file carries', async () => {

        const carried = {
            ...server,
            tlsServerName: 'db.corp',
            pool: { min: 1, max: 20 },
            connectTimeoutMs: 5000,
            statementTimeoutMs: 30_000,
            queryTimeoutMs: 60_000,
            applicationName: 'billing',
            keepAlive: true,
            keepAliveInitialDelayMs: 1000,
            ssl: { caFile: './certs/ca.pem', certFile: '~/client.pem', keyFile: '/etc/client.key', rejectUnauthorized: false },
        };

        const saved = await importedConnection(carried);

        expect(saved).toEqual({ ...carried, user: 'form-user', password: 'form-pw' });

    }, 20_000);

    it('should take user and password from the form, not the file', async () => {

        const saved = await importedConnection({ ...server, user: 'file-user', password: 'file-pw' });

        expect(saved.user).toBe('form-user');
        expect(saved.password).toBe('form-pw');

    }, 20_000);

    it('should not save a connection key the schema does not know', async () => {

        const saved = await importedConnection({ ...server, futureOption: 'from-a-newer-noorm' });

        expect(saved).toEqual({ ...server, user: 'form-user', password: 'form-pw' });

    }, 20_000);

    it('should import a file that holds dialect, host, port, database and ssl only', async () => {

        const saved = await importedConnection({ ...server, ssl: true });

        expect(saved).toEqual({ ...server, ssl: true, user: 'form-user', password: 'form-pw' });

    }, 20_000);

    it('should preview the incoming TLS settings and say that a path must exist on this machine', async () => {

        const screen = await openImport({
            ...server,
            tlsServerName: 'db.corp',
            ssl: { caFile: './certs/ca.pem', certFile: '~/client.pem', keyFile: '/etc/client.key', rejectUnauthorized: false },
        });
        const frame = frameOf(screen).replace(/[│\s]+/g, ' ');

        expect(frame).toContain('SSL: on');
        expect(frame).toContain('Verify certificate: off');
        expect(frame).toContain('CA file: ./certs/ca.pem');
        expect(frame).toContain('Client cert file: ~/client.pem');
        expect(frame).toContain('Client key file: /etc/client.key');
        expect(frame).toContain('TLS server name: db.corp');
        expect(frame).toContain('must exist on this machine');

        screen.unmount();

    }, 20_000);

    it('should show the error and save nothing for a file with an invalid type', async () => {

        const screen = await openImport(server, { type: 'bogus' });

        await typeInto(screen, 'Database User', 'form-user');
        await moveTo(screen, UP, '❯ [ Import ]');
        screen.stdin.write(ENTER);
        await waitFor(() => stateManager.setConfig.mock.calls.length > 0 || frameOf(screen).includes('Press any key'));

        expect(frameOf(screen).replace(/[│\s]+/g, ' ')).toContain('Invalid option: expected one of "local"|"remote"');
        expect(stateManager.setConfig).not.toHaveBeenCalled();

        screen.unmount();

    }, 20_000);

    it('should render the preview for a file whose ssl is null', async () => {

        const screen = await openImport({ ...server, ssl: null });

        expect(frameOf(screen).replace(/[│\s]+/g, ' ')).toContain('SSL: off');

        screen.unmount();

    }, 20_000);

    it('should render the preview for a file that holds no secrets key', async () => {

        const screen = await openImport(server, {}, {});

        expect(frameOf(screen).replace(/[│\s]+/g, ' ')).toContain('Secrets: 0 included');

        screen.unmount();

    }, 20_000);

    it('should preview SSL off and no path note for a file without ssl', async () => {

        const screen = await openImport(server);
        const frame = frameOf(screen).replace(/[│\s]+/g, ' ');

        expect(frame).toContain('SSL: off');
        expect(frame).not.toContain('must exist on this machine');

        screen.unmount();

    }, 20_000);

});
