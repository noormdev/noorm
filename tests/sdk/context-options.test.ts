/** createContext options for a process that builds several connections in code, with no stored config. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attempt } from '@logosdx/utils';

import {
    createContext,
    DatabaseConnectionError,
    noormObserver,
    type ConnectionRetryOptions,
    type Context,
    type CreateContextOptions,
    type NoormEvents,
} from '../../src/sdk/index.js';
import { DatabaseConnectionError as CoreDatabaseConnectionError } from '../../src/core/connection/errors.js';
import * as connectionFactory from '../../src/core/connection/factory.js';
import { generateKeyPair } from '../../src/core/identity/index.js';
import { clearKeyOverride, setKeyOverride } from '../../src/core/identity/storage.js';
import { getConfigPermission } from '../../src/core/policy/index.js';
import { SettingsManager, type Stage } from '../../src/core/settings/index.js';
import { resetStateManager, StateManager } from '../../src/core/state/index.js';

let root: string;
let envBackup: NodeJS.ProcessEnv;
const contexts: Context[] = [];

function clearNoormEnv() {

    for (const key of Object.keys(process.env)) {

        if (key.startsWith('NOORM_')) delete process.env[key];

    }

}

async function open(options: CreateContextOptions): Promise<Context> {

    const ctx = await createContext({ projectRoot: root, freshState: true, ...options });
    contexts.push(ctx);

    return ctx;

}

const scratch = () => ({ dialect: 'sqlite' as const, database: join(root, 'scratch.db') });

async function setStage(name: string, defaults: NonNullable<Stage['defaults']>) {

    const settings = new SettingsManager(root);
    await settings.load();
    await settings.setStage(name, { defaults });

}

async function storeConfig(name: string) {

    const state = new StateManager(root);
    await state.load();
    await state.setConfig(name, {
        name,
        type: 'local',
        isTest: false,
        access: { user: 'admin', agent: 'admin' },
        connection: { dialect: 'sqlite', database: join(root, `${name}.db`) },
    });

}

beforeEach(async () => {

    root = await mkdtemp(join(tmpdir(), 'noorm-sdk-options-'));
    envBackup = { ...process.env };
    clearNoormEnv();
    resetStateManager();
    setKeyOverride((await generateKeyPair()).privateKey);

});

afterEach(async () => {

    await Promise.all(contexts.map((ctx) => ctx.disconnect()));
    contexts.length = 0;
    clearNoormEnv();
    Object.assign(process.env, envBackup);
    clearKeyOverride();
    resetStateManager();
    await rm(root, { recursive: true, force: true });

});

describe('sdk: createContext name', () => {

    // One process runs several pools; a shared "__inline__" cannot say which one failed.
    it('should give concurrent inline contexts their own name in config and connection errors', async () => {

        const events: NoormEvents['connection:error'][] = [];
        const stop = noormObserver.on('connection:error', (event) => {

            events.push(event);

        });
        const failing = (name: string) => open({
            name,
            connection: { dialect: 'mysql', database: 'app', password: () => {

                throw new Error(`no credential for ${name}`);

            } },
        });
        const retry: ConnectionRetryOptions = { retries: 1, delay: 0 };

        const [orders, billing] = await Promise.all([failing('orders'), failing('billing')]);
        const results = await Promise.all([orders, billing].map((ctx) => attempt(() => ctx.connect(retry))));
        stop();

        expect(orders.noorm.config.name).toBe('orders');
        expect(billing.noorm.config.name).toBe('billing');
        expect(results.map(([, err]) => err?.message)).toEqual(['no credential for orders', 'no credential for billing']);
        expect(events.map((event) => event.configName).sort()).toEqual(['billing', 'orders']);

    });

    // NOORM_NAME is one value for the whole process, so it cannot name contexts created side by side.
    it('should win over NOORM_NAME', async () => {

        process.env['NOORM_NAME'] = 'from-env';
        const ctx = await open({ name: 'reporting', connection: { dialect: 'sqlite', database: ':memory:' } });

        expect(ctx.noorm.config.name).toBe('reporting');

    });

    // Renaming a stored config would move it to another stage and protected-stage ceiling.
    it('should refuse a name when a stored config is selected', async () => {

        await storeConfig('dev');

        const [ctx, err] = await attempt(() => open({ config: 'dev', name: 'reporting' }));

        expect(ctx).toBeNull();
        expect(err?.message).toContain('stored config "dev"');

    });

    // A caller-chosen name may add a restriction and never remove one.
    it('should apply the ceiling of a protected stage the context is named after', async () => {

        await setStage('prod', { protected: true });

        const named = await open({ name: 'prod', connection: { dialect: 'sqlite', database: ':memory:' } });
        const unnamed = await open({ connection: { dialect: 'sqlite', database: ':memory:' } });

        expect(getConfigPermission('user', named.noorm.config, 'sql:ddl')).toBe('deny');
        expect(getConfigPermission('user', unnamed.noorm.config, 'sql:ddl')).toBe('allow');

    });

    // Local secrets are keyed by config name, so the name alone would read and write the stored config's.
    it('should refuse the name of a stored config', async () => {

        await storeConfig('prod');

        const [ctx, err] = await attempt(() => open({ config: false, name: 'prod', connection: scratch() }));

        expect(ctx).toBeNull();
        expect(err?.message).toContain('a stored config is named "prod"');

    });

    // The stored-name refusal must look at stored configs only, not at names every object inherits.
    it('should accept a name that only matches an inherited object member', async () => {

        const ctx = await open({ config: false, name: 'constructor', connection: scratch() });

        expect(ctx.noorm.config.name).toBe('constructor');

    });

    // On a trusted test config every role reads the admin cells, so a name must not be able to select one.
    it('should not become a trusted test context by taking the name of an isTest stage', async () => {

        await setStage('ci', { isTest: true });

        const named = await open({ name: 'ci', channel: 'agent', connection: scratch() });
        const staged = await open({ stage: 'ci', channel: 'agent', connection: scratch() });

        expect(named.noorm.config.isTest).toBe(false);
        expect(getConfigPermission('agent', named.noorm.config, 'db:destroy')).toBe('deny');
        expect(getConfigPermission('agent', named.noorm.config, 'run:build')).toBe('deny');
        expect(getConfigPermission('agent', staged.noorm.config, 'db:destroy')).toBe('allow');

    });

    it('should not take credentials, TLS or access from a stage the context is named after', async () => {

        await setStage('dev', { user: 'stage-user', password: 'stage-pw', ssl: false, access: { user: 'admin', agent: 'admin' } });

        const { config } = (await open({ name: 'dev', channel: 'agent', connection: scratch() })).noorm;

        expect(config.connection.user).toBeUndefined();
        expect(config.connection.password).toBeUndefined();
        expect(config.connection.ssl).toBeUndefined();
        expect({ ...config.access }).toEqual({ user: 'admin', agent: 'viewer' });

    });

    it('should keep the stricter access of the NOORM_NAME stage it displaces', async () => {

        await setStage('staging', { access: { user: 'viewer', agent: false } });
        process.env['NOORM_NAME'] = 'staging';

        const { config } = (await open({ name: 'reporting', connection: scratch() })).noorm;

        expect({ ...config.access }).toEqual({ user: 'viewer', agent: false });

    });

    // Pins that the name keys tracking records: a renamed context sees none of the history written under the old name.
    it('should not see changes applied under another name on the same database', async () => {

        const change = join(root, 'db', 'changes', '2026-01-01-add-gadget', 'change');
        await mkdir(change, { recursive: true });
        await writeFile(join(change, '001_gadget.sql'), 'CREATE TABLE gadget (id INTEGER PRIMARY KEY);');
        const first = await open({ connection: scratch() });
        await first.connect();
        await first.noorm.changes.ff();
        const renamed = await open({ name: 'orders', connection: scratch() });
        await renamed.connect();

        expect(await first.noorm.changes.pending()).toHaveLength(0);
        expect(await renamed.noorm.changes.pending()).toHaveLength(1);

    });

});

describe('sdk: createContext config: false', () => {

    const connection = { dialect: 'sqlite' as const, database: ':memory:' };

    // A service can inherit NOORM_CONFIG for a stored config its checkout does not have.
    it('should resolve a complete inline connection when NOORM_CONFIG names a missing stored config', async () => {

        process.env['NOORM_CONFIG'] = 'dev';

        const [, inherited] = await attempt(() => open({ connection }));
        const ctx = await open({ config: false, connection });

        expect(inherited?.message).toBe('Config "dev" not found');
        expect(ctx.noorm.config.name).toBe('__inline__');
        expect(ctx.noorm.config.connection.database).toBe(':memory:');

    });

    it('should ignore the active stored config', async () => {

        await storeConfig('dev');
        const state = new StateManager(root);
        await state.load();
        await state.setActiveConfig('dev');
        process.env['NOORM_CONNECTION_DIALECT'] = 'sqlite';
        process.env['NOORM_CONNECTION_DATABASE'] = ':memory:';

        const ctx = await open({ config: false });

        expect(ctx.noorm.config.name).toBe('__env__');
        expect(ctx.noorm.config.connection.database).toBe(':memory:');

    });

    it('should say what is missing when no connection is supplied', async () => {

        await storeConfig('dev');
        process.env['NOORM_CONFIG'] = 'dev';

        const [ctx, err] = await attempt(() => open({ config: false }));

        expect(ctx).toBeNull();
        expect(err?.message).toContain('config: false');
        expect(err?.message).toContain('NOORM_CONNECTION_DIALECT');

    });

});

describe('sdk: createContext connection.driver', () => {

    const driver = { keepAliveInitialDelayMillis: 5000, log: () => undefined };

    // Driver options can hold functions and sockets, so they travel beside the config, never in it.
    it('should hand driver options to the connection without putting them in the resolved config', async () => {

        const createConnection = spyOn(connectionFactory, 'createConnection').mockResolvedValue({
            db: {} as never,
            dialect: 'postgres',
            destroy: async () => undefined,
        });

        const [ctx, err] = await attempt(async () => {

            const opened = await open({ connection: { dialect: 'postgres', database: 'app', host: 'db.example.com', driver } });
            await opened.connect();

            return opened;

        });
        const [config, , , , runtime] = createConnection.mock.calls[0] ?? [];
        createConnection.mockRestore();

        expect(err).toBeNull();
        expect(runtime).toMatchObject({ driver });
        expect(config).not.toHaveProperty('driver');
        expect(ctx?.noorm.config.connection).not.toHaveProperty('driver');

    });

    // Trusted isTest is bound to the resolved target, so a driver object must not be able to redirect the connection.
    it('should refuse a driver option that selects the target before any connection is made', async () => {

        const [, err] = await attempt(() => open({
            connection: { dialect: 'postgres', database: 'app', host: 'db.example.com', driver: { host: 'elsewhere.example.com' } },
        }));

        expect(err?.message).toContain('driver.host is not allowed on postgres');

    });

    it('should refuse driver options on SQLite when the context is created', async () => {

        const [, err] = await attempt(() => open({ connection: { dialect: 'sqlite', database: ':memory:', driver: {} } }));

        expect(err?.message).toBe('Driver options are not supported for SQLite');

    });

    it('should carry inline pool options into the resolved config', async () => {

        const pool = { max: 4, idleTimeoutMillis: 250 };
        const ctx = await open({ connection: { dialect: 'postgres', database: 'app', pool } });

        expect(ctx.noorm.config.connection.pool).toMatchObject(pool);

    });

    it.each([['an array', []], ['a string', 'ssl=true'], ['null', null]])('should reject %s as driver options', async (_label, value) => {

        const [ctx, err] = await attempt(() => open({
            connection: { dialect: 'postgres', database: 'app', driver: value as never },
        }));

        expect(ctx).toBeNull();
        expect(err?.message).toBe('connection.driver must be an object of driver options');

    });

});

describe('sdk: exports', () => {

    // Consumers catch connection failures with instanceof, which needs the class the core throws.
    it('should export the DatabaseConnectionError class the connection layer throws', () => {

        expect(DatabaseConnectionError).toBe(CoreDatabaseConnectionError);

    });

});
