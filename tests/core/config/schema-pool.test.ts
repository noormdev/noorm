/**
 * Pool and keepalive options in the config schema.
 *
 * The schema is where the dialect is known for stored, env, and inline
 * configs alike, so it is where an option the dialect cannot honor has to
 * fail. Before these rules an unknown pool key was stripped without a word.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { attemptSync } from '@logosdx/utils';

import {
    ConfigValidationError,
    EnvConfigSchema,
    getEnvConfig,
    parseConfig,
    validateConfigInput,
} from '../../../src/core/config/index.js';

function configWith(connection: Record<string, unknown>) {

    return {
        name: 'pool_test',
        connection: { host: 'localhost', database: 'app_test', ...connection },
    };

}

describe('config: pool options', () => {

    it('should keep every PostgreSQL pool option through parsing', () => {

        const pool = { min: 1, max: 4, idleTimeoutMs: 5_000, maxLifetimeMs: 60_000, maxUses: 50, allowExitOnIdle: true };

        expect(parseConfig(configWith({ dialect: 'postgres', pool })).connection.pool).toEqual(pool);

    });

    it.each(['mysql', 'mssql'])('should keep every Tarn pool option through parsing on %s', (dialect) => {

        const pool = { min: 1, max: 4, idleTimeoutMs: 5_000, acquireTimeoutMs: 1_000, createTimeoutMs: 2_000, reapIntervalMs: 500 };

        expect(parseConfig(configWith({ dialect, pool })).connection.pool).toEqual(pool);

    });

    it('should keep accepting pool.idleTimeoutMillis, which stored configs already carry', () => {

        const parsed = parseConfig(configWith({ dialect: 'postgres', pool: { idleTimeoutMillis: 0 } }));

        expect(parsed.connection.pool).toEqual({ idleTimeoutMillis: 0 });

    });

    it('should reject pool.idleTimeoutMs and pool.idleTimeoutMillis when they differ', () => {

        const [, err] = attemptSync(() =>
            parseConfig(configWith({ dialect: 'postgres', pool: { idleTimeoutMs: 1_000, idleTimeoutMillis: 2_000 } })),
        );

        expect(err).toBeInstanceOf(ConfigValidationError);
        expect(err?.message).toContain('pool.idleTimeoutMillis');

    });

    it.each([
        ['mysql', { maxUses: 1 }, 'pool.maxUses'],
        ['mssql', { maxLifetimeMs: 1_000 }, 'pool.maxLifetimeMs'],
        ['postgres', { acquireTimeoutMs: 1_000 }, 'pool.acquireTimeoutMs'],
        ['sqlite', { idleTimeoutMs: 1_000 }, 'pool.idleTimeoutMs'],
    ] as const)('should reject on %s a pool option it cannot honor, naming the option and dialect', (dialect, pool, field) => {

        const [, err] = attemptSync(() => parseConfig(configWith({ dialect, pool })));

        expect(err).toBeInstanceOf(ConfigValidationError);
        expect(err?.message).toContain(field);
        expect(err?.message).toContain(dialect);
        expect(err).toMatchObject({ field: `connection.${field}` });

    });

    it('should accept the pool size on sqlite, because config resolution defaults it for every dialect', () => {

        expect(() => parseConfig(configWith({ dialect: 'sqlite', pool: { min: 0, max: 10 } }))).not.toThrow();

    });

    it('should accept the legacy idle timeout alias on sqlite, where a process-wide env value reaches every config', () => {

        expect(() => parseConfig(configWith({ dialect: 'sqlite', pool: { min: 0, max: 10, idleTimeoutMillis: 30_000 } }))).not.toThrow();

    });

    it('should accept a PostgreSQL lifetime that is not whole seconds', () => {

        const parsed = parseConfig(configWith({ dialect: 'postgres', pool: { maxLifetimeMs: 1_500 } }));

        expect(parsed.connection.pool?.maxLifetimeMs).toBe(1_500);

    });

    it('should reject a pool key noorm does not know instead of dropping it', () => {

        // A misspelled option that parses cleanly looks like a working one.
        const [, err] = attemptSync(() => parseConfig(configWith({ dialect: 'postgres', pool: { max: 3, bogus: true } })));

        expect(err).toBeInstanceOf(ConfigValidationError);
        expect(err).toMatchObject({ field: 'connection.pool' });
        expect(err?.message).toContain('pool.bogus');

    });

    it('should reject an unknown pool key in a partial update that names no dialect', () => {

        const [, err] = attemptSync(() => validateConfigInput({ connection: { pool: { maxuses: 5 } } }));

        expect(err?.message).toContain('pool.maxUses');

    });

    it('should reject a pool.min above pool.max before the pool is built', () => {

        const [, err] = attemptSync(() => parseConfig(configWith({ dialect: 'mysql', pool: { min: 5, max: 2 } })));

        expect(err).toBeInstanceOf(ConfigValidationError);
        expect(err).toMatchObject({ field: 'connection.pool.min' });
        expect(err?.message).toContain('pool.max (2)');

    });

    it('should apply the same rule to a partial update that names its dialect', () => {

        const [, err] = attemptSync(() => validateConfigInput({ connection: { dialect: 'mysql', pool: { maxUses: 1 } } }));

        expect(err?.message).toContain('pool.maxUses');
        expect(() => validateConfigInput({ connection: { pool: { maxUses: 1 } } })).not.toThrow();

    });

});

describe('config: keepAliveInitialDelayMs', () => {

    it.each(['postgres', 'mysql'])('should keep the delay on %s', (dialect) => {

        expect(parseConfig(configWith({ dialect, keepAliveInitialDelayMs: 10_000 })).connection.keepAliveInitialDelayMs).toBe(10_000);

    });

    it.each(['mssql', 'sqlite'])('should reject the delay on %s, which has no such control', (dialect) => {

        const [, err] = attemptSync(() => parseConfig(configWith({ dialect, keepAliveInitialDelayMs: 10_000 })));

        expect(err).toBeInstanceOf(ConfigValidationError);
        expect(err).toMatchObject({ field: 'connection.keepAliveInitialDelayMs' });
        expect(err?.message).toContain(dialect);

    });

});

describe('config: pool options from the environment', () => {

    const keys = [
        'NOORM_CONNECTION_DIALECT',
        'NOORM_CONNECTION_HOST',
        'NOORM_CONNECTION_DATABASE',
        'NOORM_CONNECTION_keepAliveInitialDelayMs',
        'NOORM_CONNECTION_POOL_MAX',
        'NOORM_CONNECTION_POOL_idleTimeoutMs',
        'NOORM_CONNECTION_POOL_maxLifetimeMs',
        'NOORM_CONNECTION_POOL_maxUses',
        'NOORM_CONNECTION_POOL_allowExitOnIdle',
        'NOORM_CONNECTION_POOL_acquireTimeoutMs',
        'NOORM_CONNECTION_POOL_MAXUSES',
    ];
    const backup = new Map<string, string | undefined>();

    beforeEach(() => {

        for (const key of keys) {

            backup.set(key, process.env[key]);
            delete process.env[key];

        }

        process.env['NOORM_CONNECTION_DIALECT'] = 'postgres';
        process.env['NOORM_CONNECTION_HOST'] = 'localhost';
        process.env['NOORM_CONNECTION_DATABASE'] = 'app_test';

    });

    afterEach(() => {

        for (const [key, value] of backup) {

            if (value === undefined) delete process.env[key];
            else process.env[key] = value;

        }

    });

    it('should reach every new option through a camelCase path segment, typed as the schema expects', () => {

        process.env['NOORM_CONNECTION_keepAliveInitialDelayMs'] = '10000';
        process.env['NOORM_CONNECTION_POOL_MAX'] = '4';
        process.env['NOORM_CONNECTION_POOL_idleTimeoutMs'] = '5000';
        process.env['NOORM_CONNECTION_POOL_maxLifetimeMs'] = '60000';
        process.env['NOORM_CONNECTION_POOL_maxUses'] = '50';
        process.env['NOORM_CONNECTION_POOL_allowExitOnIdle'] = 'true';

        const parsed = EnvConfigSchema.parse(getEnvConfig());

        expect(parsed.connection.keepAliveInitialDelayMs).toBe(10_000);
        expect(parsed.connection.pool).toEqual({
            max: 4,
            idleTimeoutMs: 5_000,
            maxLifetimeMs: 60_000,
            maxUses: 50,
            allowExitOnIdle: true,
        });

    });

    it('should reject an env pool option the dialect cannot honor', () => {

        process.env['NOORM_CONNECTION_POOL_acquireTimeoutMs'] = '1000';

        const result = EnvConfigSchema.safeParse(getEnvConfig());

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toContain('pool.acquireTimeoutMs');

    });

    it('should reject an all-caps env pool option and name the camelCase variable', () => {

        // The env reader lowercases an all-caps segment, so the key arrives as `maxuses`.
        process.env['NOORM_CONNECTION_POOL_MAXUSES'] = '50';

        const result = EnvConfigSchema.safeParse(getEnvConfig());

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(['connection', 'pool']);
        expect(result.error?.issues[0]?.message).toContain('NOORM_CONNECTION_POOL_maxUses');

    });

});
