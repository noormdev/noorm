/**
 * App Context tests.
 *
 * Tests the AppContextProvider, hooks, and guard components.
 */
import { describe, it, expect, vi, mock, beforeEach, afterEach, afterAll, type Mock } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';
import { Text } from 'ink';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    AppContextProvider,
    useAppContext,
    useLoadingStatus,
    useActiveConfig,
    useConnectionStatus,
    useLockStatus,
    useIdentity,
    useSettings,
    LoadingGuard,
    ConfigGuard,
    IdentityGuard,
} from '../../src/tui/app-context.js';
import { FocusProvider } from '../../src/tui/focus.js';
import { RouterProvider } from '../../src/tui/router.js';
import { resetLifecycleManager } from '../../src/core/lifecycle/manager.js';
import { ShutdownProvider } from '../../src/tui/shutdown.js';
import { ConnectionProvider } from '../../src/tui/providers/ConnectionProvider.js';
import { HomeScreen } from '../../src/tui/screens/home.js';
import { observer, getStateManager, type Config } from '../../src/core/index.js';
import { effectiveConfig, SettingsProvider } from '../../src/core/config/resolver.js';
import { getPolicyContext, getPolicyFingerprint } from '../../src/core/policy/index.js';
import { StateManager } from '../../src/core/state/index.js';
import { encrypt, decrypt } from '../../src/core/state/encryption/index.js';
import { generateKeyPair } from '../../src/core/identity/crypto.js';
import type { EncryptedPayload } from '../../src/core/state/types.js';

// Pre-import actual modules for restoration
const actualCore = await import('../../src/core/index.js');
const actualIdentity = await import('../../src/core/identity/index.js');

// Create mock managers for testing
const createMockStateManager = () => ({
    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfig: vi.fn().mockReturnValue(null),
    getActiveConfigName: vi.fn().mockReturnValue(null),
    listConfigs: vi.fn().mockReturnValue([]),
    getConfig: vi.fn().mockReturnValue(null),
    setActiveConfig: vi.fn().mockResolvedValue(undefined),
    hasPrivateKey: vi.fn().mockReturnValue(true),
    isLoaded: true,
});

// Spread the real module rather than listing replacements.
//
// `mock.module` swaps the whole module, so naming only the handful of exports
// this file uses deleted the other ~40 the barrel carries — and because the
// registry is process-global and never restores, it deleted them for every file
// loaded afterwards too.
//
// `getSettingsManager` is deliberately *not* mocked. `app.test.tsx` is the next
// file in the suite, and it writes a real `.noorm/settings.yml` to assert the
// mouse honours `ui.mouse: false`; a faked manager handed it a settings object
// with no `ui` section, which `isMouseEnabled` reads as on. That was two CI
// failures on Linux, where the leak reproduces and macOS does not. The real
// manager on a project with no settings file returns defaults, which is what
// the assertions below want anyway.
mock.module('../../src/core/index.js', () => ({
    ...actualCore,
    getStateManager: vi.fn(() => createMockStateManager()),
}));

// Mock identity loading to return null (no global identity)
mock.module('../../src/core/identity/index.js', () => ({
    ...actualIdentity,
    loadExistingIdentity: vi.fn().mockResolvedValue(null),
}));

/**
 * Test component that displays context state.
 */
function ContextDisplay() {

    const ctx = useAppContext();

    return (
        <Text>
            status:{ctx.loadingStatus}| configName:{ctx.activeConfigName ?? 'null'}| hasIdentity:
            {String(ctx.hasIdentity)}| connection:{ctx.connectionStatus}| lock:
            {ctx.lockStatus.status}
        </Text>
    );

}

/**
 * Test component for loading status hook.
 */
function LoadingStatusDisplay() {

    const { loadingStatus, error } = useLoadingStatus();

    return (
        <Text>
            loading:{loadingStatus}|error:{error?.message ?? 'null'}
        </Text>
    );

}

/**
 * Test component for active config hook.
 */
function ActiveConfigDisplay() {

    const { activeConfig, activeConfigName, configs } = useActiveConfig();

    return (
        <Text>
            name:{activeConfigName ?? 'null'}| hasConfig:{String(!!activeConfig)}| count:
            {configs.length}
        </Text>
    );

}

/**
 * Test component for connection status hook.
 */
function ConnectionStatusDisplay() {

    const { connectionStatus, connectedConfig } = useConnectionStatus();

    return (
        <Text>
            status:{connectionStatus}| config:{connectedConfig ?? 'null'}
        </Text>
    );

}

/**
 * Test component for lock status hook.
 */
function LockStatusDisplay() {

    const { lockStatus } = useLockStatus();

    return (
        <Text>
            status:{lockStatus.status}| holder:{lockStatus.holder ?? 'null'}
        </Text>
    );

}

/**
 * Test component for identity hook.
 */
function IdentityDisplay() {

    const { identity, hasIdentity } = useIdentity();

    return (
        <Text>
            hasIdentity:{String(hasIdentity)}| name:{identity?.name ?? 'null'}
        </Text>
    );

}

/**
 * Test component for settings hook.
 */
function SettingsDisplay() {

    const { settings, settingsManager } = useSettings();

    return (
        <Text>
            hasSettings:{String(!!settings)}| hasManager:{String(!!settingsManager)}
        </Text>
    );

}

async function waitFor(predicate: () => boolean, timeoutMs = 4000) {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

/** Real state on disk with `bad` stored as `{ user }` only (no `agent`), the shape the access parser rejects. */
async function seedMalformed(root: string, active: string | null, names = ['prod', 'dev'], bad = 'prod') {

    const { privateKey } = generateKeyPair();
    const seed = new StateManager(root, { privateKey });

    await seed.load();

    for (const name of names) {

        await seed.setConfig(name, {
            name,
            type: 'local',
            isTest: true,
            access: { user: 'admin', agent: 'admin' },
            connection: { dialect: 'sqlite', database: ':memory:' },
        });

    }

    if (active) await seed.setActiveConfig(active);

    const path = seed.getStatePath();
    const stored = JSON.parse(decrypt(JSON.parse(readFileSync(path, 'utf8')) as EncryptedPayload, privateKey));

    stored.configs[bad].access = { user: 'admin' };
    writeFileSync(path, JSON.stringify(encrypt(JSON.stringify(stored), privateKey)));

    return new StateManager(root, { privateKey });

}

function HomeInApp({ projectRoot }: { projectRoot: string }) {

    return (
        <FocusProvider>
            <RouterProvider>
                <ShutdownProvider projectRoot={projectRoot}>
                    <AppContextProvider projectRoot={projectRoot}>
                        <ConnectionProvider>
                            <HomeScreen params={{}} />
                            <ActiveConfigDisplay />
                        </ConnectionProvider>
                    </AppContextProvider>
                </ShutdownProvider>
            </RouterProvider>
        </FocusProvider>
    );

}

describe('cli: app-context', () => {

    beforeEach(() => {

        vi.clearAllMocks();
        observer.clear();

    });

    afterEach(async () => {

        observer.clear();
        await resetLifecycleManager();

    });

    // No restore here, deliberately. Re-registering the real module does not
    // undo `mock.module` — measured on Bun 1.3.11 and 1.4.0 alike, a re-register
    // still resolves to the mock. The block that used to sit here claimed to
    // prevent pollution and did nothing. What keeps this file honest is the
    // mocks above spreading the real module and faking as little as possible,
    // because whatever they fake is faked for the rest of the process.
    afterAll(() => {

        observer.clear();

    });

    describe('settings stage sync', () => {

        it('should leave a config with malformed access untouched when a stage has its name', async () => {

            const root = mkdtempSync(join(tmpdir(), 'noorm-stage-sync-'));

            try {

                mkdirSync(join(root, '.noorm'), { recursive: true });
                writeFileSync(
                    join(root, '.noorm', 'settings.yml'),
                    'stages:\n    staging:\n        defaults:\n            dialect: sqlite\n            database: stage.db\n',
                );

                const sm = await seedMalformed(root, null, ['staging'], 'staging');
                const before = readFileSync(sm.getStatePath(), 'utf8');

                (getStateManager as Mock<typeof getStateManager>).mockReturnValueOnce(sm);

                const { lastFrame, unmount } = render(
                    <AppContextProvider projectRoot={root}>
                        <LoadingStatusDisplay />
                    </AppContextProvider>,
                );

                await waitFor(() => Boolean(lastFrame()?.includes('loading:ready')));

                expect(lastFrame()).toContain('loading:ready');
                unmount();

                expect(readFileSync(sm.getStatePath(), 'utf8')).toBe(before);

            }
            finally {

                rmSync(root, { recursive: true, force: true });

            }

        });

    });

    describe('activeConfig is the effective config', () => {

        const connection: Config['connection'] = { dialect: 'postgres', database: 'app', host: 'db' };
        const access: Config['access'] = { user: 'viewer', agent: 'viewer' };
        const roots: string[] = [];

        let context: ReturnType<typeof useAppContext> | null = null;

        function ContextProbe(): null {

            context = useAppContext();

            return null;

        }

        function loaded() {

            if (!context?.activeConfig || !context.settingsManager) throw new Error('the app context has no active config');

            return { activeConfig: context.activeConfig, settingsManager: context.settingsManager };

        }

        function writeStage(root: string, defaults: string): void {

            mkdirSync(join(root, '.noorm'), { recursive: true });
            writeFileSync(join(root, '.noorm', 'settings.yml'), `stages:\n    ci:\n        defaults:\n            ${defaults}\n`);

        }

        async function mountActive(defaults: string, stored: Partial<Config>, settled = () => context?.activeConfig !== null) {

            const root = mkdtempSync(join(tmpdir(), 'noorm-effective-'));
            const sm = createMockStateManager();

            roots.push(root);
            writeStage(root, defaults);
            sm.getActiveConfigName.mockReturnValue('ci');
            sm.getConfig.mockReturnValue(stored);
            (getStateManager as Mock<typeof getStateManager>).mockReturnValueOnce(sm);

            const screen = render(
                <AppContextProvider projectRoot={root}>
                    <ContextProbe />
                </AppContextProvider>,
            );

            await waitFor(() => context?.loadingStatus === 'ready' && settled());

            return { root, sm, screen };

        }

        afterEach(() => {

            context = null;

            for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });

        });

        it('should hold a stage caFile the stored config lacks', async () => {

            const { screen } = await mountActive('ssl:\n                caFile: ./certs/ca.pem', { name: 'ci', type: 'local', isTest: false, access, connection });

            expect(context?.activeConfig?.connection.ssl).toEqual({ caFile: './certs/ca.pem' });
            screen.unmount();

        });

        it('should keep its identity across re-renders and change with the stored config or the settings', async () => {

            const stored = { name: 'ci', type: 'local', isTest: false, access, connection } satisfies Config;
            const { root, sm, screen } = await mountActive('ssl:\n                caFile: ./certs/ca.pem', stored);
            const first = context?.activeConfig;

            observer.emit('connection:open', { configName: 'ci', dialect: 'postgres' });
            await waitFor(() => context?.connectionStatus === 'connected');

            expect(context?.connectionStatus).toBe('connected');
            expect(context?.activeConfig).toBe(first);

            sm.getConfig.mockReturnValue({ ...stored, connection: { ...connection, host: 'moved' } });
            await context?.refresh();
            await waitFor(() => context?.activeConfig?.connection.host === 'moved');

            const second = context?.activeConfig;

            expect(second?.connection.host).toBe('moved');

            writeStage(root, 'ssl:\n                caFile: ./certs/other.pem');
            await context?.settingsManager?.load();
            await context?.refresh();
            await waitFor(() => context?.activeConfig !== second);

            expect(context?.activeConfig?.connection.ssl).toEqual({ caFile: './certs/other.pem' });
            screen.unmount();

        });

        it('should have the policy fingerprint of the effective config bound outside the provider', async () => {

            const stored = { name: 'ci', type: 'local', isTest: false, access, connection } satisfies Config;
            const { screen } = await mountActive('user: stage-user', stored);
            const { activeConfig, settingsManager } = loaded();
            const outside = effectiveConfig(stored, new SettingsProvider(settingsManager), false);

            expect(activeConfig.connection.user).toBe('stage-user');
            expect(getPolicyFingerprint(activeConfig)).toBe(getPolicyFingerprint(outside));
            screen.unmount();

        });

        it('should not trust a stage isTest for a stored config that does not set it', async () => {

            const { screen } = await mountActive('isTest: true', { name: 'ci', type: 'local', access, connection });

            const { activeConfig } = loaded();

            expect(activeConfig.isTest).toBe(true);
            expect(getPolicyContext(activeConfig.access)?.isTest).toBe(false);
            screen.unmount();

        });

        it('should still expose a stored config with an unknown role', async () => {

            const stored = { name: 'ci', type: 'local', isTest: false, access: { user: 'ghost', agent: 'viewer' }, connection } satisfies Config;
            const { screen } = await mountActive('user: stage-user', stored);

            expect(context?.activeConfig?.access.user).toBe('ghost');
            expect(context?.activeConfig?.connection.user).toBe('stage-user');
            screen.unmount();

        });

        // Both shapes pass the stored-config read and fail only once the defaults are merged in and the result is parsed.
        it.each([
            ['a pool.min above the default pool.max', { ...connection, pool: { min: 11 } }],
            ['a database name the schema refuses', { ...connection, database: 'app;drop' }],
        ])('should stay ready with no active config for %s', async (_shape, refused) => {

            const { screen } = await mountActive(
                'user: stage-user',
                { name: 'ci', type: 'local', isTest: false, access, connection: refused },
                () => context?.activeConfigAccessError != null,
            );

            expect(context?.loadingStatus).toBe('ready');
            expect(context?.activeConfig).toBeNull();
            expect(context?.activeConfigName).toBe('ci');
            expect(context?.activeConfigAccessError).toMatch(/\S/);
            screen.unmount();

        });

    });

    describe('malformed access on the active config', () => {

        it('should end in error when reading the active config fails for a non-access reason', async () => {

            const root = mkdtempSync(join(tmpdir(), 'noorm-read-fail-'));

            try {

                const sm = await seedMalformed(root, 'dev');

                sm.getConfig = () => {

                    throw new Error('disk exploded');

                };

                (getStateManager as Mock<typeof getStateManager>).mockReturnValueOnce(sm);

                const { lastFrame, unmount } = render(
                    <AppContextProvider projectRoot={root}>
                        <LoadingStatusDisplay />
                    </AppContextProvider>,
                );

                await waitFor(() => Boolean(lastFrame()?.includes('loading:error')));

                expect(lastFrame()).toContain('loading:error');
                expect(lastFrame()).toContain('error:disk exploded');
                unmount();

            }
            finally {

                rmSync(root, { recursive: true, force: true });

            }

        });

        it('should keep the app ready and show the repair-access warning on Home', async () => {

            const root = mkdtempSync(join(tmpdir(), 'noorm-bad-active-'));

            try {

                (getStateManager as Mock<typeof getStateManager>).mockReturnValueOnce(await seedMalformed(root, 'prod'));

                const { lastFrame, unmount } = render(<HomeInApp projectRoot={root} />);

                await waitFor(() => /none is active/.test(lastFrame() ?? ''));

                expect(lastFrame()).toContain('none is active');
                expect(lastFrame()).toContain('Config "prod"');
                expect(lastFrame()).toContain('noorm config repair-access "prod"');
                expect(lastFrame()).toContain('name:null| hasConfig:false| count:1');
                unmount();

            }
            finally {

                rmSync(root, { recursive: true, force: true });

            }

        });

        it('should not name the previous config when config:activated targets a malformed one', async () => {

            const root = mkdtempSync(join(tmpdir(), 'noorm-bad-activate-'));

            try {

                (getStateManager as Mock<typeof getStateManager>).mockReturnValueOnce(await seedMalformed(root, 'dev'));

                const { lastFrame, frames, unmount } = render(<HomeInApp projectRoot={root} />);

                // Lands on the handler registered before the manager loads, which must not name the target.
                observer.emit('config:activated', { name: 'prod' });

                await waitFor(() => /name:dev/.test(lastFrame() ?? ''));
                expect(lastFrame()).toContain('name:dev| hasConfig:true');

                // Early emits can hit a handler from before the manager was set; re-emit until one lands.
                await waitFor(() => {

                    observer.emit('config:activated', { name: 'prod' });

                    return /repair-access/.test(lastFrame() ?? '');

                });

                expect(lastFrame()).toContain('noorm config repair-access "prod"');
                expect(lastFrame()).toContain('name:null| hasConfig:false');
                expect(frames.some((f) => f.includes('name:prod'))).toBe(false);
                unmount();

            }
            finally {

                rmSync(root, { recursive: true, force: true });

            }

        });

        it('should show the warning when the malformed config is the only one', async () => {

            const root = mkdtempSync(join(tmpdir(), 'noorm-bad-only-'));

            try {

                (getStateManager as Mock<typeof getStateManager>).mockReturnValueOnce(await seedMalformed(root, 'prod', ['prod']));

                const { lastFrame, unmount } = render(<HomeInApp projectRoot={root} />);

                await waitFor(() => /repair-access/.test(lastFrame() ?? ''));

                expect(lastFrame()).toContain('noorm config repair-access "prod"');
                expect(lastFrame()).not.toContain('No database configurations found');
                expect(lastFrame()).toContain('name:null| hasConfig:false| count:0');
                unmount();

            }
            finally {

                rmSync(root, { recursive: true, force: true });

            }

        });

    });

    describe('AppContextProvider', () => {

        it('should render children', () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider autoLoad={false}>
                    <Text>Hello World</Text>
                </AppContextProvider>,
            );

            expect(lastFrame()).toContain('Hello World');

            unmount();

        });

        it('should start with not-initialized status when autoLoad is false', () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider autoLoad={false}>
                    <LoadingStatusDisplay />
                </AppContextProvider>,
            );

            expect(lastFrame()).toContain('loading:not-initialized');

            unmount();

        });

        it('should auto-load on mount by default', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <LoadingStatusDisplay />
                </AppContextProvider>,
            );

            // Wait for load to complete — CI may need more time
            await new Promise((resolve) => setTimeout(resolve, 200));

            expect(lastFrame()).toContain('loading:ready');

            unmount();

        });

    });

    describe('useAppContext', () => {

        it('should throw when used outside AppContextProvider', () => {

            const errors: string[] = [];
            const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {

                errors.push(args.map(String).join(' '));

            });

            // Ink 7 paints its error overview and then writes a cleared frame
            // as it unmounts, so the message is in `frames` but never in
            // `lastFrame()`. Search every frame.
            const { frames, unmount } = render(<ContextDisplay />);
            const output = frames.join('');

            // Error may appear in rendered output or in console.error
            const hasErrorInOutput = output.includes('useAppContext must be used within an AppContextProvider');
            const hasErrorInConsole = errors.some(e => e.includes('useAppContext must be used within an AppContextProvider'));

            expect(hasErrorInOutput || hasErrorInConsole).toBe(true);

            unmount();
            errorSpy.mockRestore();

        });

        it('should provide context value inside provider', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <ContextDisplay />
                </AppContextProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(lastFrame()).toContain('status:ready');
            expect(lastFrame()).toContain('configName:null');
            expect(lastFrame()).toContain('hasIdentity:false');
            expect(lastFrame()).toContain('connection:disconnected');
            expect(lastFrame()).toContain('lock:free');

            unmount();

        });

    });

    describe('useLoadingStatus', () => {

        it('should return loading status and error', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <LoadingStatusDisplay />
                </AppContextProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(lastFrame()).toContain('loading:ready');
            expect(lastFrame()).toContain('error:null');

            unmount();

        });

    });

    describe('useActiveConfig', () => {

        it('should return active config info', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <ActiveConfigDisplay />
                </AppContextProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(lastFrame()).toContain('name:null');
            expect(lastFrame()).toContain('hasConfig:false');
            expect(lastFrame()).toContain('count:0');

            unmount();

        });

    });

    describe('useConnectionStatus', () => {

        it('should return connection status', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <ConnectionStatusDisplay />
                </AppContextProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(lastFrame()).toContain('status:disconnected');
            expect(lastFrame()).toContain('config:null');

            unmount();

        });

        it('should update on connection:open event', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <ConnectionStatusDisplay />
                </AppContextProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 50));

            // Emit connection open event
            observer.emit('connection:open', {
                configName: 'dev',
                dialect: 'postgres',
            });

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(lastFrame()).toContain('status:connected');
            expect(lastFrame()).toContain('config:dev');

            unmount();

        });

        it('should update on connection:close event', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <ConnectionStatusDisplay />
                </AppContextProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 50));

            // Open then close
            observer.emit('connection:open', { configName: 'dev', dialect: 'postgres' });
            await new Promise((resolve) => setTimeout(resolve, 50));

            observer.emit('connection:close', { configName: 'dev' });
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(lastFrame()).toContain('status:disconnected');
            expect(lastFrame()).toContain('config:null');

            unmount();

        });

    });

    describe('useLockStatus', () => {

        it('should return lock status', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <LockStatusDisplay />
                </AppContextProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(lastFrame()).toContain('status:free');
            expect(lastFrame()).toContain('holder:null');

            unmount();

        });

        it('should update on lock:acquired event', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <LockStatusDisplay />
                </AppContextProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 50));

            observer.emit('lock:acquired', {
                configName: 'dev',
                identity: 'alice@example.com',
                expiresAt: new Date(Date.now() + 60000),
            });

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(lastFrame()).toContain('status:locked');
            expect(lastFrame()).toContain('holder:alice@example.com');

            unmount();

        });

        it('should update on lock:released event', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <LockStatusDisplay />
                </AppContextProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 50));

            // Acquire then release
            observer.emit('lock:acquired', {
                configName: 'dev',
                identity: 'alice@example.com',
                expiresAt: new Date(Date.now() + 60000),
            });
            await new Promise((resolve) => setTimeout(resolve, 50));

            observer.emit('lock:released', {
                configName: 'dev',
                identity: 'alice@example.com',
            });
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(lastFrame()).toContain('status:free');

            unmount();

        });

        it('should update on lock:blocked event', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <LockStatusDisplay />
                </AppContextProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 50));

            observer.emit('lock:blocked', {
                configName: 'dev',
                holder: 'bob@example.com',
                heldSince: new Date(),
            });

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(lastFrame()).toContain('status:blocked');
            expect(lastFrame()).toContain('holder:bob@example.com');

            unmount();

        });

    });

    describe('useIdentity', () => {

        it('should return identity info', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <IdentityDisplay />
                </AppContextProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(lastFrame()).toContain('hasIdentity:false');
            expect(lastFrame()).toContain('name:null');

            unmount();

        });

    });

    describe('useSettings', () => {

        it('should return settings info', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <SettingsDisplay />
                </AppContextProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(lastFrame()).toContain('hasSettings:true');
            expect(lastFrame()).toContain('hasManager:true');

            unmount();

        });

    });

    describe('LoadingGuard', () => {

        it('should show loading content while loading', () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider autoLoad={false}>
                    <LoadingGuard loading={<Text>Loading...</Text>}>
                        <Text>Content</Text>
                    </LoadingGuard>
                </AppContextProvider>,
            );

            expect(lastFrame()).toContain('Loading...');

            unmount();

        });

        it('should show children when ready', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <LoadingGuard loading={<Text>Loading...</Text>}>
                        <Text>Content</Text>
                    </LoadingGuard>
                </AppContextProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(lastFrame()).toContain('Content');

            unmount();

        });

    });

    describe('ConfigGuard', () => {

        it('should show fallback when no config is selected', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <ConfigGuard fallback={<Text>No config</Text>}>
                        <Text>Has config</Text>
                    </ConfigGuard>
                </AppContextProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(lastFrame()).toContain('No config');

            unmount();

        });

    });

    describe('IdentityGuard', () => {

        it('should show fallback when no identity is set', async () => {

            const { lastFrame, unmount } = render(
                <AppContextProvider>
                    <IdentityGuard fallback={<Text>No identity</Text>}>
                        <Text>Has identity</Text>
                    </IdentityGuard>
                </AppContextProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(lastFrame()).toContain('No identity');

            unmount();

        });

    });

});
