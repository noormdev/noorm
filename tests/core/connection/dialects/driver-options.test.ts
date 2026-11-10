/**
 * The option objects noorm hands each driver.
 *
 * These assert precedence: noorm defaults, then flat config fields, then the
 * typed `pool`, then `driver`, then the keys noorm owns. The last step is the
 * one that matters for safety: `driver` must never replace the connection
 * target, the connect timeout, or the pool size noorm computed.
 */
import { describe, it, expect } from 'bun:test';

import { attemptSync } from '@logosdx/utils';
import mysql2 from 'mysql2';
import * as Tarn from 'tarn';

import { buildTediousOptions } from '../../../../src/core/connection/dialects/mssql.js';
import { buildMysqlOptions } from '../../../../src/core/connection/dialects/mysql.js';
import { buildPostgresPoolOptions } from '../../../../src/core/connection/dialects/postgres.js';
import type { ConnectionConfig } from '../../../../src/core/connection/types.js';

const target = { host: 'db.example.com', port: 6000, user: 'app', password: 'secret', database: 'app_test' };

describe('connection: postgres pool options', () => {

    const config: ConnectionConfig = { dialect: 'postgres', ...target };

    it('should map the typed pool and keepalive delay onto the pg Pool config', () => {

        const options = buildPostgresPoolOptions({
            ...config,
            keepAliveInitialDelayMs: 10_000,
            pool: { min: 1, max: 4, idleTimeoutMs: 5_000, maxLifetimeMs: 60_000, maxUses: 50, allowExitOnIdle: true },
        });

        expect(options).toMatchObject({
            min: 1,
            max: 4,
            idleTimeoutMillis: 5_000,
            maxLifetimeSeconds: 60,
            maxUses: 50,
            allowExitOnIdle: true,
            keepAlive: true,
            keepAliveInitialDelayMillis: 10_000,
        });

    });

    it('should leave keepalive off when keepAlive is false, even with a delay configured', () => {

        expect(buildPostgresPoolOptions({ ...config, keepAlive: false, keepAliveInitialDelayMs: 10_000 }).keepAlive).toBe(false);

    });

    it('should let driver override flat fields and the typed pool', () => {

        const options = buildPostgresPoolOptions(
            { ...config, applicationName: 'flat', pool: { idleTimeoutMs: 5_000, maxUses: 50 } },
            { driver: { application_name: 'driver', idleTimeoutMillis: 1, maxUses: 2, lock_timeout: 500 } },
        );

        expect(options).toMatchObject({ application_name: 'driver', idleTimeoutMillis: 1, maxUses: 2, lock_timeout: 500 });

    });

    it('should keep the pool size and connect timeout noorm computed when driver names them', () => {

        const options = buildPostgresPoolOptions(
            { ...config, connectTimeoutMs: 3_000, pool: { min: 1, max: 4 } },
            { driver: { min: 9, max: 99, connectionTimeoutMillis: 0 } },
        );

        expect(options).toMatchObject({ min: 1, max: 4, connectionTimeoutMillis: 3_000, host: 'db.example.com', port: 6000 });

    });

    it('should reject a pool option PostgreSQL cannot honor before any pool exists', () => {

        const [, err] = attemptSync(() => buildPostgresPoolOptions({ ...config, pool: { acquireTimeoutMs: 1_000 } }));

        expect(err?.message).toContain('pool.acquireTimeoutMs');

    });

    it('should reject a driver key that selects the target', () => {

        const [, err] = attemptSync(() => buildPostgresPoolOptions(config, { driver: { host: 'elsewhere.example.com' } }));

        expect(err?.message).toContain('driver.host');

    });

});

describe('connection: mysql options', () => {

    const config: ConnectionConfig = { dialect: 'mysql', ...target };

    it('should map the typed pool onto Tarn and the keepalive delay onto mysql2', () => {

        const options = buildMysqlOptions({
            ...config,
            keepAliveInitialDelayMs: 10_000,
            pool: { min: 1, max: 4, idleTimeoutMs: 5_000, acquireTimeoutMs: 1_000, createTimeoutMs: 2_000, reapIntervalMs: 500 },
        });

        expect(options.pool).toEqual({
            min: 1,
            max: 4,
            propagateCreateError: true,
            idleTimeoutMillis: 5_000,
            acquireTimeoutMillis: 1_000,
            createTimeoutMillis: 2_000,
            reapIntervalMillis: 500,
        });
        expect(options.connection).toMatchObject({ enableKeepAlive: true, keepAliveInitialDelay: 10_000 });

    });

    it('should leave keepalive off when keepAlive is false, even with a delay configured', () => {

        // mysql2 turns keepalive on unless told otherwise, so the flag has to be passed, not just the delay withheld.
        const options = buildMysqlOptions({ ...config, keepAlive: false, keepAliveInitialDelayMs: 10_000 });

        expect(new mysql2.ConnectionConfig(options.connection).enableKeepAlive).toBe(false);

    });

    it('should give Tarn longer than a connect timeout above its 30 second default', async () => {

        // A database resuming from auto-pause is the documented reason to raise connectTimeoutMs past 30 seconds.
        const { pool } = buildMysqlOptions({ ...config, connectTimeoutMs: 60_000 });
        const tarn = new Tarn.Pool({ ...pool, create: async () => ({}), destroy: () => undefined });

        expect(tarn.createTimeoutMillis).toBeGreaterThan(60_000);
        expect(tarn.acquireTimeoutMillis).toBeGreaterThan(60_000);

        await tarn.destroy();

    });

    it('should never put the password in the shared options, since each login resolves its own', () => {

        expect(buildMysqlOptions(config).connection).not.toHaveProperty('password');

    });

    it('should let driver override flat fields but not the target or connect timeout', () => {

        const options = buildMysqlOptions(
            { ...config, connectTimeoutMs: 3_000, keepAliveInitialDelayMs: 10_000 },
            { driver: { keepAliveInitialDelay: 1, connectTimeout: 1, timezone: 'Z' } },
        );

        expect(options.connection).toMatchObject({
            keepAliveInitialDelay: 1,
            timezone: 'Z',
            connectTimeout: 3_000,
            host: 'db.example.com',
            port: 6000,
            database: 'app_test',
        });

    });

    it('should reject a pool option MySQL cannot honor before any pool exists', () => {

        const [, err] = attemptSync(() => buildMysqlOptions({ ...config, pool: { maxUses: 1 } }));

        expect(err?.message).toContain('pool.maxUses');

    });

    it('should reject a driver key that selects the target', () => {

        const [, err] = attemptSync(() => buildMysqlOptions(config, { driver: { socketPath: '/tmp/other.sock' } }));

        expect(err?.message).toContain('driver.socketPath');

    });

});

describe('connection: mssql options', () => {

    const config: ConnectionConfig = { dialect: 'mssql', ...target };

    it('should merge driver into the tedious options block without replacing what noorm owns', () => {

        const { options } = buildTediousOptions(
            { ...config, connectTimeoutMs: 3_000 },
            { driver: { appName: 'reports', connectTimeout: 1, requestTimeout: 30_000 } },
        );

        expect(options).toMatchObject({
            appName: 'reports',
            requestTimeout: 30_000,
            connectTimeout: 3_000,
            port: 6000,
            database: 'app_test',
            encrypt: true,
        });

    });

    it('should reject a driver key that weakens TLS', () => {

        const [, err] = attemptSync(() => buildTediousOptions(config, { driver: { trustServerCertificate: true } }));

        expect(err?.message).toContain('driver.trustServerCertificate');

    });

    it('should reject keepAliveInitialDelayMs, because tedious fixes its own keepalive delay', () => {

        const [, err] = attemptSync(() => buildTediousOptions({ ...config, keepAliveInitialDelayMs: 10_000 }));

        expect(err?.message).toContain('keepAliveInitialDelayMs');

    });

});
