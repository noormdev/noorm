/**
 * `pool.idleTimeoutMs` and its legacy alias `pool.idleTimeoutMillis` across config layers.
 *
 * They are one setting under two names. A config stored before the rename
 * carries the alias, so an override that uses the new name must replace it
 * instead of colliding with it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { attemptSync } from '@logosdx/utils';

import { ConfigValidationError, resolveConfig, type Config, type StateProvider } from '../../../src/core/config/index.js';

const ENV_KEYS = [
    'NOORM_CONFIG',
    'NOORM_NAME',
    'NOORM_CONNECTION_DIALECT',
    'NOORM_CONNECTION_HOST',
    'NOORM_CONNECTION_DATABASE',
    'NOORM_CONNECTION_POOL_idleTimeoutMs',
    'NOORM_CONNECTION_POOL_idleTimeoutMillis',
];

function stateWith(pool: NonNullable<Config['connection']['pool']>, dialect: Config['connection']['dialect'] = 'postgres'): StateProvider {

    const stored: Config = {
        name: 'app',
        type: 'local',
        isTest: true,
        access: { user: 'admin', agent: 'admin' },
        connection: { dialect, host: 'localhost', database: 'app_test', pool },
    };

    return {
        getConfig: (name) => (name === 'app' ? stored : null),
        getActiveConfigName: () => 'app',
        listSecrets: () => [],
    };

}

describe('config: idle timeout alias across layers', () => {

    const backup = new Map<string, string | undefined>();

    beforeEach(() => {

        for (const key of ENV_KEYS) {

            backup.set(key, process.env[key]);
            delete process.env[key];

        }

    });

    afterEach(() => {

        for (const [key, value] of backup) {

            if (value === undefined) delete process.env[key];
            else process.env[key] = value;

        }

    });

    it('should let an inline pool.idleTimeoutMs replace a stored pool.idleTimeoutMillis', () => {

        const config = resolveConfig(stateWith({ idleTimeoutMillis: 30_000 }), {
            name: 'app',
            flags: { connection: { pool: { idleTimeoutMs: 5_000 } } },
        });

        expect(config?.connection.pool).toMatchObject({ idleTimeoutMs: 5_000 });
        expect(config?.connection.pool).not.toHaveProperty('idleTimeoutMillis');

    });

    it('should let an env pool.idleTimeoutMs replace a stored pool.idleTimeoutMillis', () => {

        process.env['NOORM_CONNECTION_POOL_idleTimeoutMs'] = '5000';

        const config = resolveConfig(stateWith({ idleTimeoutMillis: 30_000 }), { name: 'app' });

        expect(config?.connection.pool).toMatchObject({ idleTimeoutMs: 5_000 });
        expect(config?.connection.pool).not.toHaveProperty('idleTimeoutMillis');

    });

    it('should let an inline alias replace a stored pool.idleTimeoutMs', () => {

        const config = resolveConfig(stateWith({ idleTimeoutMs: 30_000 }), {
            name: 'app',
            flags: { connection: { pool: { idleTimeoutMillis: 5_000 } } },
        });

        expect(config?.connection.pool).toMatchObject({ idleTimeoutMillis: 5_000 });
        expect(config?.connection.pool).not.toHaveProperty('idleTimeoutMs');

    });

    it('should keep a stored idle timeout when the override names neither key', () => {

        const config = resolveConfig(stateWith({ idleTimeoutMillis: 30_000 }), {
            name: 'app',
            flags: { connection: { pool: { max: 3 } } },
        });

        expect(config?.connection.pool).toMatchObject({ idleTimeoutMillis: 30_000, max: 3 });

    });

    it('should still reject one layer that names both keys with different values', () => {

        const [, err] = attemptSync(() => resolveConfig(stateWith({ idleTimeoutMillis: 30_000 }), {
            name: 'app',
            flags: { connection: { pool: { idleTimeoutMs: 5_000, idleTimeoutMillis: 6_000 } } },
        }));

        expect(err).toBeInstanceOf(ConfigValidationError);
        expect(err?.message).toContain('pool.idleTimeoutMillis');

    });

    it('should resolve a sqlite config when a process-wide env alias is set', () => {

        // The alias is unused on SQLite; one env value must not break every SQLite context.
        process.env['NOORM_CONNECTION_POOL_idleTimeoutMillis'] = '30000';

        const [config, err] = attemptSync(() => resolveConfig(stateWith({ min: 0, max: 1 }, 'sqlite'), { name: 'app' }));

        expect(err).toBeNull();
        expect(config?.connection.dialect).toBe('sqlite');

    });

    it('should apply the same rule when no stored config is used', () => {

        process.env['NOORM_CONNECTION_POOL_idleTimeoutMillis'] = '30000';

        const config = resolveConfig(stateWith({}), {
            name: false,
            flags: { connection: { dialect: 'postgres', host: 'localhost', database: 'app_test', pool: { idleTimeoutMs: 5_000 } } },
        });

        expect(config?.connection.pool).toMatchObject({ idleTimeoutMs: 5_000 });
        expect(config?.connection.pool).not.toHaveProperty('idleTimeoutMillis');

    });

});
