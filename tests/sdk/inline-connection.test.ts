import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';
import { createContext, SslFileError, type Context } from '../../src/sdk/index.js';
import { RequireTestError } from '../../src/sdk/guards.js';
import { createConnection } from '../../src/core/connection/factory.js';
import { DatabaseConnectionError } from '../../src/core/connection/errors.js';
import { createMysqlConnection } from '../../src/core/connection/dialects/mysql.js';
import { createMssqlConnection } from '../../src/core/connection/dialects/mssql.js';
import { getStateManager, resetStateManager } from '../../src/core/state/index.js';
import { generateKeyPair } from '../../src/core/identity/index.js';
import { clearKeyOverride, setKeyOverride } from '../../src/core/identity/storage.js';
import { observer, type NoormEvents } from '../../src/core/observer.js';
import { getPolicyContext, policyTargetIdentity } from '../../src/core/policy/index.js';

describe('inline connections', () => {

    let inlineRoot: string | undefined;
    const inlineContexts: Context[] = [];

    afterEach(async () => {

        if (!inlineRoot) return;

        await Promise.all(inlineContexts.map((ctx) => ctx.disconnect()));
        resetStateManager();
        await rm(inlineRoot, { recursive: true, force: true });

        inlineRoot = undefined;
        inlineContexts.length = 0;

    });

    it('binds fresh inline contexts while retaining runtime connection options', async () => {

        inlineRoot = await mkdtemp(join(tmpdir(), 'noorm-inline-fresh-'));
        const verify = () => undefined;
        const ctx = await createContext({
            projectRoot: inlineRoot,
            freshState: true,
            connection: {
                dialect: 'postgres', database: 'app', host: 'db.example.com',
                password: () => 'token',
                ssl: { rejectUnauthorized: true, checkServerIdentity: verify },
                tlsServerName: 'cert.example.com',
                statementTimeoutMs: 1234,
                applicationName: 'service',
                pool: { max: 4, idleTimeoutMillis: 250 },
            },
        });
        inlineContexts.push(ctx);
        expect(ctx.noorm.config.connection).toMatchObject({
            dialect: 'postgres', database: 'app', host: 'db.example.com',
            ssl: { rejectUnauthorized: true }, tlsServerName: 'cert.example.com',
            statementTimeoutMs: 1234, applicationName: 'service',
            pool: { max: 4, idleTimeoutMillis: 250 },
        });
        expect(ctx.noorm.config.connection.password).toBeUndefined();
        expect(getPolicyContext(ctx.noorm.config.access)?.targetIdentity)
            .toBe(policyTargetIdentity(inlineRoot, ctx.noorm.config.connection));

    });

    it('rejects connect() with an SslFileError from the SDK entry point for an unreadable caFile', async () => {

        inlineRoot = await mkdtemp(join(tmpdir(), 'noorm-inline-ssl-'));

        const caFile = join(inlineRoot, 'missing-ca.pem');
        const ctx = await createContext({
            projectRoot: inlineRoot,
            freshState: true,
            connection: { dialect: 'postgres', database: 'app', host: '127.0.0.1', port: 1, ssl: { caFile } },
        });
        inlineContexts.push(ctx);

        const [, err] = await attempt(() => ctx.connect({ retries: 1, delay: 0 }));

        expect(err).toBeInstanceOf(SslFileError);
        expect(err?.message).toContain('ssl.caFile');

    });

    it('opens independent databases without stored state', async () => {

        const root = await mkdtemp(join(tmpdir(), 'noorm-inline-'));
        inlineRoot = root;
        resetStateManager();

        const [a, b] = await Promise.all([
            createContext({ projectRoot: root, connection: { dialect: 'sqlite', database: join(root, 'a.db') } }),
            createContext({ projectRoot: root, connection: { dialect: 'sqlite', database: join(root, 'b.db') } }),
        ]);
        inlineContexts.push(a, b);
        await Promise.all([a.connect(), b.connect()]);

        await sql`CREATE TABLE only_a (id integer)`.execute(a.kysely);
        const result = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE name = 'only_a'`.execute(b.kysely);
        expect(result.rows).toHaveLength(0);
        expect(a.noorm.config.name).toBe('__inline__');

        await expect(createContext({ projectRoot: root, connection: { dialect: 'sqlite' } })).rejects.toThrow();
        await expect(createContext({
            projectRoot: root,
            connection: { dialect: 'sqlite', database: ':memory:', password: () => 'secret' },
        })).rejects.toThrow('not supported for SQLite');
        await expect(createConnection(
            { dialect: 'sqlite', database: ':memory:' },
            '__test__',
            { retries: 1 },
            undefined,
            { password: () => 'secret' },
        )).rejects.toThrow('not supported for SQLite');
        await expect(createContext({
            projectRoot: root, requireTest: true, connection: { dialect: 'sqlite', database: ':memory:' },
        })).rejects.toThrow();

    });

    it('refuses inherited test clearance when an active stored config targets another database', async () => {

        const root = await mkdtemp(join(tmpdir(), 'noorm-inline-active-'));
        inlineRoot = root;
        const originalEnv = { ...process.env };
        for (const key of Object.keys(process.env)) {

            if (key.startsWith('NOORM_')) delete process.env[key];

        }
        resetStateManager();
        setKeyOverride(generateKeyPair().privateKey);

        const [, err] = await attempt(async () => {

            const state = getStateManager(root);
            await state.load();
            await state.setConfig('test', {
                name: 'test',
                type: 'remote',
                isTest: true,
                access: { user: 'admin', agent: 'admin' },
                connection: { dialect: 'sqlite', database: join(root, 'stored-test.db') },
            });
            await state.setActiveConfig('test');

            const connection = { dialect: 'sqlite' as const, database: join(root, 'app.db') };
            await expect(createContext({
                projectRoot: root,
                connection,
                requireTest: true,
            })).rejects.toBeInstanceOf(RequireTestError);

            const ctx = await createContext({ projectRoot: root, connection });
            inlineContexts.push(ctx);
            expect(ctx.noorm.config.name).toBe('__inline__');
            expect(ctx.noorm.config.isTest).toBe(false);
            expect(ctx.noorm.config.access).not.toEqual(state.getConfig('test')!.access);

        });

        for (const key of Object.keys(process.env)) {

            if (key.startsWith('NOORM_')) delete process.env[key];

        }
        Object.assign(process.env, originalEnv);
        clearKeyOverride();

        if (err) throw err;

    });

    it('keeps rotating credentials out of resolved configuration', async () => {

        const root = await mkdtemp(join(tmpdir(), 'noorm-inline-credentials-'));
        resetStateManager();

        try {

            for (const dialect of ['postgres', 'mysql', 'mssql'] as const) {

                const ctx = await createContext({
                    projectRoot: root,
                    connection: { dialect, database: 'app', password: () => 'token' },
                });

                expect(ctx.noorm.config.connection.password).toBeUndefined();

            }

        }
        finally {

            resetStateManager();
            await rm(root, { recursive: true, force: true });

        }

    });

    it('removes shadowed stored and environment passwords without changing persisted state', async () => {

        const root = await mkdtemp(join(tmpdir(), 'noorm-inline-shadowed-'));
        const originalEnv = { ...process.env };

        for (const key of Object.keys(process.env)) {

            if (key.startsWith('NOORM_')) delete process.env[key];

        }

        resetStateManager();
        setKeyOverride(generateKeyPair().privateKey);

        const [, err] = await attempt(async () => {

            const state = getStateManager(root);
            await state.load();

            for (const dialect of ['postgres', 'mysql', 'mssql'] as const) {

                await state.setConfig(dialect, {
                    name: dialect,
                    type: 'local',
                    isTest: true,
                    access: { user: 'admin', agent: 'admin' },
                    connection: { dialect, database: 'app_test', password: 'stored-secret' },
                });

                for (const envPassword of [undefined, 'environment-secret']) {

                    if (envPassword === undefined) {

                        delete process.env['NOORM_CONNECTION_PASSWORD'];

                    }
                    else {

                        process.env['NOORM_CONNECTION_PASSWORD'] = envPassword;

                    }

                    const ctx = await createContext({
                        projectRoot: root,
                        config: dialect,
                        connection: { password: () => 'runtime-token' },
                    });

                    expect(ctx.noorm.config.connection).not.toHaveProperty('password');
                    expect(state.getConfig(dialect)?.connection.password).toBe('stored-secret');

                }

            }

            // Reload the encrypted state rather than only checking the cached object.
            resetStateManager();
            const reloaded = getStateManager(root);
            await reloaded.load();

            for (const dialect of ['postgres', 'mysql', 'mssql'] as const) {

                expect(reloaded.getConfig(dialect)?.connection.password).toBe('stored-secret');

            }

            process.env['NOORM_CONNECTION_PASSWORD'] = 'environment-secret';
            const envOnly = await createContext({
                projectRoot: root,
                connection: { dialect: 'mysql', database: 'app_test', password: () => 'runtime-token' },
            });

            expect(envOnly.noorm.config.connection).not.toHaveProperty('password');

        });

        for (const key of Object.keys(process.env)) {

            if (key.startsWith('NOORM_')) delete process.env[key];

        }

        Object.assign(process.env, originalEnv);
        clearKeyOverride();
        resetStateManager();
        await rm(root, { recursive: true, force: true });

        if (err) throw err;

    });

    it('propagates MySQL and SQL Server credential errors without retries or translation', async () => {

        for (const dialect of ['mysql', 'mssql'] as const) {

            const config = { dialect, database: 'app' };
            const failure = Object.assign(new Error('credential source failed'), { code: 'ECONNREFUSED' });
            let calls = 0;
            const runtime = { password: async () => {

                calls++;
                throw failure;

            } };

            if (dialect === 'mysql') {

                const conn = await createMysqlConnection(config, runtime);

                try {

                    await expect(sql`SELECT 1`.execute(conn.db)).rejects.toBe(failure);
                    await expect(sql`SELECT 1`.execute(conn.db)).rejects.toBe(failure);
                    expect(calls).toBe(2);

                }
                finally {

                    await conn.destroy();

                }

            }
            else {

                await expect(createMssqlConnection(config, runtime)).rejects.toBe(failure);
                expect(calls).toBe(1);

            }

            calls = 0;
            await expect(createConnection(config, '__test__', { retries: 3, delay: 0 }, undefined, runtime)).rejects.toBe(failure);
            expect(calls).toBe(1);

        }

    });

    it('preserves runtime failures while sanitizing observer payloads', async () => {

        const root = await mkdtemp(join(tmpdir(), 'noorm-inline-error-'));
        resetStateManager();
        const events: NoormEvents['connection:error'][] = [];
        const stop = observer.on('connection:error', (event) => {

            events.push(event);

        });
        const [, err] = await attempt(async () => {

            for (const dialect of ['mysql', 'mssql'] as const) {

                const secret = `private-${dialect}-provider-token`;
                const failure = dialect === 'mysql'
                    ? Object.assign(new Error(`credential provider failed: ${secret}`), { code: 'ECONNREFUSED' })
                    : new DatabaseConnectionError(`credential provider failed: ${secret}`, secret, secret);
                let calls = 0;
                const ctx = await createContext({
                    projectRoot: root,
                    connection: { dialect, database: 'app', password: () => {

                        calls++;
                        throw failure;

                    } },
                });

                events.length = 0;
                await expect(ctx.connect({ retries: 3, delay: 0 })).rejects.toBe(failure);
                expect(calls).toBe(1);
                expect(events).toEqual([{
                    configName: '__inline__',
                    error: 'Runtime credential connection failed',
                }]);
                expect(JSON.stringify(events)).not.toContain(secret);
                await ctx.disconnect();

            }

        });

        stop();
        resetStateManager();
        await rm(root, { recursive: true, force: true });

        if (err) throw err;

    });

});
