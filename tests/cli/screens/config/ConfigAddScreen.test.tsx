/**
 * ConfigAddScreen tests: saving without a connection test, and the identity
 * gate in front of the screens that write state.
 *
 * Rendered through `ScreenRenderer`, because the gate lives in the screen
 * registry and a test that mounted `ConfigAddScreen` directly would walk
 * around it.
 *
 * Identity and state are in-memory stand-ins. `~/.noorm` is resolved from
 * `homedir()` when the storage module loads, so nothing in this process can
 * point it elsewhere, and the real `StateManager` class is not reliably
 * available here: `mock.module` is process-global and never restores, and
 * other files in this group replace it. The stand-in keeps the one rule that
 * matters to these tests, which is that nothing saves without a private key.
 */
import { describe, it, expect, vi, mock, beforeEach, afterEach } from 'bun:test';
import { stripVTControlCharacters } from 'node:util';
import { render as renderInk } from 'ink-testing-library';
import { Box, Text } from 'ink';
import React from 'react';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider, useRouter } from '../../../../src/tui/router.js';
import { AppContextProvider } from '../../../../src/tui/app-context.js';
import { ToastProvider } from '../../../../src/tui/components/index.js';
import { ScreenRenderer } from '../../../../src/tui/screens.js';
import { IdentityInitScreen } from '../../../../src/tui/screens/identity/index.js';
import type { Config, ConfigSummary } from '../../../../src/core/config/types.js';
import type { CryptoIdentity, CryptoIdentityInput } from '../../../../src/core/identity/types.js';
import type { Route } from '../../../../src/tui/types.js';

const actualCore = await import('../../../../src/core/index.js');
const actualIdentity = await import('../../../../src/core/identity/index.js');
const actualConnectionFactory = await import('../../../../src/core/connection/factory.js');
const { explainConnectionError } = await import('../../../../src/core/connection/errors.js');

// Taken as values now: `mock.module` rewrites the live bindings on the
// namespaces above, so a mock that delegates through one calls itself.
const real = {
    createCryptoIdentity: actualIdentity.createCryptoIdentity,
    createIdentityForExistingKeys: actualIdentity.createIdentityForExistingKeys,
    ensureIdentity: actualIdentity.ensureIdentity,
    backupKeyPair: actualIdentity.backupKeyPair,
    loadExistingIdentity: actualIdentity.loadExistingIdentity,
    loadIdentityMetadata: actualIdentity.loadIdentityMetadata,
    loadPrivateKey: actualIdentity.loadPrivateKey,
    hasKeyFiles: actualIdentity.hasKeyFiles,
    hasPrivateKeyFile: actualIdentity.hasPrivateKeyFile,
    detectIdentityDefaults: actualIdentity.detectIdentityDefaults,
    testConnection: actualConnectionFactory.testConnection,
    getStateManager: actualCore.getStateManager,
    getSettingsManager: actualCore.getSettingsManager,
};

/** What `git config` is taken to have answered. */
const GIT_DEFAULTS = {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    machine: 'test-machine',
    os: 'darwin 24.5.0',
};

/**
 * Stands in for `~/.noorm`: `privateKey` is `identity.key`, `hasPublicKey` is
 * `identity.pub`, `identity` is `identity.json`, and `keyError` is what
 * loading the key throws. `active` is true only while a test here runs.
 */
const sandbox: {
    active: boolean;
    identity: CryptoIdentity | null;
    privateKey: string | null;
    hasPublicKey: boolean;
    keyError: Error | null;
} = {
    active: false,
    identity: null,
    privateKey: null,
    hasPublicKey: false,
    keyError: null,
};

/**
 * The real function outside a test here, the stand-in during one. All
 * arguments are forwarded: a dropped `saveKeys = false` writes to the real `~/.noorm`.
 */
function sandboxed<A extends unknown[], R>(realFn: (...args: A) => R, standIn: (...args: A) => R) {

    return (...args: A): R => (sandbox.active ? standIn(...args) : realFn(...args));

}

function identityFrom(input: CryptoIdentityInput): CryptoIdentity {

    return {
        identityHash: 'sandbox-hash',
        name: input.name,
        email: input.email,
        publicKey: 'sandbox-public-key',
        machine: input.machine ?? GIT_DEFAULTS.machine,
        os: GIT_DEFAULTS.os,
        createdAt: new Date().toISOString(),
    };

}

const createIdentityInSandbox = vi.fn(sandboxed(real.createCryptoIdentity, async (input) => {

    const identity = identityFrom(input);
    const keypair = { publicKey: identity.publicKey, privateKey: 'sandbox-private-key' };

    sandbox.identity = identity;
    sandbox.privateKey = keypair.privateKey;
    sandbox.hasPublicKey = true;

    return { identity, keypair };

}));

/** The contract of the real one: a key that exists is kept, and so is metadata. */
const ensureIdentityInSandbox = vi.fn(sandboxed(real.ensureIdentity, async (input) => {

    if (sandbox.keyError) throw sandbox.keyError;

    if (!sandbox.privateKey) {

        const { identity, keypair } = await createIdentityInSandbox(input);

        return { identity, privateKey: keypair.privateKey, createdKeys: true, createdMetadata: true };

    }

    const createdMetadata = sandbox.identity === null;

    sandbox.hasPublicKey = true;
    sandbox.identity ??= identityFrom(input);

    return { identity: sandbox.identity, privateKey: sandbox.privateKey, createdKeys: false, createdMetadata };

}));

const backupInSandbox = vi.fn(sandboxed(real.backupKeyPair, async () => ['sandbox/identity.key.bak']));

mock.module('../../../../src/core/identity/index.js', () => ({
    ...actualIdentity,
    loadExistingIdentity: sandboxed(real.loadExistingIdentity, async () => (sandbox.hasPublicKey ? sandbox.identity : null)),
    loadIdentityMetadata: sandboxed(real.loadIdentityMetadata, async () => sandbox.identity),
    loadPrivateKey: sandboxed(real.loadPrivateKey, async () => {

        if (sandbox.keyError) throw sandbox.keyError;

        return sandbox.privateKey;

    }),
    hasKeyFiles: sandboxed(real.hasKeyFiles, async () => sandbox.privateKey !== null && sandbox.hasPublicKey),
    hasPrivateKeyFile: sandboxed(real.hasPrivateKeyFile, async () => sandbox.privateKey !== null),
    detectIdentityDefaults: sandboxed(real.detectIdentityDefaults, () => GIT_DEFAULTS),
    createCryptoIdentity: createIdentityInSandbox,
    ensureIdentity: ensureIdentityInSandbox,
    backupKeyPair: backupInSandbox,
    createIdentityForExistingKeys: sandboxed(real.createIdentityForExistingKeys, async (input) => {

        sandbox.identity = identityFrom(input);

        return sandbox.identity;

    }),
}));

type TestConnection = typeof real.testConnection;

let testConnectionImpl: TestConnection = real.testConnection;

const testConnectionMock = vi.fn<TestConnection>((config, options) => testConnectionImpl(config, options));

mock.module('../../../../src/core/connection/factory.js', () => ({
    ...actualConnectionFactory,
    testConnection: testConnectionMock,
}));

/**
 * The part of `StateManager` these screens touch, with its save rule intact:
 * the key is read at load and on `reloadPrivateKey`, and nothing saves without it.
 */
function createStateManager() {

    const configs = new Map<string, Config>();
    let activeName: string | null = null;
    let privateKey: string | null = null;

    const requireKey = () => {

        if (!privateKey) throw new Error('Private key required to save state. Set up identity with: noorm init');

    };

    // The real one reads through `loadPrivateKey` and discards what it throws.
    const readableKey = () => (sandbox.keyError ? null : sandbox.privateKey);

    return {
        isLoaded: true,
        load: async () => {

            privateKey = readableKey();

        },
        reloadPrivateKey: async () => {

            privateKey = readableKey() ?? privateKey;

            return privateKey !== null;

        },
        hasPrivateKey: () => privateKey !== null,
        getConfig: (name: string) => configs.get(name) ?? null,
        getActiveConfig: () => (activeName ? configs.get(activeName) ?? null : null),
        getActiveConfigName: () => activeName,
        getConfigAccessError: () => null,
        listConfigs: (): ConfigSummary[] =>
            [...configs.values()].map((config) => ({
                name: config.name,
                type: config.type,
                isTest: config.isTest,
                access: config.access,
                isActive: config.name === activeName,
                dialect: config.connection.dialect,
                database: config.connection.database,
            })),
        setConfig: async (name: string, config: Config) => {

            requireKey();
            configs.set(name, config);

        },
        setActiveConfig: async (name: string) => {

            requireKey();
            activeName = name;

        },
    };

}

let stateManager = createStateManager();

const settingsManager = {
    load: vi.fn().mockResolvedValue({ version: '0.1.0' }),
    isLoaded: true,
    settings: { version: '0.1.0' },
    getStages: vi.fn().mockReturnValue({}),
    getStage: vi.fn().mockReturnValue(undefined),
};

mock.module('../../../../src/core/index.js', () => ({
    ...actualCore,
    getStateManager: (root?: string) => (sandbox.active ? stateManager : real.getStateManager(root)),
    getSettingsManager: (root?: string) => (sandbox.active ? settingsManager : real.getSettingsManager(root)),
}));

const CTRL_S = '\x13';
const ENTER = '\r';
const ESC = '\x1B';
const DOWN = '\x1B[B';
const UP = '\x1B[A';

/** Poll until `predicate` holds; a fixed sleep expires under load and reads as a regression. */
async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((r) => setTimeout(r, 10));

    }

}

// CI runs with FORCE_COLOR, which puts color codes inside the frames these tests read as text.
function render(tree: React.ReactElement) {

    const screen = renderInk(tree);

    return {
        ...screen,
        lastFrame: () => {

            const frame = screen.lastFrame();

            return frame === undefined ? undefined : stripVTControlCharacters(frame);

        },
        get frames() {

            return screen.frames.map((frame) => stripVTControlCharacters(frame));

        },
    };

}

/** The frame as one line without the panel border, so a wrapped message still matches. */
function flat(frame: string | undefined): string {

    return (frame ?? '').replace(/[│\s]+/g, ' ');

}

type Screen = { stdin: { write: (data: string) => void }; lastFrame: () => string | undefined };

/** Whether the form's active-row marker sits on the row carrying `label`. */
function isOnRow(screen: Screen, label: string): boolean {

    return (screen.lastFrame() ?? '').split('\n').some((line) => line.includes('›') && line.includes(label));

}

/** Walk down to a field, open it, type, and commit. */
async function fillField(screen: Screen, label: string, text: string): Promise<void> {

    const deadline = Date.now() + 4000;

    while (!isOnRow(screen, label) && Date.now() < deadline) {

        screen.stdin.write(DOWN);

        await new Promise((r) => setTimeout(r, 30));

    }

    screen.stdin.write(ENTER);
    await waitFor(() => Boolean(screen.lastFrame()?.includes('↵ commit')));
    screen.stdin.write(text);
    await waitFor(() => Boolean(screen.lastFrame()?.includes(text)));
    screen.stdin.write(ENTER);
    await waitFor(() => !screen.lastFrame()?.includes('↵ commit'));

}

/** Walk up to a button on the action row and press it. */
async function pressButton(screen: Screen, label: string): Promise<void> {

    const focused = `❯ [ ${label} ]`;
    const deadline = Date.now() + 4000;

    await waitFor(() => Boolean(screen.lastFrame()?.includes(`[ ${label} ]`)));

    while (!screen.lastFrame()?.includes(focused) && Date.now() < deadline) {

        screen.stdin.write(UP);

        await new Promise((r) => setTimeout(r, 30));

    }

    screen.stdin.write(ENTER);

}

async function fillConfigForm(screen: Screen): Promise<void> {

    await waitFor(() => isOnRow(screen, 'Config Name*'));
    await fillField(screen, 'Config Name*', 'dev');
    await fillField(screen, 'Database*', 'app_dev');

}

let currentRoute: Route | null = null;

function RouteProbe(): null {

    currentRoute = useRouter().route;

    return null;

}

function renderRoute(route: Route, screen: React.ReactElement = <ScreenRenderer />) {

    return render(
        <FocusProvider>
            <RouterProvider initialRoute={route}>
                <AppContextProvider autoLoad={true}>
                    <ToastProvider>
                        <RouteProbe />
                        {screen}
                    </ToastProvider>
                </AppContextProvider>
            </RouterProvider>
        </FocusProvider>,
    );

}

/**
 * The frame `src/tui/app.tsx` puts around every screen, at 80x24. It leaves a
 * screen 20 rows, and one that needs more gets rows overdrawn or dropped.
 */
function Shell({ children }: { children: React.ReactNode }): React.ReactElement {

    const rule = { borderStyle: 'single', borderColor: 'gray', borderLeft: false, borderRight: false } as const;

    return (
        <Box flexDirection="column" width={80} height={24}>
            <Box {...rule} borderTop={false} paddingX={1}>
                <Text>Home › Configurations › Add Config</Text>
            </Box>
            <Box flexDirection="column" flexGrow={1}>
                {children}
            </Box>
            <Box {...rule} borderBottom={false}>
                <Text>status</Text>
            </Box>
        </Box>
    );

}

const renderInShell = (route: Route, screen: React.ReactElement = <ScreenRenderer />) =>
    renderRoute(route, <Shell>{screen}</Shell>);

/** The frame's rows, for assertions about what shares a row and what was dropped. */
const rowsOf = (screen: Screen): string[] => (screen.lastFrame() ?? '').split('\n');

const hasRow = (screen: Screen, text: string): boolean => rowsOf(screen).some((row) => row.includes(text));

beforeEach(() => {

    vi.clearAllMocks();
    actualCore.observer.clear();

    stateManager = createStateManager();
    currentRoute = null;

    sandbox.active = true;
    sandbox.identity = null;
    sandbox.privateKey = null;
    sandbox.hasPublicKey = false;
    sandbox.keyError = null;

    testConnectionImpl = async () => ({ ok: false, error: 'connect ECONNREFUSED' });

});

afterEach(() => {

    actualCore.observer.clear();

    sandbox.active = false;
    testConnectionImpl = real.testConnection;

});

/** Start a test as a user who already has an identity. */
async function giveIdentity(): Promise<void> {

    await createIdentityInSandbox({ name: GIT_DEFAULTS.name, email: GIT_DEFAULTS.email });
    createIdentityInSandbox.mockClear();

}

describe('cli: ConfigAddScreen save without verifying', () => {

    /**
     * A database that is only reachable through a tunnel fails the connection
     * test until the tunnel is up. The config is still worth saving.
     */

    it('should still block the normal save on a failed test, and name the way out', async () => {

        await giveIdentity();

        const screen = renderRoute('config/add');

        await fillConfigForm(screen);
        await pressButton(screen, 'Create Config');

        await waitFor(() => flat(screen.lastFrame()).includes('ECONNREFUSED'));

        expect(testConnectionMock).toHaveBeenCalledTimes(1);
        expect(flat(screen.lastFrame())).toContain('Ctrl+S to save without verifying');
        expect(stateManager.getConfig('dev')).toBeNull();

        screen.unmount();

    }, 20_000);

    it('should save on the bypass key without opening a connection', async () => {

        await giveIdentity();

        const screen = renderRoute('config/add');

        await fillConfigForm(screen);

        expect(screen.lastFrame()).toContain('ctrl+s save without verifying');

        screen.stdin.write(CTRL_S);

        await waitFor(() => Boolean(stateManager.getConfig('dev')));

        expect(testConnectionMock).not.toHaveBeenCalled();
        expect(stateManager.getConfig('dev')?.connection.database).toBe('app_dev');

        // The first config becomes the active one on either save path.
        expect(stateManager.getActiveConfigName()).toBe('dev');

        screen.unmount();

    }, 20_000);

    it('should hold the bypass key to the same field validation', async () => {

        await giveIdentity();

        const screen = renderRoute('config/add');

        await waitFor(() => isOnRow(screen, 'Config Name*'));
        await fillField(screen, 'Config Name*', 'dev');

        // Database is required and still empty.
        screen.stdin.write(CTRL_S);

        await waitFor(() => Boolean(screen.lastFrame()?.includes('Required')));

        expect(screen.lastFrame()).toContain('Required');
        expect(stateManager.getConfig('dev')).toBeNull();

        screen.unmount();

    }, 20_000);

    /**
     * Real connection errors end in a period and wrap to three or four rows.
     * `connect ECONNREFUSED` fixtures hid the `..` and the overdrawn rows.
     */
    describe('with the wording a real failure produces, at 80x24', () => {

        const connection = { dialect: 'postgres', host: '127.0.0.1', port: 5432, database: 'app_dev', user: 'app' } as const;

        const driverError = (message: string, code: string) => Object.assign(new Error(message), { code });

        const failures = {
            'connection refused': explainConnectionError(
                driverError('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED'),
                connection,
            ).message,
            'PostgreSQL authentication': explainConnectionError(
                driverError('password authentication failed for user "app"', '28P01'),
                connection,
            ).message,
        };

        for (const [name, message] of Object.entries(failures)) {

            it(`should keep every row intact under a ${name} error`, async () => {

                await giveIdentity();
                testConnectionImpl = async () => ({ ok: false, error: message });

                const screen = renderInShell('config/add');

                await fillConfigForm(screen);
                await pressButton(screen, 'Create Config');
                // The form measures the error after drawing it, then makes
                // room: the settled frame is the one with the action row back.
                await waitFor(() => hasRow(screen, 'Press Ctrl+S') && hasRow(screen, '[ Create Config ]'));

                const text = flat(screen.lastFrame());

                // The whole message, then the hint as a sentence of its own.
                expect(message.endsWith('.')).toBe(true);
                expect(text).toContain(message);
                expect(text).not.toContain('..');
                expect(rowsOf(screen).map((row) => row.replace(/│/g, '').trim()))
                    .toContain('Press Ctrl+S to save without verifying.');

                expect(hasRow(screen, '[ Create Config ]')).toBe(true);
                expect(hasRow(screen, '[ Cancel ]')).toBe(true);
                expect(hasRow(screen, 'ctrl+s save without verifying')).toBe(true);

                // No row carries two things: a scroll indicator sits alone.
                for (const row of rowsOf(screen).filter((candidate) => /[↑↓] \d+ more/.test(candidate))) {

                    expect(row.replace(/│/g, '').trim()).toMatch(/^[↑↓] \d+ more$/);

                }

                expect(rowsOf(screen).some((row) => row.includes('›') || row.includes('❯'))).toBe(true);
                expect(rowsOf(screen).length).toBeLessThanOrEqual(24);
                expect(hasRow(screen, '╰')).toBe(true);

                screen.unmount();

            }, 20_000);

        }

    });

});

describe('cli: identity gate on state-writing screens', () => {

    /**
     * Saving state needs the private key. Without the gate the user fills in
     * the whole config form and is only told at save time, with an error that
     * sends them to a different command.
     */

    it('should open identity setup, prefilled from git, instead of the config form', async () => {

        const screen = renderRoute('config/add');

        await waitFor(() => Boolean(screen.lastFrame()?.includes('Welcome to noorm')));

        expect(screen.lastFrame()).toContain('Ada Lovelace');
        expect(screen.lastFrame()).toContain('ada@example.com');
        expect(screen.lastFrame()).not.toContain('Add Configuration');

        screen.unmount();

    }, 20_000);

    it('should continue to the config form after setup, with a key that can save', async () => {

        const screen = renderRoute('config/add');

        await waitFor(() => Boolean(screen.lastFrame()?.includes('Welcome to noorm')));
        await pressButton(screen, 'Continue');

        await waitFor(() => Boolean(screen.lastFrame()?.includes('Add Configuration')));

        // Still the route the user asked for: nothing to find their way back to.
        expect(currentRoute).toBe('config/add');
        expect(createIdentityInSandbox).toHaveBeenCalledTimes(1);
        expect(sandbox.identity?.email).toBe('ada@example.com');

        await fillConfigForm(screen);
        screen.stdin.write(CTRL_S);

        await waitFor(() => Boolean(stateManager.getConfig('dev')));

        expect(flat(screen.lastFrame())).not.toContain('Private key required');
        expect(stateManager.getConfig('dev')?.name).toBe('dev');

        screen.unmount();

    }, 30_000);

    it('should return to the previous screen on cancel, with no identity created', async () => {

        const screen = renderRoute('config/add');

        await waitFor(() => Boolean(screen.lastFrame()?.includes('Welcome to noorm')));
        await waitFor(() => isOnRow(screen, 'Name'));

        expect(screen.lastFrame()).toContain('Welcome to noorm');

        screen.stdin.write(ESC);

        await waitFor(() => currentRoute === 'config');

        expect(currentRoute).toBe('config');
        expect(createIdentityInSandbox).not.toHaveBeenCalled();
        expect(sandbox.identity).toBeNull();
        expect(sandbox.privateKey).toBeNull();
        expect(screen.lastFrame()).toContain('Configurations');
        expect(screen.lastFrame()).not.toContain('✘');

        screen.unmount();

    }, 20_000);

    it('should gate config import the same way', async () => {

        const screen = renderRoute('config/import');

        await waitFor(() => Boolean(screen.lastFrame()?.includes('Welcome to noorm')));

        expect(screen.lastFrame()).toContain('Welcome to noorm');
        expect(screen.lastFrame()).not.toContain('Import Configuration');

        screen.unmount();

    }, 20_000);

    it('should go straight to the config form when an identity exists', async () => {

        await giveIdentity();

        const screen = renderRoute('config/add');

        await waitFor(() => Boolean(screen.lastFrame()?.includes('Add Configuration')));

        expect(screen.lastFrame()).toContain('Add Configuration');
        expect(screen.lastFrame()).not.toContain('Welcome to noorm');

        screen.unmount();

    }, 20_000);

    it('should show every field and the action row on an 80x24 terminal', async () => {

        const screen = renderInShell('config/add');

        await waitFor(() => hasRow(screen, '[ Continue ]'));

        for (const text of ['Saving a config needs an identity', 'Name*', 'Email*', 'Machine*', '[ Continue ]', '[ Cancel ]', 'esc cancel']) {

            expect(hasRow(screen, text)).toBe(true);

        }

        expect(rowsOf(screen).length).toBeLessThanOrEqual(24);

        screen.unmount();

    }, 20_000);

    /**
     * Every `state.enc` on the machine is encrypted with `identity.key`, so
     * setup completes an existing key and never generates over it.
     */
    describe('with a private key already on disk', () => {

        it('should keep the key and only add metadata when both key files exist', async () => {

            sandbox.privateKey = 'restored-key';
            sandbox.hasPublicKey = true;

            const screen = renderRoute('config/add');

            await waitFor(() => Boolean(screen.lastFrame()?.includes('Welcome to noorm')));
            await pressButton(screen, 'Continue');
            await waitFor(() => Boolean(screen.lastFrame()?.includes('Add Configuration')));

            expect(createIdentityInSandbox).not.toHaveBeenCalled();
            expect(sandbox.privateKey).toBe('restored-key');
            expect(sandbox.identity?.email).toBe('ada@example.com');
            expect(stateManager.hasPrivateKey()).toBe(true);

            screen.unmount();

        }, 20_000);

        it('should keep a key restored without its public key file', async () => {

            sandbox.privateKey = 'restored-key';

            const screen = renderRoute('config/add');

            await waitFor(() => Boolean(screen.lastFrame()?.includes('Welcome to noorm')));
            await pressButton(screen, 'Continue');
            await waitFor(() => Boolean(screen.lastFrame()?.includes('Add Configuration')));

            expect(createIdentityInSandbox).not.toHaveBeenCalled();
            expect(sandbox.privateKey).toBe('restored-key');
            expect(sandbox.hasPublicKey).toBe(true);
            expect(sandbox.identity?.name).toBe('Ada Lovelace');

            screen.unmount();

        }, 20_000);

        it('should not ask for a name and email it would not use', async () => {

            // Metadata is already there; only the public key file is missing.
            const metadata = { ...identityFrom(GIT_DEFAULTS), name: 'Original Person' };

            sandbox.privateKey = 'restored-key';
            sandbox.identity = metadata;

            const screen = renderRoute('config/add');

            // The config form also renders while the app context loads, so
            // its title alone does not mean setup has finished.
            await waitFor(() => sandbox.hasPublicKey);
            await waitFor(() => Boolean(screen.lastFrame()?.includes('Add Configuration')));

            expect(screen.lastFrame()).toContain('Add Configuration');
            expect(screen.frames.join('')).not.toContain('Welcome to noorm');
            expect(createIdentityInSandbox).not.toHaveBeenCalled();
            expect(sandbox.identity).toBe(metadata);
            expect(sandbox.privateKey).toBe('restored-key');
            expect(sandbox.hasPublicKey).toBe(true);

            screen.unmount();

        }, 20_000);

        it('should show why the key cannot be loaded instead of offering to set one up', async () => {

            // The user has an identity; the state manager dropped the key
            // because its file is group-readable, and discarded the reason.
            const metadata = identityFrom(GIT_DEFAULTS);

            sandbox.privateKey = 'restored-key';
            sandbox.hasPublicKey = true;
            sandbox.identity = metadata;
            sandbox.keyError = new Error(
                'Insecure permissions on private key file (/home/ada/.noorm/identity.key). '
                + 'Fix with: chmod 600 /home/ada/.noorm/identity.key',
            );

            const screen = renderRoute('config/add');

            await waitFor(() => flat(screen.lastFrame()).includes('chmod 600'));

            expect(flat(screen.lastFrame())).toContain('Insecure permissions on private key file');
            expect(flat(screen.lastFrame())).toContain('chmod 600 /home/ada/.noorm/identity.key');
            expect(screen.frames.join('')).not.toContain('Welcome to noorm');
            expect(screen.lastFrame()).not.toContain('Add Configuration');

            // Retried: the frame is drawn one effect before the panel has focus.
            const deadline = Date.now() + 4000;

            while (currentRoute !== 'config' && Date.now() < deadline) {

                screen.stdin.write(ESC);

                await new Promise((r) => setTimeout(r, 30));

            }

            expect(currentRoute).toBe('config');
            expect(ensureIdentityInSandbox).not.toHaveBeenCalled();
            expect(createIdentityInSandbox).not.toHaveBeenCalled();
            expect(sandbox.identity).toBe(metadata);

            screen.unmount();

        }, 20_000);

    });

});

describe('cli: IdentityInitScreen first identity', () => {

    // Mounted directly: another file in this group registers a stub on the
    // `identity/init` route, and the registry is process-wide.

    it('should prefill name and email from git', async () => {

        const screen = renderRoute('identity/init', <IdentityInitScreen params={{}} />);

        await waitFor(() => Boolean(screen.lastFrame()?.includes('Ada Lovelace')));

        expect(screen.lastFrame()).toContain('Ada Lovelace');
        expect(screen.lastFrame()).toContain('ada@example.com');

        screen.unmount();

    }, 20_000);

    it('should leave the running app able to save state', async () => {

        // The state manager was built before the key existed; without the new
        // key the next save fails as if there were still no identity.
        const screen = renderRoute('identity/init', <IdentityInitScreen params={{}} />);

        await waitFor(() => Boolean(screen.lastFrame()?.includes('Ada Lovelace')));
        await pressButton(screen, 'Continue');

        await waitFor(() => Boolean(stateManager.hasPrivateKey()));

        expect(createIdentityInSandbox).toHaveBeenCalledTimes(1);
        expect(stateManager.hasPrivateKey()).toBe(true);
        expect(backupInSandbox).not.toHaveBeenCalled();

        screen.unmount();

    }, 20_000);

    it('should show every field and the action row on an 80x24 terminal', async () => {

        const screen = renderInShell('identity/init', <IdentityInitScreen params={{}} />);

        await waitFor(() => hasRow(screen, '[ Continue ]'));

        for (const text of ['Name*', 'Email*', 'Machine*', '[ Continue ]', '[ Cancel ]', 'esc cancel']) {

            expect(hasRow(screen, text)).toBe(true);

        }

        expect(rowsOf(screen).length).toBeLessThanOrEqual(24);

        screen.unmount();

    }, 20_000);

    it('should keep a private key that has no public key file', async () => {

        // No identity is reported without `identity.pub`, so this screen opens
        // on the form rather than the regeneration warning.
        sandbox.privateKey = 'restored-key';

        const screen = renderRoute('identity/init', <IdentityInitScreen params={{}} />);

        await waitFor(() => Boolean(screen.lastFrame()?.includes('Ada Lovelace')));
        await pressButton(screen, 'Continue');
        await waitFor(() => sandbox.identity !== null);

        expect(createIdentityInSandbox).not.toHaveBeenCalled();
        expect(sandbox.privateKey).toBe('restored-key');

        screen.unmount();

    }, 20_000);

    it('should replace the keypair when an existing identity is regenerated', async () => {

        await giveIdentity();

        const screen = renderRoute('identity/init', <IdentityInitScreen params={{}} />);

        // Mounted before the app context has loaded, the screen skips its
        // warning step and opens on the form.
        await pressButton(screen, 'Regenerate');
        await waitFor(() => createIdentityInSandbox.mock.calls.length > 0);

        expect(createIdentityInSandbox).toHaveBeenCalledTimes(1);
        expect(ensureIdentityInSandbox).not.toHaveBeenCalled();
        expect(backupInSandbox.mock.invocationCallOrder[0]).toBeLessThan(createIdentityInSandbox.mock.invocationCallOrder[0]!);

        screen.unmount();

    }, 20_000);

});
