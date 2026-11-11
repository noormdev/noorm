import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseConfig } from '../../../src/core/config/schema.js';
import type { Config } from '../../../src/core/config/types.js';
import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import type { Stage } from '../../../src/core/settings/types.js';
import { StateManager } from '../../../src/core/state/index.js';
import { decrypt } from '../../../src/core/state/encryption/index.js';
import type { EncryptedPayload, State } from '../../../src/core/state/types.js';

const ROOT = process.cwd();
const CLI = join(ROOT, 'dist/cli/index.js');

/** Commands run in fresh processes: no module mocks, ambient config, or real home directory. */
describe('cli: stage config creation and sync', () => {

    let root: string;
    let privateKey: string;
    let env: Record<string, string>;
    let state: StateManager;

    beforeEach(async () => {

        root = mkdtempSync(join(tmpdir(), 'noorm-stage-commands-'));
        const home = join(root, 'home');
        mkdirSync(home);
        mkdirSync(join(root, '.noorm'));
        privateKey = generateKeyPair().privateKey;
        env = {};

        for (const [key, value] of Object.entries(process.env)) {

            if (value !== undefined && !key.startsWith('NOORM_')) env[key] = value;

        }

        Object.assign(env, {
            HOME: home,
            NOORM_CHANNEL: 'user',
            NOORM_IDENTITY_PRIVATE_KEY: privateKey,
            NOORM_IDENTITY_NAME: 'Stage Test',
            NOORM_IDENTITY_EMAIL: 'stages@example.com',
        });
        writeStages({
            fresh: {
                defaults: {
                    dialect: 'postgres',
                    host: 'stage.invalid',
                    database: 'stage_database',
                    user: 'stage-user',
                    password: 'stage-password',
                    type: 'remote',
                    isTest: true,
                    access: { user: 'operator', agent: 'viewer' },
                },
            },
            existing: { defaults: { dialect: 'sqlite', database: 'stage.sqlite', password: 'bulk-password' } },
        });
        state = new StateManager(root, { privateKey });
        await state.load();
        await state.setConfig('existing', originalConfig());

    });

    afterEach(() => {

        rmSync(root, { recursive: true, force: true });

    });

    function writeStages(stages: Record<string, Stage>): void {

        // JSON is valid YAML, and keeps fixtures aligned with the real settings schema.
        writeFileSync(join(root, '.noorm', 'settings.yml'), JSON.stringify({ stages }));

    }

    function originalConfig(overrides: Partial<Config> = {}): Config {

        return parseConfig({
            name: 'existing',
            type: 'local',
            isTest: false,
            access: { user: 'admin', agent: 'viewer' },
            identity: 'keep-identity',
            log: { level: 'warn' },
            connection: { dialect: 'sqlite', database: 'original.sqlite', password: 'stored-password' },
            ...overrides,
        });

    }

    function run(command: 'create' | 'sync', args: string[], overrides: Record<string, string> = {}) {

        return spawnSync('node', [CLI, 'config', command, ...args, '--json'], {
            cwd: root,
            encoding: 'utf-8',
            env: { ...env, ...overrides },
            timeout: 15000,
        });

    }

    function encryptedState(): string {

        return readFileSync(state.getStatePath(), 'utf8');

    }

    function persistedConfigs(): Record<string, Config> {

        const payload = JSON.parse(encryptedState()) as EncryptedPayload;

        // Inspect the command's encrypted output directly, without load-time repair or defaults.
        const persisted: State = JSON.parse(decrypt(payload, privateKey));

        return persisted.configs;

    }

    for (const flags of [[], ['--force'], ['--yes']]) {

        it(`preflights mixed bulk collisions without partial writes (${flags.join(' ') || 'no flags'})`, () => {

            const before = encryptedState();
            const result = run('create', ['--all', ...flags]);

            expect(result.status).toBe(2);
            expect(result.stdout).toContain('overwriting requires --force and --yes');
            expect(encryptedState()).toBe(before);
            expect(Object.keys(persistedConfigs())).toEqual(['existing']);

        });

    }

    it('creates and overwrites bulk configs only with force and yes, omitting all inherited passwords', () => {

        const result = run('create', ['--all', '--force', '--yes'], {
            NOORM_NAME: 'redirected',
            NOORM_CONNECTION_DATABASE: 'env_database',
            NOORM_CONNECTION_PASSWORD: 'env-password',
            NOORM_ACCESS_USER: 'admin',
            NOORM_ACCESS_AGENT: 'admin',
        });

        expect(result.status).toBe(0);

        const configs = persistedConfigs();
        expect(Object.keys(configs).sort()).toEqual(['existing', 'fresh']);
        expect(configs['fresh']!.connection).toMatchObject({ host: 'stage.invalid', database: 'stage_database' });
        expect(configs['fresh']!.connection.password).toBeUndefined();
        expect(configs['existing']!.connection.database).toBe('stage.sqlite');
        expect(configs['existing']!.connection.password).toBeUndefined();
        expect(configs['fresh']!.access).toEqual({ user: 'operator', agent: 'viewer' });
        expect(configs['fresh']!.isTest).toBe(true);

    });

    for (const channel of ['user', 'agent']) {

        it(`denies bulk overwrite for the ${channel} viewer role, even with force and yes`, async () => {

            await state.setConfig('existing', originalConfig({ access: { user: 'viewer', agent: 'viewer' } }));
            const before = encryptedState();
            const result = run('create', ['--all', '--force', '--yes'], { NOORM_CHANNEL: channel });

            expect(result.status).toBe(2);
            expect(result.stdout).toContain(channel === 'agent' ? 'only available on the user channel' : 'config:write');
            expect(encryptedState()).toBe(before);
            expect(Object.keys(persistedConfigs())).toEqual(['existing']);

        });

    }

    it('does not let an agent bypass human overwrite confirmation with force and yes', async () => {

        await state.setConfig('existing', originalConfig({ access: { user: 'admin', agent: 'admin' } }));
        const before = encryptedState();
        const result = run('create', ['--all', '--force', '--yes'], { NOORM_CHANNEL: 'agent' });

        expect(result.status).toBe(2);
        expect(result.stdout).toContain('only available on the user channel');
        expect(encryptedState()).toBe(before);
        expect(Object.keys(persistedConfigs())).toEqual(['existing']);

    });

    for (const args of [['--stage', 'fresh'], ['--stage', 'fresh', '--name', 'selected']]) {

        it(`keeps the selected write target despite NOORM_NAME (${args.join(' ')})`, async () => {

            await state.setConfig('existing', originalConfig({ access: { user: 'viewer', agent: false } }));
            const original = persistedConfigs()['existing'];
            const result = run('create', args, {
                NOORM_NAME: 'existing',
                NOORM_TYPE: 'local',
                NOORM_isTest: 'false',
                NOORM_ACCESS_USER: 'admin',
                NOORM_ACCESS_AGENT: 'admin',
                NOORM_CONNECTION_HOST: 'environment.invalid',
                NOORM_CONNECTION_PASSWORD: 'env-password',
            });

            expect(result.status).toBe(0);

            const name = args.includes('--name') ? 'selected' : 'fresh';
            const configs = persistedConfigs();
            expect(configs['existing']).toEqual(original);
            expect(configs[name]!.name).toBe(name);
            expect(configs[name]!.connection.host).toBe('environment.invalid');
            expect(configs[name]!.connection.password).toBeUndefined();
            expect(configs[name]!.type).toBe('remote');
            expect(configs[name]!.isTest).toBe(true);
            expect(configs[name]!.access).toEqual({ user: 'operator', agent: 'viewer' });

        });

    }

    it('checks collision and policy against the selected final target, not the environment name', async () => {

        await state.setConfig('existing', originalConfig({ access: { user: 'viewer', agent: false } }));
        const before = encryptedState();
        const args = ['--stage', 'fresh', '--name', 'existing'];
        const collision = run('create', args, { NOORM_NAME: 'unused' });

        expect(collision.status).toBe(2);
        expect(collision.stdout).toContain("Config 'existing' exists");
        expect(encryptedState()).toBe(before);

        const denied = run('create', [...args, '--force', '--yes'], { NOORM_NAME: 'unused' });

        expect(denied.status).toBe(2);
        expect(denied.stdout).toContain('config:write');
        expect(encryptedState()).toBe(before);
        expect(persistedConfigs()['unused']).toBeUndefined();

    });

    it('persists only the explicit single-stage password and gives flags priority over environment', () => {

        const result = run('create', [
            '--stage', 'fresh', '--name', 'selected', '--password', 'explicit-password',
            '--host', 'flag.invalid', '--database', 'flag_database',
        ], {
            NOORM_CONNECTION_HOST: 'environment.invalid',
            NOORM_CONNECTION_PASSWORD: 'env-password',
        });

        expect(result.status).toBe(0);
        expect(persistedConfigs()['selected']!.connection).toMatchObject({
            host: 'flag.invalid', database: 'flag_database', password: 'explicit-password',
        });

    });

    it('rejects password flags in bulk mode without changing encrypted state', () => {

        const before = encryptedState();
        const result = run('create', ['--all', '--password', 'explicit-password', '--force', '--yes']);

        expect(result.status).toBe(2);
        expect(encryptedState()).toBe(before);

    });

    function syncDefaults(): void {

        writeStages({
            source: {
                defaults: {
                    dialect: 'sqlite',
                    database: 'updated.sqlite',
                    password: 'replacement-must-not-persist',
                    isTest: true,
                    access: { user: 'admin', agent: 'admin' },
                },
            },
        });

    }

    it('previews sync over the real command without writing or exposing passwords', () => {

        syncDefaults();
        const before = encryptedState();
        const result = run('sync', ['--stage', 'source', '--name', 'existing']);

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ applied: false });
        expect(result.stdout).toContain('connection.database');
        expect(result.stdout).not.toContain('stored-password');
        expect(result.stdout).not.toContain('replacement-must-not-persist');
        expect(encryptedState()).toBe(before);
        expect(persistedConfigs()['existing']).toEqual(originalConfig());

    });

    it('applies explicit sync fields while preserving credentials, unrelated fields and stricter access', async () => {

        syncDefaults();
        const original = originalConfig({ access: { user: 'admin', agent: false } });
        await state.setConfig('existing', original);
        const result = run('sync', ['--stage', 'source', '--name', 'existing', '--yes']);

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ applied: true });
        expect(persistedConfigs()['existing']).toEqual({
            ...original,
            isTest: true,
            access: { user: 'admin', agent: false },
            connection: { ...original.connection, database: 'updated.sqlite' },
        });

        const before = encryptedState();
        const unchanged = run('sync', ['--stage', 'source', '--name', 'existing', '--yes']);

        expect(unchanged.status).toBe(0);
        expect(JSON.parse(unchanged.stdout)).toMatchObject({ applied: false, changes: [] });
        expect(encryptedState()).toBe(before);

    });

    it('config sync keeps the stored certFile and keyFile when the stage ssl is { caFile }', async () => {

        writeStages({ source: { defaults: { ssl: { caFile: './stage-ca.pem' } } } });
        await state.setConfig('existing', originalConfig({
            connection: {
                dialect: 'postgres',
                host: 'db.invalid',
                database: 'original',
                ssl: { certFile: './client.pem', keyFile: './client.key' },
            },
        }));

        const result = run('sync', ['--stage', 'source', '--name', 'existing', '--yes']);

        expect(result.status).toBe(0);
        expect(persistedConfigs()['existing']?.connection.ssl).toEqual({
            caFile: './stage-ca.pem',
            certFile: './client.pem',
            keyFile: './client.key',
        });

    });

    it('config sync with a stage ssl true drops the stored rejectUnauthorized and keeps its caFile', async () => {

        writeStages({ source: { defaults: { ssl: true } } });
        await state.setConfig('existing', originalConfig({
            connection: {
                dialect: 'postgres',
                host: 'db.invalid',
                database: 'original',
                ssl: { rejectUnauthorized: false, caFile: './stored-ca.pem' },
            },
        }));

        const result = run('sync', ['--stage', 'source', '--name', 'existing', '--yes']);

        expect(result.status).toBe(0);
        expect(persistedConfigs()['existing']?.connection.ssl).toEqual({ caFile: './stored-ca.pem' });

    });

    it('config sync never prints a stored inline key, cert or ca in the preview', async () => {

        writeStages({ source: { defaults: { ssl: true } } });
        await state.setConfig('existing', originalConfig({
            connection: {
                dialect: 'postgres',
                host: 'db.invalid',
                database: 'original',
                ssl: { key: 'SECRET-KEY-BODY', cert: 'CERT-BODY', ca: 'CA-BODY', rejectUnauthorized: false },
            },
        }));

        const text = run('sync', ['--stage', 'source', '--name', 'existing']);
        const json = run('sync', ['--stage', 'source', '--name', 'existing', '--json']);

        for (const result of [text, json]) {

            expect(result.status).toBe(0);
            expect(result.stdout).not.toContain('SECRET-KEY-BODY');
            expect(result.stdout).not.toContain('CERT-BODY');
            expect(result.stdout).not.toContain('CA-BODY');
            expect(result.stdout).toContain('[inline PEM]');

        }

    });

    it('denies sync for a viewer even with yes and leaves encrypted state untouched', async () => {

        syncDefaults();
        await state.setConfig('existing', originalConfig({ access: { user: 'viewer', agent: false } }));
        const before = encryptedState();
        const result = run('sync', ['--stage', 'source', '--name', 'existing', '--yes']);

        expect(result.status).toBe(2);
        expect(result.stdout).toContain('config:write');
        expect(encryptedState()).toBe(before);

    });

    it('refuses protected stage aliases without writing', () => {

        writeStages({ source: { defaults: { dialect: 'sqlite', protected: true, access: { user: 'admin', agent: 'admin' } } } });
        const before = encryptedState();
        const create = run('create', ['--stage', 'source', '--name', 'alias']);
        const sync = run('sync', ['--stage', 'source', '--name', 'existing', '--yes']);

        expect(create.status).toBe(2);
        expect(sync.status).toBe(2);
        expect(create.stdout).toContain('must use its stage name');
        expect(sync.stdout).toContain('must use its stage name');
        expect(encryptedState()).toBe(before);

    });

    it('preserves incomparable custom roles and adopts narrower assignments', async () => {

        writeFileSync(join(root, '.noorm', 'settings.yml'), JSON.stringify({
            access: { roles: {
                current: { extends: 'viewer', permissions: { 'config:write': 'allow', 'sql:write': 'allow' } },
                incomparable: { extends: 'viewer', permissions: { 'sql:ddl': 'allow' } },
                narrower: { extends: 'viewer', permissions: { 'sql:read': 'deny' } },
            } },
            stages: { source: { defaults: {
                dialect: 'sqlite', access: { user: 'incomparable', agent: 'narrower' },
            } } },
        }));
        await state.setConfig('existing', originalConfig({ access: { user: 'current', agent: 'viewer' } }));
        const result = run('sync', ['--stage', 'source', '--name', 'existing', '--yes']);

        expect(result.status).toBe(0);
        expect(persistedConfigs()['existing']!.access).toEqual({ user: 'current', agent: 'narrower' });

    });

    it('keeps protected assignments unchanged and prevents agent materialization', () => {

        writeStages({ prod: { defaults: {
            dialect: 'sqlite', protected: true, access: { user: 'admin', agent: 'admin' },
        } } });
        const denied = run('create', ['--stage', 'prod'], { NOORM_CHANNEL: 'agent' });
        expect(denied.status).toBe(2);
        expect(persistedConfigs()['prod']).toBeUndefined();

        const created = run('create', ['--stage', 'prod']);
        expect(created.status).toBe(0);
        expect(persistedConfigs()['prod']!.access).toEqual({ user: 'admin', agent: 'admin' });

    });

    it('allows an agent with config:write to sync without expanding either role', async () => {

        writeFileSync(join(root, '.noorm', 'settings.yml'), JSON.stringify({
            access: { roles: { maintainer: { extends: 'viewer', permissions: { 'config:write': 'allow' } } } },
            stages: { source: { defaults: {
                dialect: 'sqlite', database: 'updated.sqlite',
                access: { user: 'admin', agent: 'admin' },
            } } },
        }));
        await state.setConfig('existing', originalConfig({ access: { user: 'viewer', agent: 'maintainer' } }));
        const result = run('sync', ['--stage', 'source', '--name', 'existing', '--yes'], { NOORM_CHANNEL: 'agent' });

        expect(result.status).toBe(0);
        expect(persistedConfigs()['existing']!.access).toEqual({ user: 'viewer', agent: 'maintainer' });
        expect(persistedConfigs()['existing']!.connection.database).toBe('updated.sqlite');

    });

    it('rejects sync dialect changes without modifying the persisted config', () => {

        const before = encryptedState();
        const result = run('sync', ['--stage', 'fresh', '--name', 'existing', '--yes']);

        expect(result.status).toBe(2);
        expect(result.stdout).toContain('Stage dialect differs');
        expect(encryptedState()).toBe(before);

    });

    it('preserves the explicit stage password during real TUI auto-seeding', () => {

        const moduleUrl = (path: string) => pathToFileURL(join(ROOT, 'dist', path)).href;
        const script = `
            import React from ${JSON.stringify(import.meta.resolve('react'))};
            import { render } from ${JSON.stringify(import.meta.resolve('ink-testing-library'))};
            import { AppContextProvider, useAppContext } from ${JSON.stringify(moduleUrl('tui/app-context.js'))};
            import { loadIdentityFromEnv } from ${JSON.stringify(moduleUrl('core/identity/env.js'))};
            import { setKeyOverride, setIdentityOverride } from ${JSON.stringify(moduleUrl('core/identity/storage.js'))};

            const identity = loadIdentityFromEnv();
            setKeyOverride(identity.privateKey);
            setIdentityOverride(identity.identity);

            const { promise: ready, resolve: resolveReady, reject: rejectReady } = Promise.withResolvers();

            function Loaded() {
                const context = useAppContext();
                React.useEffect(() => {
                    if (context.loadingStatus === 'ready') resolveReady();
                    if (context.loadingStatus === 'error') rejectReady(context.error);
                }, [context.loadingStatus, context.error]);
                return null;
            }

            const app = render(React.createElement(AppContextProvider, null, React.createElement(Loaded)));
            await ready;
            app.unmount();
        `;
        const result = spawnSync('node', ['--input-type=module', '--eval', script], {
            cwd: root,
            env,
            encoding: 'utf-8',
            timeout: 15000,
        });

        expect(result.status).toBe(0);
        expect(persistedConfigs()['fresh']!.connection.password).toBe('stage-password');
        expect(persistedConfigs()['fresh']!.access).toEqual({ user: 'operator', agent: 'viewer' });
        expect(persistedConfigs()['existing']!.connection.password).toBe('stored-password');

    });

});
