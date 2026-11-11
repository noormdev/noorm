// The identity sync connects through the real createConnection, so the stage caFile names an absent file
// and its path in the SslFileError proves which config the sync was given.
import { describe, it, expect, vi, mock, beforeEach, afterEach } from 'bun:test';
import { stripVTControlCharacters } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider, useAppContext, type AppContextValue } from '../../../../src/tui/app-context.js';
import { ToastProvider, ToastRenderer } from '../../../../src/tui/components/index.js';
import { ConfigListScreen } from '../../../../src/tui/screens/config/ConfigListScreen.js';
import { SslFileError } from '../../../../src/core/connection/ssl-files.js';
import { clearIdentityOverride, getIdentityOverride, setIdentityOverride } from '../../../../src/core/identity/storage.js';
import type { Config, ConfigSummary } from '../../../../src/core/config/types.js';
import type { NoormEvents } from '../../../../src/core/observer.js';
import type { StageDefaults } from '../../../../src/core/settings/types.js';

const actualCore = await import('../../../../src/core/index.js');
const actualIdentity = await import('../../../../src/core/identity/index.js');

type StoredConfig = Pick<Config, 'name' | 'type' | 'access' | 'connection'> & { isTest?: boolean };

const caFile = join(tmpdir(), 'noorm-config-list-absent', 'stage-ca.pem');

/** A server config that stores no `isTest`, and no `ssl` unless one is given. */
function stored(name: string, ssl?: Config['connection']['ssl'], userRole = 'viewer'): StoredConfig {

    return {
        name,
        type: 'local',
        access: { user: userRole, agent: 'viewer' },
        connection: { dialect: 'postgres', host: '127.0.0.1', port: 1, database: 'app', user: 'app', ...(ssl === undefined ? {} : { ssl }) },
    };

}

/** The sync connects to it for real. A viewer may not record, so `identity:synced` fires only when the bound policy context trusts `isTest`. */
function storedSqlite(name: string, isTest?: boolean): StoredConfig {

    return {
        name,
        type: 'local',
        ...(isTest === undefined ? {} : { isTest }),
        access: { user: 'viewer', agent: 'viewer' },
        connection: { dialect: 'sqlite', database: ':memory:' },
    };

}

function createStateManager(configs: StoredConfig[]) {

    let activeName: string | null = null;

    return {
        load: vi.fn().mockResolvedValue(undefined),
        getActiveConfigName: vi.fn(() => activeName),
        getConfig: vi.fn((name: string) => configs.find((config) => config.name === name) ?? null),
        listConfigs: vi.fn((): ConfigSummary[] => configs.map((config) => ({
            name: config.name,
            type: config.type,
            isTest: config.isTest === true,
            access: config.access,
            isActive: config.name === activeName,
            dialect: config.connection.dialect,
            database: config.connection.database,
        }))),
        setActiveConfig: vi.fn(async (name: string) => {

            activeName = name;

        }),
        addKnownUsers: vi.fn().mockResolvedValue(undefined),
        hasPrivateKey: vi.fn().mockReturnValue(true),
        isLoaded: true,
    };

}

function createSettingsManager(stages: Record<string, StageDefaults>) {

    return {
        load: vi.fn().mockResolvedValue({ version: '0.1.0' }),
        isLoaded: true,
        settings: { version: '0.1.0' },
        getStages: vi.fn().mockReturnValue({}),
        getStage: vi.fn((name: string) => (stages[name] ? { defaults: stages[name] } : undefined)),
    };

}

let stateManager = createStateManager([]);
let settingsManager = createSettingsManager({});

mock.module('../../../../src/core/index.js', () => ({
    ...actualCore,
    getStateManager: vi.fn(() => stateManager),
    getSettingsManager: vi.fn(() => settingsManager),
}));

// Replacing this export also replaces it for `identity/sync.ts`, which imports it from `factory.js`,
// so a stand-in that returned null would end the sync before it connects.
mock.module('../../../../src/core/identity/index.js', () => ({
    ...actualIdentity,
    loadExistingIdentity: async () => getIdentityOverride(),
}));

async function waitFor(predicate: () => boolean, timeoutMs = 4000) {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

describe('cli: ConfigListScreen', () => {

    let errors: NoormEvents['error'][] = [];
    let synced: NoormEvents['identity:synced'][] = [];

    async function renderList(configs: StoredConfig[], stages: Record<string, StageDefaults> = {}) {

        // Held per render, so a test never reads the context another test's tree wrote.
        const probe: { context: AppContextValue | null } = { context: null };

        /** Mounts the list once the managers are loaded, so its first highlight is the first config. */
        function ListWhenReady(): React.ReactElement | null {

            probe.context = useAppContext();

            return probe.context.loadingStatus === 'ready' ? <ConfigListScreen params={{}} /> : null;

        }

        stateManager = createStateManager(configs);
        settingsManager = createSettingsManager(stages);

        const screen = render(
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider projectRoot={tmpdir()}>
                        <ToastProvider>
                            <ListWhenReady />
                            <ToastRenderer />
                        </ToastProvider>
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>,
        );
        const frame = () => stripVTControlCharacters(screen.lastFrame() ?? '');

        await waitFor(() => configs.every((config) => frame().includes(config.name)));

        const row = (name: string) => frame().split('\n').find((line) => line.includes(name)) ?? '';

        return { ...screen, frame, row, activeConfig: () => probe.context?.activeConfig ?? null };

    }

    /** Presses Enter until `done` holds: a key written before the list takes focus is dropped. */
    async function activateFirst(stdin: { write: (data: string) => void }, done: () => boolean) {

        const deadline = Date.now() + 4000;

        while (!done() && Date.now() < deadline) {

            stdin.write('\r');
            await new Promise((resolve) => setTimeout(resolve, 30));

        }

    }

    beforeEach(() => {

        actualCore.observer.clear();
        errors = [];
        synced = [];
        actualCore.observer.on('error', (event) => errors.push(event));
        actualCore.observer.on('identity:synced', (event) => synced.push(event));
        setIdentityOverride({
            identityHash: 'test-hash',
            name: 'Ada Lovelace',
            email: 'ada@example.com',
            publicKey: 'test-public-key',
            machine: 'test-machine',
            os: 'test-os',
            createdAt: '2026-01-01T00:00:00.000Z',
        });

    });

    afterEach(() => {

        clearIdentityOverride();
        actualCore.observer.clear();

    });

    describe('activation', () => {

        it('should sync identity with the stage caFile a config with no stored ssl lacks', async () => {

            const { stdin, unmount } = await renderList([stored('ci')], { ci: { ssl: { caFile } } });

            await activateFirst(stdin, () => errors.some((event) => event.source === 'identity:sync:connection'));

            const event = errors.find((candidate) => candidate.source === 'identity:sync:connection');

            expect(event?.error).toBeInstanceOf(SslFileError);
            expect(event?.error.message).toBe(`Cannot read ssl.caFile '${caFile}': ENOENT`);
            unmount();

        });

        it('should show the validation error for a config with an unknown role', async () => {

            const { stdin, frame, unmount } = await renderList([stored('ci', undefined, 'ghost')], { ci: { ssl: { caFile } } });

            await activateFirst(stdin, () => /unknown/i.test(frame()));

            expect(frame()).toMatch(/unknown.*ghost|ghost.*unknown/is);
            expect(stateManager.setActiveConfig).not.toHaveBeenCalled();
            expect(errors).toHaveLength(0);
            unmount();

        });

        // The app context reports the config active only after the sync returns.
        it('should hand the sync no trusted-test grant when only the stage sets isTest', async () => {

            const screen = await renderList([storedSqlite('ci')], { ci: { isTest: true } });

            await activateFirst(screen.stdin, () => screen.activeConfig()?.name === 'ci');

            expect(screen.activeConfig()?.name).toBe('ci');
            expect(errors).toHaveLength(0);
            expect(synced).toHaveLength(0);
            screen.unmount();

        });

        it('should let the sync register when the stored config sets isTest', async () => {

            const screen = await renderList([storedSqlite('ci', true)]);

            await activateFirst(screen.stdin, () => screen.activeConfig()?.name === 'ci');

            // `activateFirst` can land a second Enter before the first sync returns, so the count is not pinned to one.
            expect(synced.length).toBeGreaterThan(0);
            expect(synced.every((event) => event.configName === 'ci')).toBe(true);
            screen.unmount();

        });

    });

    describe('TLS tag', () => {

        it('should show tls, tls unverified, or no tag for the ssl in effect', async () => {

            const { row, unmount } = await renderList([
                stored('verified', true),
                stored('lax', { rejectUnauthorized: false }),
                stored('plain'),
                stored('off', false),
            ]);

            expect(row('verified')).toContain('[tls]');
            expect(row('lax')).toContain('[tls unverified]');
            expect(row('plain')).not.toContain('tls');
            expect(row('off')).not.toContain('tls');
            unmount();

        });

        it('should show tls for a config with no stored ssl under a stage that supplies ssl', async () => {

            const { row, unmount } = await renderList([stored('ci')], { ci: { ssl: { caFile } } });

            expect(row('ci')).toContain('[tls]');
            unmount();

        });

        it('should show no tag for a SQLite config', async () => {

            const sqlite: StoredConfig = {
                name: 'embedded',
                type: 'local',
                access: { user: 'viewer', agent: 'viewer' },
                connection: { dialect: 'sqlite', database: ':memory:' },
            };
            const { row, unmount } = await renderList([sqlite], { embedded: { ssl: true } });

            expect(row('embedded')).toContain('sqlite');
            expect(row('embedded')).not.toContain('tls');
            unmount();

        });

        it('should render the row of a config with an unknown access role without a tag', async () => {

            const { row, unmount } = await renderList([stored('orphan', true, 'ghost')]);

            expect(row('orphan')).toContain('postgres');
            expect(row('orphan')).not.toContain('tls');
            unmount();

        });

    });

});
