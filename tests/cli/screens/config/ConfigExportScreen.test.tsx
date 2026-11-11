/** ConfigExportScreen tests: each drives the screen to the written file and decrypts it with the recipient's key. */
import { describe, it, expect, vi, mock, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider } from '../../../../src/tui/app-context.js';
import { ToastProvider } from '../../../../src/tui/components/index.js';
import { ConfigExportScreen } from '../../../../src/tui/screens/config/ConfigExportScreen.js';
import { decryptWithPrivateKey, generateKeyPair } from '../../../../src/core/identity/crypto.js';
import type { Config } from '../../../../src/core/config/types.js';
import type { ConnectionConfig } from '../../../../src/core/connection/types.js';
import type { CryptoIdentity, KnownUser } from '../../../../src/core/identity/types.js';
import type { StageDefaults } from '../../../../src/core/settings/types.js';

const actualCore = await import('../../../../src/core/index.js');
const actualIdentity = await import('../../../../src/core/identity/index.js');

const recipientKeys = generateKeyPair();

const recipient: KnownUser = {
    identityHash: 'recipient-hash',
    email: 'bob@example.com',
    name: 'Bob',
    publicKey: recipientKeys.publicKey,
    machine: 'bob-laptop',
    os: 'linux 6.8',
    lastSeen: '2026-01-01T00:00:00.000Z',
    source: 'dev',
};

const sender: CryptoIdentity = {
    identityHash: 'sender-hash',
    name: 'Ada',
    email: 'ada@example.com',
    publicKey: generateKeyPair().publicKey,
    machine: 'ada-laptop',
    os: 'darwin 24.5.0',
    createdAt: '2026-01-01T00:00:00.000Z',
};

const server: ConnectionConfig = {
    dialect: 'postgres',
    host: 'db.internal',
    port: 6543,
    database: 'app',
    user: 'admin',
    password: 'hunter2',
};

const inlineForm: ConnectionConfig = {
    ...server,
    tlsServerName: 'db.corp',
    pool: { min: 1, max: 20 },
    connectTimeoutMs: 5000,
    statementTimeoutMs: 30_000,
    queryTimeoutMs: 60_000,
    applicationName: 'billing',
    keepAlive: true,
    keepAliveInitialDelayMs: 1000,
    ssl: { ca: 'PEM-CA', cert: 'PEM-CERT', key: 'PEM-KEY', rejectUnauthorized: false },
};

const fileForm: ConnectionConfig = {
    ...server,
    filename: './data/app.db',
    ssl: { caFile: './certs/ca.pem', certFile: '~/client.pem', keyFile: '/etc/client.key' },
};

function makeConfig(connection: ConnectionConfig): Config {

    return { name: 'dev', type: 'local', isTest: false, access: { user: 'admin', agent: 'viewer' }, connection };

}

let storedConfig = makeConfig(server);
let stages: Record<string, { defaults?: StageDefaults }> = {};

const stateManager = {
    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfig: vi.fn().mockReturnValue(null),
    getActiveConfigName: vi.fn().mockReturnValue(null),
    listConfigs: vi.fn().mockReturnValue([]),
    getConfig: vi.fn((name: string) => (name === storedConfig.name ? storedConfig : null)),
    getAllSecrets: vi.fn().mockReturnValue({ API_KEY: 'secret-value' }),
    findKnownUsersByEmail: vi.fn((email: string) => (email === recipient.email ? [recipient] : [])),
    hasPrivateKey: vi.fn().mockReturnValue(true),
    isLoaded: true,
};

const settingsManager = {
    load: vi.fn().mockResolvedValue({ version: '0.1.0' }),
    isLoaded: true,
    settings: { version: '0.1.0' },
    getStages: vi.fn(() => stages),
    getStage: vi.fn((name: string) => stages[name]),
};

mock.module('../../../../src/core/index.js', () => ({
    ...actualCore,
    getStateManager: () => stateManager,
    getSettingsManager: () => settingsManager,
}));

mock.module('../../../../src/core/identity/index.js', () => ({
    ...actualIdentity,
    loadExistingIdentity: async () => sender,
}));

async function waitFor(predicate: () => boolean, timeoutMs = 4000) {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((r) => setTimeout(r, 10));

    }

}

interface ExportedConnection extends Omit<ConnectionConfig, 'ssl'> {
    ssl?: boolean | Record<string, unknown>;
}

function isExport(value: unknown): value is { config: { connection: ExportedConnection }; secrets: Record<string, string> } {

    return typeof value === 'object' && value !== null && 'config' in value
        && typeof value.config === 'object' && value.config !== null && 'connection' in value.config;

}

const originalCwd = process.cwd();
let workDir = '';

/** Drive the screen to the written file and return what the recipient decrypts. */
async function exportedConnection(connection: ConnectionConfig): Promise<ExportedConnection> {

    storedConfig = makeConfig(connection);

    const file = join(workDir, 'dev.noorm.enc');
    const screen = render(
        <FocusProvider>
            <RouterProvider>
                <AppContextProvider autoLoad={true}>
                    <ToastProvider>
                        <ConfigExportScreen params={{ name: 'dev' }} />
                    </ToastProvider>
                </AppContextProvider>
            </RouterProvider>
        </FocusProvider>,
    );

    await waitFor(() => Boolean(screen.lastFrame()?.includes('Recipient email')));
    screen.stdin.write(recipient.email);
    await waitFor(() => Boolean(screen.lastFrame()?.includes(recipient.email)));
    screen.stdin.write('\r');
    await waitFor(() => existsSync(file) && Boolean(screen.lastFrame()?.includes('exported successfully')));

    screen.unmount();

    const exported: unknown = JSON.parse(decryptWithPrivateKey(JSON.parse(readFileSync(file, 'utf8')), recipientKeys.privateKey));

    rmSync(file);

    if (!isExport(exported)) throw new Error('The export file holds no config');

    return exported.config.connection;

}

describe('cli: ConfigExportScreen exported connection', () => {

    beforeEach(() => {

        vi.clearAllMocks();
        actualCore.observer.clear();
        stages = {};
        workDir = mkdtempSync(join(tmpdir(), 'noorm-export-'));
        process.chdir(workDir);

    });

    afterEach(() => {

        actualCore.observer.clear();
        process.chdir(originalCwd);
        rmSync(workDir, { recursive: true, force: true });

    });

    it('should carry every non-credential connection field across the inline and the file form', async () => {

        const inline = await exportedConnection(inlineForm);
        const files = await exportedConnection(fileForm);

        const { user: _user, password: _password, ssl: _ssl, ...shared } = inlineForm;

        expect(inline).toEqual({ ...shared, ssl: { ca: 'PEM-CA', rejectUnauthorized: false } });
        expect(files).toEqual({
            dialect: 'postgres',
            host: 'db.internal',
            port: 6543,
            database: 'app',
            filename: './data/app.db',
            ssl: { caFile: './certs/ca.pem', certFile: '~/client.pem', keyFile: '/etc/client.key' },
        });

    }, 20_000);

    it('should withhold user, password, ssl.key and ssl.cert from both payloads', async () => {

        for (const connection of [inlineForm, fileForm]) {

            const exported = await exportedConnection(connection);
            const text = JSON.stringify(exported);

            expect('user' in exported).toBe(false);
            expect('password' in exported).toBe(false);
            expect(exported.ssl).not.toHaveProperty('key');
            expect(exported.ssl).not.toHaveProperty('cert');
            expect(text).not.toContain('hunter2');
            expect(text).not.toContain('PEM-KEY');
            expect(text).not.toContain('PEM-CERT');

        }

    }, 20_000);

    it('should export an ssl that held only a key and a certificate as true', async () => {

        const exported = await exportedConnection({ ...server, ssl: { key: 'PEM-KEY', cert: 'PEM-CERT' } });

        expect(exported.ssl).toBe(true);

    }, 20_000);

    it('should leave out a stage value the stored config lacks', async () => {

        stages = { dev: { defaults: { ssl: { caFile: './certs/stage-ca.pem' }, user: 'stage-user' } } };

        const exported = await exportedConnection(server);

        expect(exported).toEqual({ dialect: 'postgres', host: 'db.internal', port: 6543, database: 'app' });

    }, 20_000);

});
