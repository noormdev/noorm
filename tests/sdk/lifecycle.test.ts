/**
 * SDK createContext lifecycle tests.
 *
 * Tests factory behavior and pre-connect guards.
 * No ctx.connect() calls — no real DB required.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attempt } from '@logosdx/utils';

import { Context, createContext, RequireTestError } from '../../src/sdk/index.js';
import { parseConfig } from '../../src/core/config/schema.js';
import { parseSettings } from '../../src/core/settings/schema.js';
import { generateKeyPair, setKeyOverride, clearKeyOverride } from '../../src/core/identity/index.js';
import { resetStateManager, StateManager } from '../../src/core/state/index.js';
import { resetSettingsManager, SettingsManager } from '../../src/core/settings/index.js';
import { getConfigPermission, getPolicyContext, isVisibleToChannel, policyTargetIdentity } from '../../src/core/policy/index.js';
import * as connectionFactory from '../../src/core/connection/factory.js';

let projectRoot: string;

beforeEach(async () => {

    projectRoot = await mkdtemp(join(tmpdir(), 'noorm-sdk-lifecycle-'));
    resetStateManager();
    resetSettingsManager();
    setKeyOverride((await generateKeyPair()).privateKey);

});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Set env vars for env-only mode and return a cleanup function.
 *
 * NOORM_CONNECTION_DIALECT + NOORM_CONNECTION_DATABASE are the
 * minimum required for resolveConfig() to return a config without
 * a stored state file.
 */
function setEnvOnlyVars(dialect = 'postgres', database = 'testdb') {

    process.env.NOORM_CONNECTION_DIALECT = dialect;
    process.env.NOORM_CONNECTION_DATABASE = database;

}

function clearEnvOnlyVars() {

    delete process.env.NOORM_CONNECTION_DIALECT;
    delete process.env.NOORM_CONNECTION_DATABASE;
    delete process.env.NOORM_CONFIG;

}

afterEach(async () => {

    clearEnvOnlyVars();
    clearKeyOverride();
    resetStateManager();
    resetSettingsManager();
    await rm(projectRoot, { recursive: true, force: true });

});

// ─────────────────────────────────────────────────────────────
// createContext factory
// ─────────────────────────────────────────────────────────────

describe('sdk: createContext factory', () => {

    it('rejects with "not found" when config name does not exist', async () => {

        const [, err] = await attempt(() => createContext({ config: '__nonexistent__', projectRoot }));

        expect(err).toBeInstanceOf(Error);
        expect.assertions(2);
        if (err instanceof Error) {

            expect(err.message).toContain('not found');

        }

    });

    it('returns an unconnected context in env-only mode', async () => {

        setEnvOnlyVars();

        const ctx = await createContext({ projectRoot });

        expect(ctx.connected).toBe(false);

    });

    it('rejects with RequireTestError when requireTest is true and env-only config has isTest: false', async () => {

        // Env-only configs default to isTest: false (resolver.ts:68).
        // Pairing with requireTest: true exercises the guard.
        setEnvOnlyVars();

        const [, err] = await attempt(() =>
            createContext({ requireTest: true, projectRoot }),
        );

        expect(err).toBeInstanceOf(RequireTestError);

    });

    it('does not create a connection pool when requireTest rejects the config', async () => {

        setEnvOnlyVars();
        const createConnection = spyOn(connectionFactory, 'createConnection');
        try {

            await expect(createContext({ requireTest: true, projectRoot })).rejects.toBeInstanceOf(RequireTestError);
            expect(createConnection).not.toHaveBeenCalled();

        }
        finally {

            createConnection.mockRestore();

        }

    });

    it('resolves fresh encrypted state and settings without changing ordinary cached contexts', async () => {

        const writer = new StateManager(projectRoot);
        await writer.load();
        const config = {
            name: 'dev', type: 'local' as const, isTest: false,
            access: { user: 'admin', agent: 'admin' },
            connection: { dialect: 'sqlite' as const, database: ':memory:' },
        };
        await writer.setConfig('dev', config);
        await writer.setSecret('dev', 'TOKEN', 'before');
        const cached = await createContext({ config: 'dev', projectRoot });
        expect(getConfigPermission('agent', cached.noorm.config, 'sql:ddl')).toBe('allow');

        await writer.setConfig('dev', { ...config, access: { user: 'admin', agent: 'viewer' } });
        await writer.setSecret('dev', 'TOKEN', 'after');
        const downgraded = await createContext({ config: 'dev', projectRoot, freshState: true });
        expect(getConfigPermission('agent', downgraded.noorm.config, 'sql:ddl')).toBe('deny');
        expect(getConfigPermission('agent', cached.noorm.config, 'sql:ddl')).toBe('allow');
        expect(cached.noorm.secrets.get('TOKEN')).toBe('before');
        expect(downgraded.noorm.secrets.get('TOKEN')).toBe('after');

        const settings = new SettingsManager(projectRoot);
        await settings.load();
        await settings.setAccessRole('viewer', { permissions: { 'sql:read': 'deny' } });
        const updated = await createContext({ config: 'dev', projectRoot, freshState: true });
        expect(getConfigPermission('agent', updated.noorm.config, 'sql:read')).toBe('deny');

        await writer.setConfig('dev', { ...config, access: { user: 'admin', agent: false } });
        const hidden = await createContext({ config: 'dev', projectRoot, freshState: true });
        expect(isVisibleToChannel(hidden.noorm.config.access, 'agent')).toBe(false);

    });

    it('rebinds a prebound config to the supplied project, roles and protected stage', () => {

        const config = parseConfig({
            name: 'production', type: 'local', isTest: false,
            access: { user: 'admin', agent: 'deployer' },
            connection: { dialect: 'sqlite', database: ':memory:' },
        });
        const identity = { name: 'tester', source: 'system' as const };
        const permissive = parseSettings({ access: { roles: {
            deployer: { permissions: { 'sql:ddl': 'allow', 'sql:read': 'allow' } },
        } } });
        const restrictive = parseSettings({
            access: { roles: { deployer: { permissions: { 'sql:ddl': 'deny', 'sql:read': 'deny' } } } },
            stages: { production: { defaults: { protected: true } } },
        });
        const first = new Context(config, permissive, identity, {}, join(projectRoot, 'a'));
        const second = new Context(first.noorm.config, restrictive, identity, {}, join(projectRoot, 'b'));

        expect(getConfigPermission('agent', first.noorm.config, 'sql:ddl')).toBe('allow');
        expect(getConfigPermission('agent', second.noorm.config, 'sql:ddl')).toBe('deny');
        expect(getConfigPermission('agent', second.noorm.config, 'sql:read')).toBe('deny');
        expect(getConfigPermission('user', second.noorm.config, 'sql:ddl')).toBe('deny');
        expect(getPolicyContext(second.noorm.config.access!)?.targetIdentity)
            .toBe(policyTargetIdentity(join(projectRoot, 'b'), config.connection));
        expect(getPolicyContext(first.noorm.config.access!)?.targetIdentity)
            .toBe(policyTargetIdentity(join(projectRoot, 'a'), config.connection));
        expect(() => new Context(first.noorm.config, parseSettings({}), identity, {}, projectRoot))
            .toThrow('Unknown access role "deployer"');
        expect(getConfigPermission('agent', first.noorm.config, 'sql:ddl')).toBe('allow');

    });

    it('retains an explicit stage through the factory and schema scopes', async () => {

        const writer = new StateManager(projectRoot);
        await writer.load();
        await writer.setConfig('dev', {
            name: 'dev', type: 'local', isTest: false,
            access: { user: 'admin', agent: 'admin' },
            connection: { dialect: 'sqlite', database: ':memory:' },
        });
        const settings = new SettingsManager(projectRoot);
        await settings.load();
        await settings.setStage('production', { defaults: { protected: true } });
        const ctx = await createContext({ config: 'dev', stage: 'production', projectRoot });
        const scoped = ctx.withSchema('app');

        expect(getConfigPermission('agent', ctx.noorm.config, 'sql:ddl')).toBe('deny');
        expect(getConfigPermission('agent', scoped.noorm.config, 'sql:ddl')).toBe('deny');
        expect(scoped.noorm.settings).toBe(ctx.noorm.settings);
        expect(getPolicyContext(scoped.noorm.config.access!)?.targetIdentity)
            .toBe(policyTargetIdentity(projectRoot, ctx.noorm.config.connection));

    });

    it('keeps the ceiling of a protected config when the caller selects an unprotected stage', async () => {

        const writer = new StateManager(projectRoot);
        await writer.load();
        await writer.setConfig('production', {
            name: 'production', type: 'local', isTest: false,
            access: { user: 'admin', agent: 'admin' },
            connection: { dialect: 'sqlite', database: ':memory:' },
        });
        const settings = new SettingsManager(projectRoot);
        await settings.load();
        await settings.setStage('production', { defaults: { protected: true } });
        await settings.setStage('dev', { defaults: {} });
        const ctx = await createContext({ config: 'production', stage: 'dev', projectRoot });

        expect(getConfigPermission('agent', ctx.noorm.config, 'sql:ddl')).toBe('deny');
        expect(getConfigPermission('agent', ctx.withSchema('app').noorm.config, 'sql:ddl')).toBe('deny');

    });

    it('keeps the ceiling of a protected stored config when NOORM_NAME renames it to an unprotected name', async () => {

        const writer = new StateManager(projectRoot);
        await writer.load();
        await writer.setConfig('prod', {
            name: 'prod', type: 'local', isTest: false,
            access: { user: 'admin', agent: 'admin' },
            connection: { dialect: 'sqlite', database: ':memory:' },
        });
        const settings = new SettingsManager(projectRoot);
        await settings.load();
        await settings.setStage('prod', { defaults: { protected: true } });
        process.env.NOORM_NAME = 'dev';

        try {

            const ctx = await createContext({ config: 'prod', projectRoot });

            expect(getConfigPermission('agent', ctx.noorm.config, 'sql:ddl')).toBe('deny');

        }
        finally {

            delete process.env.NOORM_NAME;

        }

    });


});

// ─────────────────────────────────────────────────────────────
// Context pre-connect behavior
// ─────────────────────────────────────────────────────────────

describe('sdk: Context pre-connect behavior', () => {

    it('throws "Not connected" when accessing ctx.kysely before connect()', async () => {

        setEnvOnlyVars();

        const ctx = await createContext({ projectRoot });

        expect(() => ctx.kysely).toThrow('Not connected');

    });

});
