/**
 * Pool and driver option rules shared by the config schema and the dialect
 * adapters.
 *
 * These exist because an option the dialect cannot honor used to be dropped
 * silently, and because `driver` is caller-supplied: a trusted config's access
 * is bound to the target noorm resolved, so nothing in `driver` may move the
 * connection or weaken its TLS.
 */
import { describe, it, expect } from 'bun:test';

import { attemptSync } from '@logosdx/utils';
import mysql2 from 'mysql2';
import pg from 'pg';
import { Connection as TediousConnection } from 'tedious';

import { buildTediousOptions } from '../../../src/core/connection/dialects/mssql.js';
import { buildMysqlOptions } from '../../../src/core/connection/dialects/mysql.js';
import { buildPostgresPoolOptions } from '../../../src/core/connection/dialects/postgres.js';
import {
    assertConnectionOptions,
    connectionOptionProblems,
    driverOptionsFor,
    pgPoolOptions,
    tarnPoolOptions,
} from '../../../src/core/connection/options.js';

describe('connection: pool option mapping', () => {

    it('should map the PostgreSQL pool options to pg-pool names, converting lifetime to seconds', () => {

        expect(pgPoolOptions({ idleTimeoutMs: 5_000, maxLifetimeMs: 60_000, maxUses: 100, allowExitOnIdle: true })).toEqual({
            idleTimeoutMillis: 5_000,
            maxLifetimeSeconds: 60,
            maxUses: 100,
            allowExitOnIdle: true,
        });

    });

    it('should convert a fractional-second lifetime exactly, since pg-pool multiplies it back to milliseconds', () => {

        expect(pgPoolOptions({ maxLifetimeMs: 1_500 }).maxLifetimeSeconds).toBe(1.5);

    });

    it('should map the Tarn pool options to Tarn names', () => {

        const pool = { min: 1, max: 4, idleTimeoutMs: 5_000, acquireTimeoutMs: 1_000, createTimeoutMs: 2_000, reapIntervalMs: 500 };

        expect(tarnPoolOptions({ pool })).toEqual({
            min: 1,
            max: 4,
            propagateCreateError: true,
            idleTimeoutMillis: 5_000,
            acquireTimeoutMillis: 1_000,
            createTimeoutMillis: 2_000,
            reapIntervalMillis: 500,
        });

    });

    it('should keep accepting pool.idleTimeoutMillis, the name stored configs already use', () => {

        expect(pgPoolOptions({ idleTimeoutMillis: 0 }).idleTimeoutMillis).toBe(0);
        expect(tarnPoolOptions({ pool: { idleTimeoutMillis: 7_000 } }).idleTimeoutMillis).toBe(7_000);

    });

    it('should keep Tarn waiting longer than a connect timeout above its own 30 second default', () => {

        // Tarn gives up on a create or a checkout after 30 seconds unless told
        // otherwise, which would cut off a database resuming from auto-pause.
        const options = tarnPoolOptions({ connectTimeoutMs: 60_000 });

        expect(options.createTimeoutMillis).toBeGreaterThan(60_000);
        expect(options.acquireTimeoutMillis).toBeGreaterThan(60_000);

    });

    it('should not shorten Tarn\'s 30 second default for an ordinary connect timeout', () => {

        const options = tarnPoolOptions({ connectTimeoutMs: 5_000 });

        expect(options.createTimeoutMillis).toBe(30_000);
        expect(options.acquireTimeoutMillis).toBe(30_000);

    });

});

describe('connection: option validation', () => {

    it('should accept the alias and the new name together when they agree', () => {

        expect(connectionOptionProblems({ dialect: 'postgres', pool: { idleTimeoutMs: 5, idleTimeoutMillis: 5 } })).toEqual([]);

    });

    it('should reject the alias and the new name when they differ, since either could be the intended one', () => {

        const problems = connectionOptionProblems({ dialect: 'postgres', pool: { idleTimeoutMs: 5, idleTimeoutMillis: 6 } });

        expect(problems).toHaveLength(1);
        expect(problems[0]!.path).toEqual(['pool', 'idleTimeoutMs']);
        expect(problems[0]!.message).toContain('pool.idleTimeoutMs');
        expect(problems[0]!.message).toContain('pool.idleTimeoutMillis');

    });

    it.each([
        ['mysql', 'maxUses', 1],
        ['mysql', 'maxLifetimeMs', 1_000],
        ['mssql', 'allowExitOnIdle', true],
        ['postgres', 'acquireTimeoutMs', 1_000],
        ['postgres', 'createTimeoutMs', 1_000],
        ['postgres', 'reapIntervalMs', 1_000],
        ['sqlite', 'idleTimeoutMs', 1_000],
        ['sqlite', 'maxUses', 1],
    ] as const)('should reject on %s the pool option %s it cannot honor', (dialect, option, value) => {

        const problems = connectionOptionProblems({ dialect, pool: { [option]: value } });

        expect(problems.map((p) => p.path)).toEqual([['pool', option]]);
        expect(problems[0]!.message).toContain(`pool.${option}`);
        expect(problems[0]!.message).toContain(dialect);

    });

    it('should accept a PostgreSQL lifetime that is not whole seconds', () => {

        expect(connectionOptionProblems({ dialect: 'postgres', pool: { maxLifetimeMs: 1_500 } })).toEqual([]);

    });

    it('should accept the legacy idle timeout alias on sqlite as unused, since configs written for every dialect carry it', () => {

        expect(connectionOptionProblems({ dialect: 'sqlite', pool: { min: 0, max: 10, idleTimeoutMillis: 30_000 } })).toEqual([]);

    });

    it.each(['postgres', 'mysql', 'mssql'] as const)('should reject on %s a pool.min above pool.max, naming both values', (dialect) => {

        const problems = connectionOptionProblems({ dialect, pool: { min: 5, max: 2 } });

        expect(problems.map((p) => p.path)).toEqual([['pool', 'min']]);
        expect(problems[0]!.message).toContain('pool.min (5)');
        expect(problems[0]!.message).toContain('pool.max (2)');

    });

    it('should name the camelCase spelling for a pool key that differs from a real one only by case', () => {

        // The env reader lowercases an all-caps segment, so NOORM_CONNECTION_POOL_MAXUSES arrives as `maxuses`.
        const problems = connectionOptionProblems({ dialect: 'postgres', pool: { maxuses: 5 } as Record<string, unknown> });

        expect(problems.map((p) => p.path)).toEqual([['pool', 'maxuses']]);
        expect(problems[0]!.message).toContain('pool.maxUses');
        expect(problems[0]!.message).toContain('NOORM_CONNECTION_POOL_maxUses');

    });

    it('should reject an unknown pool key even when the dialect is not known yet', () => {

        const problems = connectionOptionProblems({ pool: { bogus: true } as Record<string, unknown> });

        expect(problems.map((p) => p.path)).toEqual([['pool', 'bogus']]);
        expect(problems[0]!.message).toContain('pool.bogus');

    });

    it('should reject a zero idle timeout on Tarn pools, which cannot disable it', () => {

        expect(connectionOptionProblems({ dialect: 'mysql', pool: { idleTimeoutMs: 0 } })).toHaveLength(1);
        expect(connectionOptionProblems({ dialect: 'mssql', pool: { idleTimeoutMillis: 0 } })).toHaveLength(1);
        expect(connectionOptionProblems({ dialect: 'postgres', pool: { idleTimeoutMs: 0 } })).toEqual([]);

    });

    it.each(['mssql', 'sqlite'] as const)('should reject keepAliveInitialDelayMs on %s, which has no such control', (dialect) => {

        const problems = connectionOptionProblems({ dialect, keepAliveInitialDelayMs: 10_000 });

        expect(problems.map((p) => p.path)).toEqual([['keepAliveInitialDelayMs']]);
        expect(problems[0]!.message).toContain(dialect);

    });

    it('should throw the first problem so an adapter never opens a pool with an ignored option', () => {

        const [, err] = attemptSync(() => assertConnectionOptions({ dialect: 'mysql', database: 'app_test', pool: { maxUses: 1 } }));

        expect(err?.message).toContain('pool.maxUses');
        expect(() => assertConnectionOptions({ dialect: 'mysql', database: 'app_test', pool: { min: 1, max: 2 } })).not.toThrow();

    });

});

describe('connection: driver options', () => {

    it('should return an empty object when no driver options were given', () => {

        expect(driverOptionsFor('postgres', undefined)).toEqual({});
        expect(driverOptionsFor('mysql', {})).toEqual({});

    });

    it('should pass through keys that do not select the target, credentials, or TLS', () => {

        expect(driverOptionsFor('postgres', { driver: { lock_timeout: 500 } })).toEqual({ lock_timeout: 500 });

    });

    it('should name the key and the dialect when it rejects one', () => {

        const [, err] = attemptSync(() => driverOptionsFor('mysql', { driver: { socketPath: '/tmp/other.sock' } }));

        expect(err?.message).toContain('driver.socketPath is not allowed on mysql');

    });

});

/**
 * A trusted config's access is bound to the target noorm resolved, so these
 * read the target, the credentials, and the TLS settings back from the driver
 * itself. Checking the reject list against a copy of itself would pass for
 * any list.
 */
describe('connection: driver options cannot retarget the connection', () => {

    const trusted = { host: 'db.trusted.example', port: 6000, user: 'app', password: 'secret', database: 'app_test', ssl: true };
    const hostileTransport = { hostile: true };
    const evil = {
        host: 'evil.example',
        port: 6543,
        database: 'otherdb',
        user: 'attacker',
        password: 'attacker-password',
        connectionString: 'postgres://attacker:pw@evil.example:6543/otherdb?sslmode=disable',
        ssl: false,
    };

    /** What the driver would connect to, log in as, and verify, read from its own config object. */
    const reached = {
        postgres(driver?: Record<string, unknown>) {

            class NoormClient extends pg.Client {}

            const options = buildPostgresPoolOptions({ dialect: 'postgres', ...trusted }, { driver });
            const pool = new pg.Pool({ ...options, Client: NoormClient }) as pg.Pool & { Client: typeof pg.Client; options: pg.PoolConfig };
            const client = new pool.Client(pool.options) as pg.Client & { connection: { stream: unknown } };

            return {
                host: client.host,
                port: client.port,
                database: client.database,
                user: client.user,
                password: client.password,
                ssl: client.ssl,
                noormClient: client instanceof NoormClient,
                suppliedTransport: client.connection === hostileTransport || client.connection.stream === hostileTransport,
            };

        },
        mysql(driver?: Record<string, unknown>) {

            const { connection } = buildMysqlOptions({ dialect: 'mysql', ...trusted }, { driver });
            const config = new mysql2.ConnectionConfig({ ...connection, password: trusted.password }) as unknown as Record<string, unknown>;
            const keys = [
                'host', 'port', 'database', 'user', 'password', 'password2', 'password3', 'passwordSha1', 'ssl',
                'socketPath', 'stream', 'authPlugins', 'authSwitchHandler', 'isServer', 'clientFlags',
            ];

            return Object.fromEntries(keys.map((key) => [key, config[key]]));

        },
        mssql(driver?: Record<string, unknown>) {

            const { config } = new TediousConnection(buildTediousOptions({ dialect: 'mssql', ...trusted }, { driver }));
            const { port, database, instanceName, encrypt, trustServerCertificate, serverName } = config.options;
            const { cryptoCredentialsDetails, connector, fallbackToDefaultDb } = config.options;

            return {
                server: config.server,
                authentication: config.authentication,
                port,
                database,
                instanceName,
                encrypt,
                trustServerCertificate,
                serverName,
                cryptoCredentialsDetails,
                connector,
                fallbackToDefaultDb,
            };

        },
    };

    const hostile: Record<keyof typeof reached, Record<string, unknown>> = {
        postgres: {
            ...evil,
            Client: class extends pg.Client {},
            stream: hostileTransport,
            connection: hostileTransport,
        },
        mysql: {
            ...evil,
            ssl: 'Amazon RDS',
            uri: 'mysql://attacker:pw@evil.example:6543/otherdb',
            socketPath: '/tmp/evil.sock',
            stream: hostileTransport,
            password1: 'attacker-password',
            password2: 'second-factor',
            password3: 'third-factor',
            passwordSha1: Buffer.from('attacker'),
            authPlugins: { mysql_native_password: () => () => Buffer.from('attacker') },
            authSwitchHandler: () => undefined,
            flags: '-CONNECT_WITH_DB',
            isServer: true,
        },
        mssql: {
            ...evil,
            server: 'evil.example',
            authentication: { type: 'default', options: { userName: 'attacker', password: 'attacker-password' } },
            instanceName: 'EVIL',
            connector: async () => hostileTransport,
            serverName: 'evil.example',
            encrypt: false,
            trustServerCertificate: true,
            cryptoCredentialsDetails: { rejectUnauthorized: false },
            fallbackToDefaultDb: true,
        },
    };

    /** The shape `JSON.parse('{"__proto__":{...}}')` produces: an own key that spreads and `Object.assign` turn into a prototype. */
    const ownProtoKey = (value: Record<string, unknown>) =>
        Object.defineProperty({}, '__proto__', { value, enumerable: true, configurable: true, writable: true }) as Record<string, unknown>;

    describe.each(['postgres', 'mysql', 'mssql'] as const)('on %s', (dialect) => {

        const untouched = reached[dialect]();

        function expectUntouched(driver: Record<string, unknown>): void {

            const [view, err] = attemptSync(() => reached[dialect](driver));

            if (err) expect(err.message).toContain(`is not allowed on ${dialect}`);
            else expect(view).toEqual(untouched);

        }

        it.each(Object.keys(hostile[dialect]))('should connect to the configured target or refuse when driver sets %s', (key) => {

            expectUntouched({ [key]: hostile[dialect][key] });

        });

        it('should connect to the configured target or refuse when driver carries an own __proto__ key', () => {

            expectUntouched(ownProtoKey(hostile[dialect]));

        });

        it('should connect to the configured target or refuse when driver inherits its keys', () => {

            expectUntouched(Object.create(hostile[dialect]));

        });

    });

    it('should read the configured target back from each driver when no driver options are given', () => {

        expect(reached.postgres()).toMatchObject({ host: trusted.host, port: 6000, database: 'app_test', user: 'app', password: 'secret', ssl: true });
        expect(reached.mysql()).toMatchObject({ host: trusted.host, port: 6000, database: 'app_test', user: 'app', password: 'secret' });
        expect(reached.mssql()).toMatchObject({ server: trusted.host, port: 6000, database: 'app_test', encrypt: true, trustServerCertificate: false });

    });

    it('should refuse the JSON-parsed __proto__ payload that retargeted PostgreSQL', () => {

        const driver = JSON.parse(`{"__proto__":{"connectionString":"${evil.connectionString}"}}`);

        const [, err] = attemptSync(() => driverOptionsFor('postgres', { driver }));

        expect(err?.message).toContain('driver.__proto__ is not allowed on postgres');

    });

    it('should not forward keys a driver object inherits', () => {

        // Only own keys are validated, so only own keys may reach the driver.
        const driver = Object.assign(Object.create({ lock_timeout: 1, host: 'evil.example' }), { application_name: 'reports' });

        expect(driverOptionsFor('postgres', { driver })).toEqual({ application_name: 'reports' });

    });

});
