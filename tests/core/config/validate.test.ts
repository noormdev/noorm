/**
 * Config validate-algorithm tests.
 *
 * `validateConfigChecks` is the single source for the three-check
 * sequence (connection, name/database presence, host presence for
 * non-sqlite) shared by `cli/config/validate.ts` and
 * `ConfigValidateScreen.tsx`.
 */
import { describe, it, expect } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateConfigChecks } from '../../../src/core/config/validate.js';
import type { Config } from '../../../src/core/config/types.js';

/**
 * Create a valid test config, mirroring `tests/core/config/resolver.test.ts`.
 */
function createConfig(overrides: Partial<Config> = {}): Config {

    return {
        name: 'test',
        type: 'local',
        isTest: true,
        access: { user: 'admin', agent: 'admin' },
        connection: {
            dialect: 'sqlite',
            database: ':memory:',
        },
        ...overrides,
    };

}

describe('config: validateConfigChecks', () => {

    it('passes all checks for a valid sqlite config', async () => {

        const config = createConfig();

        const { checks, valid } = await validateConfigChecks(config);

        expect(valid).toBe(true);
        expect(checks.map((c) => c.key)).toEqual(['connection', 'name', 'database']);
        expect(checks.every((c) => c.status === 'success')).toBe(true);

    });

    it('fails the host check for a non-sqlite config with no host set', async () => {

        const config = createConfig({
            connection: {
                dialect: 'postgres',
                database: 'testdb',
                // Invalid port forces a fast, deterministic connection failure
                // (Node's socket layer rejects synchronously) instead of the
                // ECONNREFUSED retry/backoff path, which would make this test
                // slow and environment-dependent.
                port: 999999,
            },
        });

        const { checks, valid } = await validateConfigChecks(config);

        expect(valid).toBe(false);
        expect(checks.map((c) => c.key)).toEqual(['connection', 'name', 'database', 'host']);

        const hostCheck = checks.find((c) => c.key === 'host');
        expect(hostCheck?.status).toBe('error');
        expect(hostCheck?.detail).toBe('Not set');

    });

    it('reports the SslFileError message for an unreadable ssl file path', async () => {

        const caFile = join(tmpdir(), 'noorm-validate-missing', 'ca.pem');
        const config = createConfig({
            connection: { dialect: 'postgres', host: '127.0.0.1', port: 1, database: 'testdb', ssl: { caFile } },
        });

        const { checks, valid } = await validateConfigChecks(config);
        const connection = checks.find((c) => c.key === 'connection');

        expect(valid).toBe(false);
        expect(connection?.status).toBe('error');
        expect(connection?.detail).toContain('ssl.caFile');
        expect(connection?.detail).toContain(caFile);

    });

});
