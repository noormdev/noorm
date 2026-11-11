/** ConfigExportScreen tests: each drives the screen to the written file and decrypts it with the recipient's key. */
import { describe, it, expect, vi, mock, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider, useFocusContext } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider } from '../../../../src/tui/app-context.js';
import { ToastProvider } from '../../../../src/tui/components/index.js';
import { ConfigExportScreen } from '../../../../src/tui/screens/config/ConfigExportScreen.js';
import { decryptWithPrivateKey, generateKeyPair } from '../../../../src/core/identity/crypto.js';
import { bindPolicyContext } from '../../../../src/core/config/resolver.js';
import { checkConfigPolicy } from '../../../../src/core/policy/index.js';
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

let storedConfig: Omit<Config, 'access'> & Partial<Pick<Config, 'access'>> = makeConfig(server);
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
    projectRoot: '/test-project',
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
let isTyping = () => false;

/** Publishes the focus context's `isTyping`, which turns true in the same commit that registers the email field's input handler. */
function TypingProbe(): null {

    isTyping = useFocusContext().isTyping;

    return null;

}

async function submitRecipient() {

    const screen = render(
        <FocusProvider>
            <TypingProbe />
            <RouterProvider>
                <AppContextProvider autoLoad={true}>
                    <ToastProvider>
                        <ConfigExportScreen params={{ name: 'dev' }} />
                    </ToastProvider>
                </AppContextProvider>
            </RouterProvider>
        </FocusProvider>,
    );

    // The field is drawn before focus reaches it, and it drops what is typed until then.
    await waitFor(() => isTyping());
    screen.stdin.write(recipient.email);
    await waitFor(() => Boolean(screen.lastFrame()?.includes(recipient.email)));
    screen.stdin.write('\r');

    return screen;

}

/** Drive the screen to the written file and return what the recipient decrypts. */
async function exportedConnection(connection: ConnectionConfig): Promise<ExportedConnection> {

    storedConfig = makeConfig(connection);

    const file = join(workDir, 'dev.noorm.enc');
    const screen = await submitRecipient();

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

    // Activation binds the effective config, so a stage role must gate the export the same way.
    it('should judge a stored config without roles by the roles of its stage', async () => {

        const { access: _access, ...withoutRoles } = makeConfig(server);
        const stageRoles: Config['access'] = { user: 'viewer', agent: false };

        stages = { dev: { defaults: { access: stageRoles } } };
        storedConfig = withoutRoles;

        const asViewer = bindPolicyContext({ ...withoutRoles, access: stageRoles }, { stageIsProtected: () => false });
        const reason = checkConfigPolicy('user', asViewer, 'secret:read').blockedReason;
        const screen = await submitRecipient();
        const frame = () => (screen.lastFrame() ?? '').replace(/[│\s]+/g, ' ');

        await waitFor(() => frame().includes('Press any key'));

        expect(reason).toBeDefined();
        expect(frame()).toContain(reason);
        expect(existsSync(join(workDir, 'dev.noorm.enc'))).toBe(false);

        screen.unmount();

    }, 20_000);

});
