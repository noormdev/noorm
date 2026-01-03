/**
 * Environment variable config tests.
 *
 * Tests the makeNestedConfig-based env var parsing.
 * Env vars follow the pattern: NOORM_{PATH}_{TO}_{VALUE}
 *
 * @example
 * NOORM_CONNECTION_DIALECT=postgres  ->  { connection: { dialect: 'postgres' } }
 * NOORM_CONNECTION_HOST=localhost    ->  { connection: { host: 'localhost' } }
 * NOORM_PATHS_SQL=./sql              ->  { paths: { sql: './sql' } }
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    getEnvConfig,
} from '../../../src/core/config/index.js';
import { getEnvConfigName, isCi, shouldOutputJson, shouldSkipConfirmations } from '../../../src/core/environment.js';

describe('config: env', () => {

    const envBackup: Record<string, string | undefined> = {};

    beforeEach(() => {

        // Backup current env vars - now using nested naming convention
        const envVars = [
            // Connection
            'NOORM_CONNECTION_DIALECT',
            'NOORM_CONNECTION_HOST',
            'NOORM_CONNECTION_PORT',
            'NOORM_CONNECTION_DATABASE',
            'NOORM_CONNECTION_USER',
            'NOORM_CONNECTION_PASSWORD',
            'NOORM_CONNECTION_SSL',
            'NOORM_CONNECTION_POOL_MIN',
            'NOORM_CONNECTION_POOL_MAX',
            // Paths
            'NOORM_PATHS_SQL',
            'NOORM_PATHS_CHANGES',
            // Top-level
            'NOORM_NAME',
            'NOORM_TYPE',
            'NOORM_PROTECTED',
            'NOORM_IDENTITY',
            'NOORM_isTest', // camelCase preserved for isTest
            // Meta (not config values)
            'NOORM_CONFIG',
            'NOORM_YES',
            'NOORM_JSON',
            'CI',
        ];

        for (const key of envVars) {

            envBackup[key] = process.env[key];
            delete process.env[key];

        }

    });

    afterEach(() => {

        // Restore env vars
        for (const [key, value] of Object.entries(envBackup)) {

            if (value === undefined) {

                delete process.env[key];

            }
            else {

                process.env[key] = value;

            }

        }

    });

    describe('getEnvConfig', () => {

        it('should return empty config when no env vars set', () => {

            const config = getEnvConfig();
            expect(config).toEqual({});

        });

        it('should read connection dialect', () => {

            process.env['NOORM_CONNECTION_DIALECT'] = 'postgres';

            const config = getEnvConfig();

            expect(config.connection?.dialect).toBe('postgres');

        });

        it('should read all connection properties', () => {

            process.env['NOORM_CONNECTION_DIALECT'] = 'postgres';
            process.env['NOORM_CONNECTION_HOST'] = 'db.example.com';
            process.env['NOORM_CONNECTION_PORT'] = '5432';
            process.env['NOORM_CONNECTION_DATABASE'] = 'myapp';
            process.env['NOORM_CONNECTION_USER'] = 'admin';
            process.env['NOORM_CONNECTION_PASSWORD'] = 'secret';
            process.env['NOORM_CONNECTION_SSL'] = 'true';

            const config = getEnvConfig();

            expect(config.connection).toEqual({
                dialect: 'postgres',
                host: 'db.example.com',
                port: 5432,
                database: 'myapp',
                user: 'admin',
                password: 'secret',
                ssl: true,
            });

        });

        it('should parse port as number', () => {

            process.env['NOORM_CONNECTION_PORT'] = '3306';

            const config = getEnvConfig();

            expect(config.connection?.port).toBe(3306);
            expect(typeof config.connection?.port).toBe('number');

        });

        it('should parse ssl as boolean', () => {

            // Use 'true'/'false' strings for boolean values
            process.env['NOORM_CONNECTION_SSL'] = 'true';
            let config = getEnvConfig();
            expect(config.connection?.ssl).toBe(true);

            process.env['NOORM_CONNECTION_SSL'] = 'false';
            config = getEnvConfig();
            expect(config.connection?.ssl).toBe(false);

            // Note: '1' and '0' become numbers, not booleans
            // Use 'true'/'false' for boolean values
            process.env['NOORM_CONNECTION_SSL'] = '1';
            config = getEnvConfig();
            expect(config.connection?.ssl).toBe(1);

            process.env['NOORM_CONNECTION_SSL'] = '0';
            config = getEnvConfig();
            expect(config.connection?.ssl).toBe(0);

        });

        it('should validate dialect', () => {

            process.env['NOORM_CONNECTION_DIALECT'] = 'oracle';

            expect(() => getEnvConfig()).toThrow(
                'Invalid NOORM_CONNECTION_DIALECT: must be one of',
            );

        });

        it('should accept all valid dialects', () => {

            const dialects = ['postgres', 'mysql', 'sqlite', 'mssql'];

            for (const dialect of dialects) {

                process.env['NOORM_CONNECTION_DIALECT'] = dialect;

                const config = getEnvConfig();
                expect(config.connection?.dialect).toBe(dialect);

            }

        });

        it('should read path properties', () => {

            process.env['NOORM_PATHS_SQL'] = './custom/sql';
            process.env['NOORM_PATHS_CHANGES'] = './custom/changes';

            const config = getEnvConfig();

            expect(config.paths?.sql).toBe('./custom/sql');
            expect(config.paths?.changes).toBe('./custom/changes');

        });

        it('should read top-level behavior properties', () => {

            // Note: NOORM_CONFIG is handled separately by getEnvConfigName()
            // and not included in getEnvConfig() output
            process.env['NOORM_PROTECTED'] = 'true';
            process.env['NOORM_IDENTITY'] = 'deploy-bot';

            const config = getEnvConfig();

            expect(config.protected).toBe(true);
            expect(config.identity).toBe('deploy-bot');

        });

        it('should support nested pool configuration', () => {

            process.env['NOORM_CONNECTION_POOL_MIN'] = '2';
            process.env['NOORM_CONNECTION_POOL_MAX'] = '20';

            const config = getEnvConfig();

            expect(config.connection?.pool).toEqual({
                min: 2,
                max: 20,
            });

        });

        it('should keep password as string (not converted)', () => {

            process.env['NOORM_CONNECTION_PASSWORD'] = '12345';

            const config = getEnvConfig();

            // Password should remain a string, not be converted to number
            expect(config.connection?.password).toBe('12345');
            expect(typeof config.connection?.password).toBe('string');

        });

        it('should support config name from env', () => {

            process.env['NOORM_NAME'] = 'production';

            const config = getEnvConfig();

            expect(config.name).toBe('production');

        });

        it('should support type and isTest from env', () => {

            // Type is all lowercase, so NOORM_TYPE works
            process.env['NOORM_TYPE'] = 'remote';

            // For camelCase properties, preserve case in the env var name
            // NOORM_IS_TEST would become { is: { test: true } } due to underscore splitting
            // Use NOORM_isTest to get { isTest: true }
            process.env['NOORM_isTest'] = 'true';

            const config = getEnvConfig();

            expect(config.type).toBe('remote');
            expect(config.isTest).toBe(true);

        });

        it('should exclude meta env vars from config', () => {

            process.env['NOORM_CONFIG'] = 'staging';
            process.env['NOORM_YES'] = 'true';
            process.env['NOORM_JSON'] = 'true';

            const config = getEnvConfig() as unknown as Record<string, unknown>;

            // These should not appear in the config object
            expect(config).toEqual({});
            expect(config.config).toBeUndefined();
            expect(config.yes).toBeUndefined();
            expect(config.json).toBeUndefined();

        });

    });

    describe('getEnvConfigName', () => {

        it('should return undefined when not set', () => {

            expect(getEnvConfigName()).toBeUndefined();

        });

        it('should return config name when set', () => {

            process.env['NOORM_CONFIG'] = 'staging';

            expect(getEnvConfigName()).toBe('staging');

        });

    });

    describe('isCI', () => {

        // CI detection also checks TTY - mock it for these tests
        const originalIsTTY = process.stdout.isTTY;

        beforeEach(() => {

            // Clear ALL CI env vars - isCi checks more than just CI
            const allCiVars = [
                'CI', 'CONTINUOUS_INTEGRATION', 'GITHUB_ACTIONS', 'GITLAB_CI',
                'CIRCLECI', 'TRAVIS', 'JENKINS_URL', 'BUILDKITE',
                'TEAMCITY_VERSION', 'TF_BUILD', 'BITBUCKET_BUILD_NUMBER',
                'NOORM_HEADLESS',
            ];

            for (const v of allCiVars) {

                delete process.env[v];

            }

            // Pretend we have a TTY (so !isTTY doesn't trigger CI detection)
            Object.defineProperty(process.stdout, 'isTTY', {
                value: true,
                writable: true,
            });

        });

        afterEach(() => {

            Object.defineProperty(process.stdout, 'isTTY', {
                value: originalIsTTY,
                writable: true,
            });

        });

        it('should return false when CI not set', () => {

            expect(isCi()).toBe(false);

        });

        it('should return true when CI=1', () => {

            process.env['CI'] = '1';

            expect(isCi()).toBe(true);

        });

        it('should return true when CI=true', () => {

            process.env['CI'] = 'true';

            expect(isCi()).toBe(true);

        });

        it('should return true for any CI value (presence-based detection)', () => {

            // CI detection is presence-based, not value-based
            // Any value for CI means we're in a CI environment
            process.env['CI'] = 'false';

            expect(isCi()).toBe(true);

        });

    });

    describe('shouldSkipConfirmations', () => {

        it('should return false when not set', () => {

            expect(shouldSkipConfirmations()).toBe(false);

        });

        it('should return true when NOORM_YES=1', () => {

            process.env['NOORM_YES'] = '1';

            expect(shouldSkipConfirmations()).toBe(true);

        });

        it('should return true when NOORM_YES=true', () => {

            process.env['NOORM_YES'] = 'true';

            expect(shouldSkipConfirmations()).toBe(true);

        });

    });

    describe('shouldOutputJson', () => {

        it('should return false when not set', () => {

            expect(shouldOutputJson()).toBe(false);

        });

        it('should return true when NOORM_JSON=1', () => {

            process.env['NOORM_JSON'] = '1';

            expect(shouldOutputJson()).toBe(true);

        });

        it('should return true when NOORM_JSON=true', () => {

            process.env['NOORM_JSON'] = 'true';

            expect(shouldOutputJson()).toBe(true);

        });

    });

});
