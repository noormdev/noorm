/**
 * Config resolver tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { attemptSync } from '@logosdx/utils';

import {
    resolveConfig,
    checkConfigCompleteness,
    canDeleteConfig,
    type StateProvider,
} from '../../../src/core/config/index.js';
import { ConfigValidationError } from '../../../src/core/config/schema.js';
import { effectiveConfig, SettingsProvider, withConfigPolicy } from '../../../src/core/config/resolver.js';
import type { Config } from '../../../src/core/config/index.js';
import type { ConfigInput } from '../../../src/core/config/types.js';
import {
    getConfigPermission,
    getPolicyContext,
    getPolicyFingerprint,
    guarded,
    policyTargetIdentity,
    UnknownAccessRoleError,
} from '../../../src/core/policy/index.js';
import type { SettingsManager, Stage } from '../../../src/core/settings/index.js';

/**
 * Create a mock state provider for testing.
 */
function createMockState(
    options: {
        configs?: Record<string, Config>;
        activeConfig?: string | null;
        secrets?: Record<string, string[]>;
    } = {},
): StateProvider {

    const configs = options.configs ?? {};
    const activeConfig = options.activeConfig ?? null;
    const secrets = options.secrets ?? {};

    return {
        getConfig(name: string): Config | null {

            return configs[name] ?? null;

        },
        getActiveConfigName(): string | null {

            return activeConfig;

        },
        listSecrets(configName: string): string[] {

            return secrets[configName] ?? [];

        },
    };

}

/**
 * Create a mock settings provider for testing.
 */
function createMockSettings(stages: Record<string, Stage> = {}, projectRoot = '/test-project'): SettingsProvider {

    const manager = {
        projectRoot,
        settings: {},
        getStage(name: string): Stage | null {

            return stages[name] ?? null;

        },
    } as unknown as SettingsManager;

    return new SettingsProvider(manager);

}

/**
 * Create a valid test config.
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

describe('config: resolver', () => {

    const envBackup: Record<string, string | undefined> = {};

    beforeEach(() => {

        // Backup and clear relevant env vars (using nested naming convention)
        const envVars = [
            // Connection
            'NOORM_CONNECTION_DIALECT',
            'NOORM_CONNECTION_HOST',
            'NOORM_CONNECTION_PORT',
            'NOORM_CONNECTION_DATABASE',
            'NOORM_CONNECTION_USER',
            'NOORM_CONNECTION_PASSWORD',
            'NOORM_CONNECTION_SSL',
            'NOORM_CONNECTION_SSL_CA',
            'NOORM_CONNECTION_SSL_caFile',
            'NOORM_CONNECTION_SSL_CAFILE',
            'NOORM_CONNECTION_SSL_REJECTUNAUTHORIZED',
            // Top-level
            'NOORM_CONFIG',
            'NOORM_NAME',
            'NOORM_ACCESS_USER',
            'NOORM_ACCESS_AGENT',
            'NOORM_PROTECTED',
            'NOORM_IDENTITY',
            'NOORM_isTest',
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

    describe('resolveConfig', () => {

        it('should return null when no config available', () => {

            const state = createMockState();

            const config = resolveConfig(state);

            expect(config).toBeNull();

        });

        it('should load active config from state', () => {

            const stored = createConfig({ name: 'dev' });
            const state = createMockState({
                configs: { dev: stored },
                activeConfig: 'dev',
            });

            const config = resolveConfig(state);

            expect(config).not.toBeNull();
            expect(config!.name).toBe('dev');

        });

        it('should load config by name option', () => {

            const stored = createConfig({ name: 'staging' });
            const state = createMockState({
                configs: { staging: stored },
                activeConfig: 'dev', // active is different
            });

            const config = resolveConfig(state, { name: 'staging' });

            expect(config).not.toBeNull();
            expect(config!.name).toBe('staging');

        });

        it('should prefer name option over env var for config selection', () => {

            // NOORM_CONFIG points to a different config
            process.env['NOORM_CONFIG'] = 'from-env';

            const envConfig = createConfig({ name: 'from-env' });
            const optionConfig = createConfig({ name: 'from-option' });
            const state = createMockState({
                configs: {
                    'from-env': envConfig,
                    'from-option': optionConfig,
                },
            });

            // options.name should select which config to load (from-option)
            // even though NOORM_CONFIG is set to 'from-env'
            const config = resolveConfig(state, { name: 'from-option' });

            // The loaded config should be from-option's stored values
            expect(config!.name).toBe('from-option');

        });

        it('should prefer env var over active config', () => {

            process.env['NOORM_CONFIG'] = 'from-env';

            const stored = createConfig({ name: 'from-env' });
            const state = createMockState({
                configs: { 'from-env': stored, active: createConfig({ name: 'active' }) },
                activeConfig: 'active',
            });

            const config = resolveConfig(state);

            expect(config!.name).toBe('from-env');

        });

        it('should throw when config not found', () => {

            const state = createMockState();

            expect(() => resolveConfig(state, { name: 'nonexistent' })).toThrow(
                'Config "nonexistent" not found',
            );

        });

        it('should merge env vars over stored config', () => {

            process.env['NOORM_CONNECTION_HOST'] = 'override.local';
            process.env['NOORM_CONNECTION_PORT'] = '9999';

            const stored = createConfig({
                name: 'dev',
                connection: {
                    dialect: 'postgres',
                    host: 'original.local',
                    port: 5432,
                    database: 'test',
                },
            });
            const state = createMockState({
                configs: { dev: stored },
                activeConfig: 'dev',
            });

            const config = resolveConfig(state);

            expect(config!.connection.host).toBe('override.local');
            expect(config!.connection.port).toBe(9999);
            expect(config!.connection.dialect).toBe('postgres'); // unchanged

        });

        it('should merge flags over env vars', () => {

            process.env['NOORM_CONNECTION_HOST'] = 'from-env';

            const stored = createConfig({ name: 'dev' });
            const state = createMockState({
                configs: { dev: stored },
                activeConfig: 'dev',
            });

            const config = resolveConfig(state, {
                name: 'dev',
                flags: { connection: { host: 'from-flags' }, log: { level: 'info' } },
            });

            expect(config!.connection.host).toBe('from-flags');

        });

        it('should apply defaults for missing values', () => {

            const stored = createConfig({ name: 'minimal' });
            const state = createMockState({
                configs: { minimal: stored },
                activeConfig: 'minimal',
            });

            const config = resolveConfig(state);

            expect(config!.type).toBe('local');
            expect(config!.isTest).toBe(true);

        });

        it('should validate merged config', () => {

            // Config with invalid port from env var
            process.env['NOORM_CONNECTION_PORT'] = '99999';

            const stored = createConfig({ name: 'dev' });
            const state = createMockState({
                configs: { dev: stored },
                activeConfig: 'dev',
            });

            expect(() => resolveConfig(state)).toThrow('Port must be at most 65535');

        });

    });

    describe('env-only mode', () => {

        beforeEach(() => {

            // Ensure all env vars are cleared before each env-only test
            const envVars = [
                'NOORM_CONNECTION_DIALECT',
                'NOORM_CONNECTION_HOST',
                'NOORM_CONNECTION_PORT',
                'NOORM_CONNECTION_DATABASE',
                'NOORM_CONNECTION_USER',
                'NOORM_CONNECTION_PASSWORD',
                'NOORM_CONNECTION_SSL',
                'NOORM_PATHS_SQL',
                'NOORM_PATHS_CHANGESETS',
                'NOORM_CONFIG',
                'NOORM_PROTECTED',
                'NOORM_IDENTITY',
            ];
            for (const key of envVars) {

                delete process.env[key];

            }

        });

        it('should create config from env vars only', () => {

            process.env['NOORM_CONNECTION_DIALECT'] = 'sqlite';
            process.env['NOORM_CONNECTION_DATABASE'] = ':memory:';

            const state = createMockState(); // Empty state

            const config = resolveConfig(state);

            expect(config).not.toBeNull();
            expect(config!.name).toBe('__env__');
            expect(config!.connection.dialect).toBe('sqlite');
            expect(config!.connection.database).toBe(':memory:');

        });

        it('should require dialect and database for env-only', () => {

            process.env['NOORM_CONNECTION_DIALECT'] = 'postgres';
            // Missing database

            const state = createMockState();

            const config = resolveConfig(state);

            expect(config).toBeNull();

        });

        it('should apply defaults in env-only mode', () => {

            process.env['NOORM_CONNECTION_DIALECT'] = 'sqlite';
            process.env['NOORM_CONNECTION_DATABASE'] = ':memory:';

            const state = createMockState();

            const config = resolveConfig(state);

            expect(config!.type).toBe('local');
            expect(config!.access).toEqual({ user: 'admin', agent: 'viewer' });

        });

        it('should validate env-only config', () => {

            process.env['NOORM_CONNECTION_DIALECT'] = 'postgres';
            process.env['NOORM_CONNECTION_DATABASE'] = 'test';

            const state = createMockState();

            // With default host 'localhost', validation passes
            const config = resolveConfig(state);
            expect(config!.connection.host).toBe('localhost');

        });

        it('should fail validation when host explicitly cleared', () => {

            process.env['NOORM_CONNECTION_DIALECT'] = 'postgres';
            process.env['NOORM_CONNECTION_DATABASE'] = 'test';

            const state = createMockState();

            // Override host to empty via flags to trigger validation error
            expect(() =>
                resolveConfig(state, {
                    flags: { connection: { host: '' }, log: { level: 'info' } },
                }),
            ).toThrow('Host is required for non-SQLite');

        });

        it('maps complementary stage fields into an env-only connection', () => {

            process.env['NOORM_CONNECTION_DATABASE'] = 'env_database';
            process.env['NOORM_CONNECTION_HOST'] = 'env.example.com';

            const settings = createMockSettings({
                ci: {
                    defaults: {
                        dialect: 'postgres',
                        host: 'stage.example.com',
                        port: 5544,
                        user: 'stage-user',
                        password: 'stage-password',
                        ssl: true,
                        type: 'remote',
                        isTest: true,
                        protected: true,
                    },
                },
            });
            const config = resolveConfig(createMockState(), { stage: 'ci', settings });

            expect(config!.name).toBe('__env__');
            expect(config!.connection).toMatchObject({
                dialect: 'postgres',
                database: 'env_database',
                host: 'env.example.com',
                port: 5544,
                user: 'stage-user',
                password: 'stage-password',
                ssl: true,
            });
            expect(config!.type).toBe('remote');
            expect(config!.isTest).toBe(true);
            expect(config!.access).toEqual({ user: 'admin', agent: 'viewer' });
            expect(getConfigPermission('user', config!, 'sql:ddl')).toBe('deny');
            expect(getConfigPermission('agent', config!, 'sql:write')).toBe('deny');

        });

        it('merges stage then environment then inline fields without losing complements', () => {

            process.env['NOORM_CONNECTION_HOST'] = 'env.example.com';
            process.env['NOORM_CONNECTION_PORT'] = '5545';
            process.env['NOORM_CONNECTION_PASSWORD'] = 'env-password';
            process.env['NOORM_ACCESS_USER'] = 'admin';
            process.env['NOORM_ACCESS_AGENT'] = 'admin';

            const settings = createMockSettings({
                ci: {
                    defaults: {
                        dialect: 'postgres',
                        database: 'stage_database',
                        host: 'stage.example.com',
                        port: 5544,
                        user: 'stage-user',
                        password: 'stage-password',
                        ssl: true,
                        protected: true,
                    },
                },
            });
            const config = resolveConfig(createMockState(), {
                stage: 'ci',
                settings,
                flags: {
                    connection: { host: 'inline.example.com', password: 'inline-password' },
                    access: { user: 'admin', agent: false },
                },
            });

            expect(config!.name).toBe('__inline__');
            expect(config!.connection).toMatchObject({
                dialect: 'postgres',
                database: 'stage_database',
                host: 'inline.example.com',
                port: 5545,
                user: 'stage-user',
                password: 'inline-password',
                ssl: true,
            });
            expect(config!.access).toEqual({ user: 'admin', agent: false });
            expect(getConfigPermission('user', config!, 'change:run')).toBe('confirm');

        });

        it('keeps custom stage roles while enforcing their overrides and protected permission ceiling', () => {

            const settings = createMockSettings({
                ci: { defaults: {
                    dialect: 'sqlite',
                    access: { user: 'reviewer', agent: 'reviewer' },
                    protected: true,
                } },
            });
            settings.getRoles = () => ({
                reviewer: { extends: 'admin', permissions: { 'sql:read': 'deny' } },
            });
            const config = resolveConfig(createMockState(), {
                stage: 'ci', settings,
                flags: { connection: { database: ':memory:' }, log: { level: 'info' } },
            })!;

            expect(config.access).toEqual({ user: 'reviewer', agent: 'reviewer' });
            expect(getConfigPermission('user', config, 'sql:read')).toBe('allow');
            expect(getConfigPermission('agent', config, 'sql:read')).toBe('deny');
            expect(getConfigPermission('user', config, 'sql:ddl')).toBe('deny');
            expect(getConfigPermission('user', config, 'change:run')).toBe('confirm');
            expect(getConfigPermission('agent', config, 'sql:write')).toBe('deny');

        });

        it('should keep the ceiling of a protected config when the caller selects an unprotected stage', () => {

            const state = createMockState({ configs: { prod: createConfig({ name: 'prod', isTest: false }) } });
            const settings = createMockSettings({
                prod: { defaults: { protected: true } },
                dev: { defaults: {} },
            });
            const config = resolveConfig(state, { name: 'prod', stage: 'dev', settings })!;

            expect(getConfigPermission('user', config, 'sql:ddl')).toBe('deny');
            expect(getConfigPermission('agent', config, 'sql:ddl')).toBe('deny');

        });

        it('should cap an unprotected config when the caller selects a protected stage', () => {

            const state = createMockState({ configs: { dev: createConfig({ name: 'dev', isTest: false }) } });
            const settings = createMockSettings({
                prod: { defaults: { protected: true } },
                dev: { defaults: {} },
            });
            const config = resolveConfig(state, { name: 'dev', stage: 'prod', settings })!;

            expect(getConfigPermission('user', config, 'sql:ddl')).toBe('deny');

        });

        it('should cap an inline target when the caller selects a protected stage', () => {

            const settings = createMockSettings({ prod: { defaults: { protected: true } } });
            const config = resolveConfig(createMockState(), {
                stage: 'prod',
                settings,
                flags: { connection: { dialect: 'sqlite', database: ':memory:' } },
            })!;

            expect(getConfigPermission('user', config, 'sql:ddl')).toBe('deny');

        });

        it('should cap an env-only config named for a protected stage when the caller selects an unprotected stage', () => {

            process.env['NOORM_NAME'] = 'prod';
            process.env['NOORM_CONNECTION_DIALECT'] = 'sqlite';
            process.env['NOORM_CONNECTION_DATABASE'] = ':memory:';
            const settings = createMockSettings({
                prod: { defaults: { protected: true } },
                dev: { defaults: {} },
            });
            const config = resolveConfig(createMockState(), { stage: 'dev', settings })!;

            expect(getConfigPermission('user', config, 'sql:ddl')).toBe('deny');

        });

        it('should keep the ceiling when an env name renames a stored protected-stage config', () => {

            process.env['NOORM_NAME'] = 'dev';
            const state = createMockState({ configs: { prod: createConfig({ name: 'prod', isTest: false }) } });
            const settings = createMockSettings({ prod: { defaults: { protected: true } } });
            const config = resolveConfig(state, { name: 'prod', settings })!;

            expect(getConfigPermission('user', config, 'sql:ddl')).toBe('deny');

        });

        it('should keep the ceiling when a flag renames a stored protected-stage config', () => {

            const state = createMockState({ configs: { prod: createConfig({ name: 'prod', isTest: false }) } });
            const settings = createMockSettings({ prod: { defaults: { protected: true } } });
            const config = resolveConfig(state, { name: 'prod', flags: { name: 'dev' }, settings })!;

            expect(getConfigPermission('user', config, 'sql:ddl')).toBe('deny');

        });

        it('isolates inline targets from the active config and its matching stage', () => {

            const stored = createConfig({
                name: 'test',
                type: 'remote',
                connection: {
                    dialect: 'postgres',
                    database: 'stored_test',
                    host: 'stored.example.com',
                    user: 'stored-user',
                    password: 'stored-password',
                },
            });
            const state = createMockState({ configs: { test: stored }, activeConfig: 'test' });
            const settings = createMockSettings({
                test: { defaults: { isTest: true, access: { user: 'admin', agent: 'admin' } } },
            });
            const config = resolveConfig(state, {
                settings,
                flags: { connection: { dialect: 'postgres', database: 'app', host: 'app.example.com' } },
            });

            expect(config!.name).toBe('__inline__');
            expect(config!.isTest).toBe(false);
            expect(config!.type).not.toBe(stored.type);
            expect(config!.access).not.toEqual(stored.access);
            expect(config!.connection).toMatchObject({
                dialect: 'postgres',
                database: 'app',
                host: 'app.example.com',
            });
            expect(config!.connection.user).toBeUndefined();
            expect(config!.connection.password).toBeUndefined();

        });

        it('rejects incomplete inline input instead of borrowing active connection fields', () => {

            const stored = createConfig();
            const state = createMockState({ configs: { test: stored }, activeConfig: 'test' });

            expect(() => resolveConfig(state, {
                flags: { connection: { dialect: 'postgres' } },
            })).toThrow();

        });

        it.each(['option', 'environment'] as const)('retains an explicitly selected %s base for inline overrides', (selector) => {

            const stored = createConfig({
                name: 'base',
                connection: { dialect: 'postgres', database: 'stored_database', user: 'stored-user' },
            });
            const active = createConfig({ name: 'active' });
            const state = createMockState({ configs: { base: stored, active }, activeConfig: 'active' });
            if (selector === 'environment') {

                process.env['NOORM_CONFIG'] = 'base';

            }
            const config = resolveConfig(state, {
                name: selector === 'option' ? 'base' : undefined,
                flags: { connection: { database: 'inline_database' } },
            });

            expect(config!.name).toBe('base');
            expect(config!.isTest).toBe(stored.isTest);
            expect(config!.access).toEqual(stored.access);
            expect(config!.connection).toMatchObject({
                dialect: 'postgres',
                database: 'inline_database',
                user: 'stored-user',
            });

        });

        it('merges stage, stored, environment and inline fields in increasing priority', () => {

            process.env['NOORM_CONNECTION_HOST'] = 'env.example.com';
            process.env['NOORM_CONNECTION_PORT'] = '5545';

            const stored = createConfig({
                name: 'ci',
                connection: {
                    dialect: 'postgres',
                    database: 'stored_database',
                    host: 'stored.example.com',
                    user: 'stored-user',
                },
            });
            const settings = createMockSettings({
                ci: {
                    defaults: {
                        dialect: 'mysql',
                        database: 'stage_database',
                        host: 'stage.example.com',
                        port: 5544,
                        user: 'stage-user',
                        password: 'stage-password',
                        ssl: true,
                        protected: true,
                    },
                },
            });
            const config = resolveConfig(createMockState({ configs: { ci: stored } }), {
                name: 'ci',
                settings,
                flags: {
                    connection: { host: 'inline.example.com' },
                    access: { user: 'admin', agent: false },
                },
            });

            expect(config!.connection).toMatchObject({
                dialect: 'postgres',
                database: 'stored_database',
                host: 'inline.example.com',
                port: 5545,
                user: 'stored-user',
                password: 'stage-password',
                ssl: true,
            });
            expect(config!.access).toEqual({ user: 'admin', agent: false });
            expect(getConfigPermission('user', config!, 'sql:ddl')).toBe('deny');

        });

    });

    describe('ssl layer combination', () => {

        function stored(ssl: Config['connection']['ssl']): Config {

            return createConfig({
                name: 'ci',
                connection: { dialect: 'postgres', database: 'app', host: 'db', ssl },
            });

        }

        function stageSsl(ssl: NonNullable<Stage['defaults']['ssl']>): SettingsProvider {

            return createMockSettings({ ci: { defaults: { ssl } } });

        }

        function resolveStored(config: Config, settings?: SettingsProvider, flags?: ConfigInput) {

            return resolveConfig(createMockState({ configs: { ci: config } }), { name: 'ci', settings, flags });

        }

        function resolveEnvOnly(flags?: ConfigInput) {

            process.env['NOORM_CONNECTION_DIALECT'] = 'postgres';
            process.env['NOORM_CONNECTION_DATABASE'] = 'app';

            return resolveConfig(createMockState(), { flags });

        }

        it('stored ssl true over stage { caFile } keeps caFile', () => {

            const config = resolveStored(stored(true), stageSsl({ caFile: './stage-ca.pem' }));

            expect(config!.connection.ssl).toEqual({ caFile: './stage-ca.pem' });

        });

        it('stored inline ca over stage caFile resolves to the inline ca only', () => {

            const config = resolveStored(stored({ ca: 'STORED-PEM' }), stageSsl({ caFile: './stage-ca.pem' }));

            expect(config!.connection.ssl).toEqual({ ca: 'STORED-PEM' });

        });

        it('NOORM_CONNECTION_SSL_caFile over stored inline ca resolves to caFile only', () => {

            process.env['NOORM_CONNECTION_SSL_caFile'] = './env-ca.pem';
            const config = resolveStored(stored({ ca: 'STORED-PEM' }));

            expect(config!.connection.ssl).toEqual({ caFile: './env-ca.pem' });

        });

        it('a stage rejectUnauthorized: false does not reach a stored ssl true', () => {

            const config = resolveStored(stored(true), stageSsl({ rejectUnauthorized: false }));

            expect(config!.connection.ssl).toBe(true);

        });

        it('a stage rejectUnauthorized: false does not reach a stored { caFile }', () => {

            const config = resolveStored(stored({ caFile: './stored-ca.pem' }), stageSsl({ rejectUnauthorized: false }));

            expect(config!.connection.ssl).toEqual({ caFile: './stored-ca.pem' });

        });

        it('a stage rejectUnauthorized: false applies to a stored config with no ssl', () => {

            const config = resolveStored(stored(undefined), stageSsl({ rejectUnauthorized: false }));

            expect(config!.connection.ssl).toEqual({ rejectUnauthorized: false });

        });

        it('a stored rejectUnauthorized: false does not survive NOORM_CONNECTION_SSL=true', () => {

            process.env['NOORM_CONNECTION_SSL'] = 'true';
            const config = resolveStored(stored({ rejectUnauthorized: false }));

            expect(config!.connection.ssl).toBe(true);

        });

        it('a stored rejectUnauthorized: false does not survive SDK inline ssl: true', () => {

            const config = resolveStored(stored({ rejectUnauthorized: false }), undefined, { connection: { ssl: true } });

            expect(config!.connection.ssl).toBe(true);

        });

        it('a stored { ca, rejectUnauthorized: false } under env true resolves to { ca }', () => {

            process.env['NOORM_CONNECTION_SSL'] = 'true';
            const config = resolveStored(stored({ ca: 'STORED-PEM', rejectUnauthorized: false }));

            expect(config!.connection.ssl).toEqual({ ca: 'STORED-PEM' });

        });

        it('NOORM_CONNECTION_SSL_CAFILE fails naming ssl.caFile', () => {

            process.env['NOORM_CONNECTION_SSL_CAFILE'] = 'x';

            const [, storedErr] = attemptSync(() => resolveStored(stored(true)));
            const [, envOnlyErr] = attemptSync(() => resolveEnvOnly());

            expect(storedErr).toBeInstanceOf(ConfigValidationError);
            expect(envOnlyErr).toBeInstanceOf(ConfigValidationError);
            expect(storedErr?.message).toContain('ssl.caFile');
            expect(envOnlyErr?.message).toContain('ssl.caFile');

        });

        it('NOORM_CONNECTION_SSL_REJECTUNAUTHORIZED fails naming ssl.rejectUnauthorized', () => {

            process.env['NOORM_CONNECTION_SSL_REJECTUNAUTHORIZED'] = 'false';

            const [, err] = attemptSync(() => resolveStored(stored(true)));

            expect(err).toBeInstanceOf(ConfigValidationError);
            expect(err?.message).toContain('ssl.rejectUnauthorized');

        });

        it('SDK inline ssl { cafile } fails naming ssl.caFile; { Ca } fails naming ssl.ca', () => {

            const lower: ConfigInput = { connection: { ssl: Object.fromEntries([['cafile', 'x']]) } };
            const upper: ConfigInput = { connection: { ssl: Object.fromEntries([['Ca', 'x']]) } };

            const [, lowerErr] = attemptSync(() => resolveStored(stored(true), undefined, lower));
            const [, upperErr] = attemptSync(() => resolveStored(stored(true), undefined, upper));

            expect(lowerErr?.message).toContain('ssl.caFile');
            expect(upperErr?.message).toContain('ssl.ca');

        });

        it('SDK inline ssl: null fails with ConfigValidationError, on the stored-config path and the env-only path', () => {

            const flags: ConfigInput = { connection: { ssl: Object.fromEntries([['ssl', null]]).ssl } };

            const [, storedErr] = attemptSync(() => resolveStored(stored(true), undefined, flags));
            const [, envOnlyErr] = attemptSync(() => resolveEnvOnly(flags));

            expect(storedErr).toBeInstanceOf(ConfigValidationError);
            expect(envOnlyErr).toBeInstanceOf(ConfigValidationError);

        });

        it('the correct spellings pass', () => {

            process.env['NOORM_CONNECTION_SSL_caFile'] = './ca.pem';
            const config = resolveStored(stored(true));

            expect(config!.connection.ssl).toEqual({ caFile: './ca.pem' });

        });

        it('stored ssl false over a stage object is off', () => {

            const config = resolveStored(stored(false), stageSsl({ caFile: './stage-ca.pem' }));

            expect(config!.connection.ssl).toBe(false);

        });

        it('environment ca with caFile fails naming ssl.ca', () => {

            process.env['NOORM_CONNECTION_SSL_CA'] = 'PEM';
            process.env['NOORM_CONNECTION_SSL_caFile'] = './ca.pem';

            const [, storedErr] = attemptSync(() => resolveStored(stored(true)));
            const [, envOnlyErr] = attemptSync(() => resolveEnvOnly());

            expect(storedErr).toBeInstanceOf(ConfigValidationError);
            expect(envOnlyErr).toBeInstanceOf(ConfigValidationError);
            expect(storedErr?.message).toContain('ssl.ca');
            expect(envOnlyErr?.message).toContain('ssl.ca');

        });

        it('SDK inline ca with caFile fails naming ssl.ca', () => {

            const flags: ConfigInput = { connection: { ssl: { ca: 'PEM', caFile: './ca.pem' } } };

            const [, storedErr] = attemptSync(() => resolveStored(stored(true), undefined, flags));
            const [, envOnlyErr] = attemptSync(() => resolveEnvOnly(flags));

            expect(storedErr).toBeInstanceOf(ConfigValidationError);
            expect(envOnlyErr).toBeInstanceOf(ConfigValidationError);
            expect(storedErr?.message).toContain('ssl.ca');
            expect(envOnlyErr?.message).toContain('ssl.ca');

        });

        it('environment ca with caFile under an SDK inline ssl { caFile } fails naming ssl.ca, on the stored-config path and the env-only path', () => {

            process.env['NOORM_CONNECTION_SSL_CA'] = 'PEM';
            process.env['NOORM_CONNECTION_SSL_caFile'] = './ca.pem';
            const flags: ConfigInput = { connection: { ssl: { caFile: './inline-ca.pem' } } };

            const [, storedErr] = attemptSync(() => resolveStored(stored(true), undefined, flags));
            const [, envOnlyErr] = attemptSync(() => resolveEnvOnly(flags));

            expect(storedErr).toBeInstanceOf(ConfigValidationError);
            expect(envOnlyErr).toBeInstanceOf(ConfigValidationError);
            expect(storedErr?.message).toContain('ssl.ca');
            expect(envOnlyErr?.message).toContain('ssl.ca');

        });

        it('should keep the stored ssl when a higher layer sets ssl to undefined', () => {

            const config = resolveStored(stored({ caFile: './stored-ca.pem' }), undefined, { connection: { ssl: undefined } });

            expect(config!.connection.ssl).toEqual({ caFile: './stored-ca.pem' });

        });

    });

    describe('ssl file paths as written', () => {

        const root = join('/', 'srv', 'project');
        const relative = 'certs/ca.pem';

        function storedWithFile(): Config {

            return createConfig({
                name: 'ci',
                connection: { dialect: 'postgres', host: 'db', database: 'app', ssl: { caFile: relative } },
            });

        }

        it('should return the stored path as written, bound to the path as written', () => {

            const stored = storedWithFile();
            const resolved = resolveConfig(createMockState({ configs: { ci: stored } }), {
                name: 'ci',
                settings: createMockSettings({}, root),
            });

            expect(resolved!.connection.ssl).toEqual({ caFile: relative });
            expect(getPolicyContext(resolved!.access)?.targetIdentity).toBe(policyTargetIdentity(root, resolved!.connection));

        });

        it('should return the env-only path as written, bound to the path as written', () => {

            process.env['NOORM_CONNECTION_DIALECT'] = 'postgres';
            process.env['NOORM_CONNECTION_DATABASE'] = 'app';
            process.env['NOORM_CONNECTION_SSL_caFile'] = relative;

            const resolved = resolveConfig(createMockState(), { settings: createMockSettings({}, root) });

            expect(resolved!.connection.ssl).toEqual({ caFile: relative });
            expect(getPolicyContext(resolved!.access)?.targetIdentity).toBe(policyTargetIdentity(root, resolved!.connection));

        });

    });

    describe('stage defaults', () => {

        it('should apply stage defaults when settings provided', () => {

            const stored = createConfig({
                name: 'prod',
                connection: {
                    dialect: 'postgres',
                    database: 'myapp',
                    host: 'localhost',
                },
            });

            const state = createMockState({
                configs: { prod: stored },
                activeConfig: 'prod',
            });

            const settings = createMockSettings({
                prod: {
                    defaults: {
                        protected: true,
                        host: 'stage-default.local',
                    },
                },
            });

            // Stored config has host=localhost, stage has host=stage-default.local
            // Stored should override stage defaults
            const config = resolveConfig(state, { settings });

            // The ceiling is policy context, not a replacement for the stored roles.
            expect(guarded(config!)).toBe(true);
            expect(config!.access).toEqual({ user: 'admin', agent: 'admin' });
            expect(config!.connection.host).toBe('localhost'); // stored overrides stage

        });

        it('should use stage defaults for missing values', () => {

            const stored = createConfig({
                name: 'prod',
                type: 'local',
                isTest: false,
                connection: {
                    dialect: 'postgres',
                    database: 'myapp',
                    host: 'localhost',
                },
            });

            const state = createMockState({
                configs: { prod: stored },
                activeConfig: 'prod',
            });

            const settings = createMockSettings({
                prod: {
                    defaults: {
                        user: 'stage-user',
                        password: 'stage-password',
                        port: 5440,
                    },
                },
            });

            const config = resolveConfig(state, { settings });

            expect(config!.connection.user).toBe('stage-user');
            expect(config!.connection.password).toBe('stage-password');
            expect(config!.connection.port).toBe(5440);

        });

        it('should find stage by config name automatically', () => {

            const stored = createConfig({ name: 'staging' });

            const state = createMockState({
                configs: { staging: stored },
                activeConfig: 'staging',
            });

            const settings = createMockSettings({
                staging: {
                    defaults: {
                        protected: true,
                    },
                },
            });

            const config = resolveConfig(state, { settings });

            // Stage restrictions do not replace the stored role names.
            expect(guarded(config!)).toBe(true);
            expect(config!.access).toEqual({ user: 'admin', agent: 'admin' });

        });

        it('should use explicit stage over config name match', () => {

            const stored = createConfig({ name: 'myconfig' });

            const state = createMockState({
                configs: { myconfig: stored },
                activeConfig: 'myconfig',
            });

            const settings = createMockSettings({
                myconfig: {
                    defaults: {
                        user: 'matching-stage-user',
                    },
                },
                production: {
                    defaults: {
                        user: 'explicit-stage-user',
                    },
                },
            });

            // Explicit stage=production should be used
            const config = resolveConfig(state, { settings, stage: 'production' });

            expect(config!.connection.user).toBe('explicit-stage-user');

        });

    });

    it('resolves custom policy without rewriting or exporting assignments', () => {

        const settings = createMockSettings();
        settings.getRoles = () => ({ auditor: { extends: 'viewer', permissions: { 'debug:read': 'deny', 'sql:write': 'allow' } } });
        const stored = createConfig({ isTest: false, access: { user: 'auditor', agent: false } });
        const resolved = withConfigPolicy(stored, settings);

        expect(resolved.access).toEqual({ user: 'auditor', agent: false });
        expect(getConfigPermission('user', resolved, 'debug:read')).toBe('deny');
        expect(getConfigPermission('user', resolved, 'sql:write')).toBe('allow');
        expect(JSON.stringify(resolved.access)).toBe('{"user":"auditor","agent":false}');
        expect(() => withConfigPolicy(createConfig({ access: { user: 'missing', agent: false } }), settings))
            .toThrow('Unknown access role "missing"');

    });

    it('should throw UnknownAccessRoleError so callers can match the type, not the message', () => {

        const [, err] = attemptSync(() => withConfigPolicy(createConfig({ access: { user: 'missing', agent: false } }), createMockSettings()));

        expect(err).toBeInstanceOf(UnknownAccessRoleError);
        expect(err?.message).toBe('Unknown access role "missing"');

    });

    // Legacy `protected`-only (no `access`) stored configs are no longer
    // representable through the typed `StateProvider`/`Config` surface —
    // `access` is required on `Config`, so the state migration (v2) and
    // `parseConfig`'s legacy mapping (tests/core/config/schema.test.ts) are
    // the only remaining places raw `protected` boolean input is resolved.

    describe('NOORM_ACCESS_* environment variables', () => {

        function prodSettings(): SettingsProvider {

            const settings = createMockSettings({ prod: { defaults: { protected: true } } });

            settings.getRoles = () => ({
                prod_operator: { extends: 'operator', permissions: { 'run:build': 'deny' } },
            });

            return settings;

        }

        it('should not raise the access roles of a stored config', () => {

            // The stored role is the guardrail; one exported variable must not lift it.
            const stored = createConfig({ name: 'prod', isTest: false, access: { user: 'prod_operator', agent: false } });
            const state = createMockState({ configs: { prod: stored } });

            process.env['NOORM_ACCESS_USER'] = 'admin';
            process.env['NOORM_ACCESS_AGENT'] = 'admin';

            const config = resolveConfig(state, { name: 'prod', settings: prodSettings() })!;

            expect(config.access).toEqual({ user: 'prod_operator', agent: false });
            expect(getConfigPermission('user', config, 'run:build')).toBe('deny');
            expect(getConfigPermission('agent', config, 'sql:read')).toBe('deny');

        });

        it('should not replace one channel of a stored config', () => {

            const stored = createConfig({ name: 'prod', isTest: false, access: { user: 'viewer', agent: false } });
            const state = createMockState({ configs: { prod: stored }, activeConfig: 'prod' });

            process.env['NOORM_ACCESS_AGENT'] = 'operator';

            const config = resolveConfig(state, { settings: prodSettings() })!;

            expect(config.access).toEqual({ user: 'viewer', agent: false });

        });

        it('should set the access roles of a config resolved from the environment alone', () => {

            // The documented way to narrow a runtime that has no stored config.
            process.env['NOORM_CONNECTION_DIALECT'] = 'sqlite';
            process.env['NOORM_CONNECTION_DATABASE'] = ':memory:';
            process.env['NOORM_ACCESS_USER'] = 'viewer';
            process.env['NOORM_ACCESS_AGENT'] = 'false';

            const config = resolveConfig(createMockState())!;

            expect(config.access).toEqual({ user: 'viewer', agent: false });

        });

    });

    describe('stage access ceiling', () => {

        function resolveWithStageProtected(
            access: { user: 'viewer' | 'operator' | 'admin'; agent: 'viewer' | 'operator' | 'admin' | false },
            stageProtected: boolean,
        ) {

            const stored = createConfig({ name: 'prod', access });
            const state = createMockState({
                configs: { prod: stored },
                activeConfig: 'prod',
            });
            const settings = createMockSettings({
                prod: {
                    defaults: {
                        protected: stageProtected,
                    },
                },
            });

            return resolveConfig(state, { settings });

        }

        it('should not clamp when the stage is not protected', () => {

            const config = resolveWithStageProtected({ user: 'admin', agent: 'admin' }, false);

            expect(config!.access).toEqual({ user: 'admin', agent: 'admin' });

        });

        it('should enforce the ceiling without replacing role names', () => {

            const config = resolveWithStageProtected({ user: 'admin', agent: 'admin' }, true);

            expect(config!.access).toEqual({ user: 'admin', agent: 'admin' });
            expect(guarded(config!)).toBe(true);

        });

        it('should leave access exactly at the ceiling unchanged', () => {

            const config = resolveWithStageProtected({ user: 'operator', agent: 'viewer' }, true);

            expect(config!.access).toEqual({ user: 'operator', agent: 'viewer' });

        });

        it('should let a stricter access survive the ceiling untouched', () => {

            const config = resolveWithStageProtected({ user: 'viewer', agent: false }, true);

            expect(config!.access).toEqual({ user: 'viewer', agent: false });
            expect(guarded(config!)).toBe(true);

        });

        it('should preserve both channels under the ceiling', () => {

            const config = resolveWithStageProtected({ user: 'admin', agent: false }, true);

            expect(config!.access).toEqual({ user: 'admin', agent: false });

        });

    });

    describe('checkConfigCompleteness', () => {

        it('should return complete when no stage', () => {

            const config = createConfig({ name: 'dev' });
            const state = createMockState();

            const result = checkConfigCompleteness(config, state);

            expect(result.complete).toBe(true);
            expect(result.missingSecrets).toEqual([]);
            expect(result.violations).toEqual([]);

        });

        it('should detect missing required secrets', () => {

            const config = createConfig({ name: 'prod', isTest: false });
            const state = createMockState({
                secrets: { prod: ['EXISTING_KEY'] },
            });

            const settings = createMockSettings({
                prod: {
                    secrets: [
                        { key: 'DB_PASSWORD', type: 'password' },
                        { key: 'EXISTING_KEY', type: 'string' },
                        { key: 'API_KEY', type: 'api_key' },
                    ],
                },
            });

            const result = checkConfigCompleteness(config, state, settings);

            expect(result.complete).toBe(false);
            expect(result.missingSecrets).toContain('DB_PASSWORD');
            expect(result.missingSecrets).toContain('API_KEY');
            expect(result.missingSecrets).not.toContain('EXISTING_KEY');

        });

        it('should ignore optional secrets', () => {

            const config = createConfig({ name: 'prod', isTest: false });
            const state = createMockState({
                secrets: { prod: [] },
            });

            const settings = createMockSettings({
                prod: {
                    secrets: [{ key: 'OPTIONAL_KEY', type: 'string', required: false }],
                },
            });

            const result = checkConfigCompleteness(config, state, settings);

            expect(result.complete).toBe(true);
            expect(result.missingSecrets).toEqual([]);

        });

        it('should not report a protected violation (enforced as an access ceiling at resolution instead)', () => {

            // A raw config can reach this check without policy context; the
            // stage ceiling is enforced by policy, not completeness.
            const config = createConfig({
                name: 'prod',
                access: { user: 'admin', agent: 'admin' },
            });
            const state = createMockState();

            const settings = createMockSettings({
                prod: {
                    defaults: {
                        protected: true,
                    },
                },
            });

            const result = checkConfigCompleteness(config, state, settings);

            expect(result.complete).toBe(true);
            expect(result.violations).toEqual([]);

        });

        it('should detect isTest constraint violation', () => {

            const config = createConfig({
                name: 'test',
                isTest: false,
            });
            const state = createMockState();

            const settings = createMockSettings({
                test: {
                    defaults: {
                        isTest: true,
                    },
                },
            });

            const result = checkConfigCompleteness(config, state, settings);

            expect(result.complete).toBe(false);
            expect(result.violations).toHaveLength(1);
            expect(result.violations[0]).toContain('isTest=true');

        });

        it('should be complete when all requirements met', () => {

            const config = createConfig({
                name: 'prod',
                access: { user: 'operator', agent: 'viewer' },
            });
            const state = createMockState({
                secrets: { prod: ['DB_PASSWORD', 'API_KEY'] },
            });

            const settings = createMockSettings({
                prod: {
                    defaults: {
                        protected: true,
                    },
                    secrets: [
                        { key: 'DB_PASSWORD', type: 'password' },
                        { key: 'API_KEY', type: 'api_key' },
                    ],
                },
            });

            const result = checkConfigCompleteness(config, state, settings);

            expect(result.complete).toBe(true);
            expect(result.missingSecrets).toEqual([]);
            expect(result.violations).toEqual([]);

        });

    });

    describe('canDeleteConfig', () => {

        it('should allow deletion without settings', () => {

            const result = canDeleteConfig('prod');

            expect(result.allowed).toBe(true);
            expect(result.reason).toBeUndefined();

        });

        it('should allow deletion when stage not locked', () => {

            const settings = createMockSettings({
                dev: {
                    locked: false,
                },
            });

            const result = canDeleteConfig('dev', settings);

            expect(result.allowed).toBe(true);

        });

        it('should block deletion when stage is locked', () => {

            const settings = createMockSettings({
                prod: {
                    locked: true,
                },
            });

            const result = canDeleteConfig('prod', settings);

            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('locked stage');
            expect(result.reason).toContain('prod');

        });

        it('should use explicit stage name when provided', () => {

            const settings = createMockSettings({
                production: {
                    locked: true,
                },
            });

            // Config name doesn't match any stage, but explicit stage does
            const result = canDeleteConfig('my-prod-db', settings, 'production');

            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('locked');

        });

    });

    describe('isTest trust for db lifecycle permissions', () => {

        const dbEnv = () => {

            process.env['NOORM_CONNECTION_DIALECT'] = 'sqlite';
            process.env['NOORM_CONNECTION_DATABASE'] = ':memory:';

        };

        it('should relax a stored isTest config', () => {

            const state = createMockState({ configs: { dev: createConfig({ name: 'dev', isTest: true }) } });
            const config = resolveConfig(state, { name: 'dev', settings: createMockSettings() })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).toBe('allow');

        });

        it('should relax an isTest stage default on an env-only config', () => {

            dbEnv();
            process.env['NOORM_NAME'] = 'ci';
            const settings = createMockSettings({ ci: { defaults: { isTest: true } } as Stage });
            const config = resolveConfig(createMockState(), { settings })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).toBe('allow');

        });

        it('should not relax an isTest stage when env retargets the database the stage declares', () => {

            dbEnv();
            process.env['NOORM_NAME'] = 'ci';
            process.env['NOORM_CONNECTION_DATABASE'] = '/data/prod.db';
            const settings = createMockSettings({
                ci: { defaults: { isTest: true, dialect: 'sqlite', database: '/tmp/ci.db' } } as Stage,
            });
            const config = resolveConfig(createMockState(), { settings })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        it('should not relax a protected isTest stage that declares no database', () => {

            dbEnv();
            process.env['NOORM_NAME'] = 'ci';
            const settings = createMockSettings({ ci: { defaults: { isTest: true, protected: true } } as Stage });
            const config = resolveConfig(createMockState(), { settings })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        it('should not relax an isTest stage without a database when env leaves out the server host', () => {

            process.env['NOORM_NAME'] = 'ci';
            process.env['NOORM_CONNECTION_DIALECT'] = 'postgres';
            process.env['NOORM_CONNECTION_DATABASE'] = 'ci_test';
            const settings = createMockSettings({ ci: { defaults: { isTest: true } } as Stage });
            const config = resolveConfig(createMockState(), { settings })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        it('should not let NOORM_isTest turn a stored isTest:false config into a relaxed one', () => {

            process.env['NOORM_isTest'] = 'true';
            const state = createMockState({ configs: { prod: createConfig({ name: 'prod', isTest: false }) } });
            const config = resolveConfig(state, { name: 'prod', settings: createMockSettings() })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');
            expect(getConfigPermission('agent', config, 'db:teardown')).not.toBe('allow');

        });

        it('should not let a flag overlay turn a stored isTest:false config into a relaxed one', () => {

            const state = createMockState({ configs: { prod: createConfig({ name: 'prod', isTest: false }) } });
            const config = resolveConfig(state, { name: 'prod', flags: { isTest: true }, settings: createMockSettings() })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        it('should relax an env-only config flagged isTest', () => {

            dbEnv();
            process.env['NOORM_isTest'] = 'true';
            const config = resolveConfig(createMockState(), { settings: createMockSettings() })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).toBe('allow');

        });

        it('should not relax an env-only config without isTest', () => {

            dbEnv();
            const config = resolveConfig(createMockState(), { settings: createMockSettings() })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        it('should ignore env isTest when the stage declares isTest: false', () => {

            dbEnv();
            process.env['NOORM_NAME'] = 'prod';
            process.env['NOORM_isTest'] = 'true';
            const settings = createMockSettings({ prod: { defaults: { isTest: false } } as Stage });
            const config = resolveConfig(createMockState(), { settings })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        it('should ignore env isTest on a protected stage whose target the stage supplies', () => {

            process.env['NOORM_NAME'] = 'prod';
            process.env['NOORM_CONNECTION_DIALECT'] = 'sqlite';
            process.env['NOORM_isTest'] = 'true';
            const settings = createMockSettings({
                prod: { defaults: { protected: true, isTest: false, dialect: 'sqlite', database: '/data/prod.db' } } as Stage,
            });
            const config = resolveConfig(createMockState(), { settings })!;

            expect(config.connection.database).toBe('/data/prod.db');
            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        it('should ignore env isTest on a protected stage even when env supplies the target', () => {

            dbEnv();
            process.env['NOORM_NAME'] = 'prod';
            process.env['NOORM_isTest'] = 'true';
            const settings = createMockSettings({ prod: { defaults: { protected: true } } as Stage });
            const config = resolveConfig(createMockState(), { settings })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        it('should ignore env isTest when a flag-driven resolve names a protected stage', () => {

            process.env['NOORM_isTest'] = 'true';
            const state = createMockState({
                configs: { prod: createConfig({ name: 'prod', isTest: false }) },
                activeConfig: 'prod',
            });
            const settings = createMockSettings({
                prod: { defaults: { protected: true, isTest: false, dialect: 'sqlite', database: '/data/prod.db' } } as Stage,
            });
            const config = resolveConfig(state, {
                stage: 'prod',
                flags: { connection: { user: 'x' } },
                settings,
            })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        it('should ignore env isTest when the database comes from a stage default', () => {

            process.env['NOORM_NAME'] = 'ci';
            process.env['NOORM_CONNECTION_DIALECT'] = 'sqlite';
            process.env['NOORM_isTest'] = 'true';
            const settings = createMockSettings({ ci: { defaults: { dialect: 'sqlite', database: '/data/real.db' } } as Stage });
            const config = resolveConfig(createMockState(), { settings })!;

            expect(config.connection.database).toBe('/data/real.db');
            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        it('should ignore env isTest on a server dialect when the host is not supplied', () => {

            process.env['NOORM_NAME'] = 'test';
            process.env['NOORM_CONNECTION_DIALECT'] = 'postgres';
            process.env['NOORM_CONNECTION_DATABASE'] = 'app';
            process.env['NOORM_isTest'] = 'true';
            const config = resolveConfig(createMockState(), { settings: createMockSettings() })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        it('should relax an env-only config when env supplies the whole target and no stage or stored config applies', () => {

            process.env['NOORM_NAME'] = 'test';
            process.env['NOORM_CONNECTION_DIALECT'] = 'postgres';
            process.env['NOORM_CONNECTION_HOST'] = 'localhost';
            process.env['NOORM_CONNECTION_PORT'] = '5432';
            process.env['NOORM_CONNECTION_DATABASE'] = 'upm_test';
            process.env['NOORM_CONNECTION_USER'] = 'u';
            process.env['NOORM_CONNECTION_PASSWORD'] = 'p';
            process.env['NOORM_isTest'] = 'true';
            const config = resolveConfig(createMockState(), { settings: createMockSettings() })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).toBe('allow');

        });

        describe('stage or stored target without a declared port', () => {

            const upmStage = (): Stage => ({
                defaults: { dialect: 'mssql', host: 'localhost', database: 'upm_test', isTest: true },
            } as Stage);

            beforeEach(() => {

                process.env['NOORM_NAME'] = 'test';
                process.env['NOORM_isTest'] = 'true';

            });

            it('should relax when the stage declares no port and env supplies one', () => {

                process.env['NOORM_CONNECTION_PORT'] = '11433';
                const settings = createMockSettings({ test: upmStage() });
                const config = resolveConfig(createMockState(), { settings })!;

                expect(config.connection.port).toBe(11433);
                expect(getConfigPermission('agent', config, 'db:destroy')).toBe('allow');

            });

            it('should refuse when env changes the host the stage declares', () => {

                process.env['NOORM_CONNECTION_PORT'] = '11433';
                process.env['NOORM_CONNECTION_HOST'] = 'prod.example.com';
                const settings = createMockSettings({ test: upmStage() });
                const config = resolveConfig(createMockState(), { settings })!;

                expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

            });

            it('should refuse when env changes the database of the stage', () => {

                process.env['NOORM_CONNECTION_PORT'] = '11433';
                process.env['NOORM_CONNECTION_DATABASE'] = 'upm_prod';
                const settings = createMockSettings({ test: upmStage() });
                const config = resolveConfig(createMockState(), { settings })!;

                expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

            });

            it('should relax a stored isTest config without a port when env supplies one', () => {

                process.env['NOORM_CONNECTION_PORT'] = '11433';
                const state = createMockState({
                    configs: {
                        test: createConfig({
                            name: 'test',
                            isTest: true,
                            connection: { dialect: 'mssql', host: 'localhost', database: 'upm_test' },
                        }),
                    },
                    activeConfig: 'test',
                });
                const config = resolveConfig(state, { settings: createMockSettings() })!;

                expect(getConfigPermission('agent', config, 'db:destroy')).toBe('allow');

            });

            it('should not take isTest from the stage of an explicit stage option for a stored config without the flag', () => {

                const stored = createConfig({ name: 'prod', connection: { dialect: 'mssql', host: 'localhost', database: 'upm_test' } });
                Reflect.deleteProperty(stored, 'isTest');
                const state = createMockState({ configs: { prod: stored }, activeConfig: 'prod' });
                const settings = createMockSettings({ test: upmStage() });
                const config = resolveConfig(state, { stage: 'test', settings })!;

                expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

            });

        });

        it('should relax an env-only sqlite config when its isTest stage supplies the target and env only sets credentials', () => {

            process.env['NOORM_NAME'] = 'ci';
            process.env['NOORM_CONNECTION_USER'] = 'u';
            const settings = createMockSettings({
                ci: { defaults: { isTest: true, dialect: 'sqlite', database: '/tmp/ci.db' } } as Stage,
            });
            const config = resolveConfig(createMockState(), { settings })!;

            expect(config.connection.database).toBe('/tmp/ci.db');
            expect(getConfigPermission('agent', config, 'db:destroy')).toBe('allow');

        });

        it('should relax a named env-only sqlite config when the stored isTest config it displaces has the same target', () => {

            process.env['NOORM_NAME'] = 'test';
            process.env['NOORM_CONNECTION_DIALECT'] = 'sqlite';
            process.env['NOORM_CONNECTION_DATABASE'] = '/tmp/stored.db';
            process.env['NOORM_isTest'] = 'true';
            const state = createMockState({
                configs: {
                    test: createConfig({ name: 'test', isTest: true, connection: { dialect: 'sqlite', database: '/tmp/stored.db' } }),
                },
            });
            const config = resolveConfig(state, { unstoredName: 'scratch', settings: createMockSettings() })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).toBe('allow');

        });

        describe('connection retargeting', () => {

            const stored = () => createConfig({
                name: 'test',
                connection: {
                    dialect: 'postgres',
                    host: 'localhost',
                    port: 5432,
                    database: 'app_test',
                    user: 'postgres',
                    password: 'pw',
                },
            });
            const state = () => createMockState({ configs: { test: stored() }, activeConfig: 'test' });

            it('should keep the relaxation when nothing retargets the connection', () => {

                const config = resolveConfig(state(), { settings: createMockSettings() })!;

                expect(getConfigPermission('agent', config, 'db:destroy')).toBe('allow');

            });

            it('should refuse when env overrides the database', () => {

                process.env['NOORM_CONNECTION_DATABASE'] = 'app_dev';
                const config = resolveConfig(state(), { settings: createMockSettings() })!;

                expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

            });

            it('should refuse when env overrides the host', () => {

                process.env['NOORM_CONNECTION_HOST'] = 'prod.example.com';
                const config = resolveConfig(state(), { settings: createMockSettings() })!;

                expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

            });

            it('should refuse when env overrides the port', () => {

                process.env['NOORM_CONNECTION_PORT'] = '5433';
                const config = resolveConfig(state(), { settings: createMockSettings() })!;

                expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

            });

            it('should refuse when a flag overrides the database', () => {

                const config = resolveConfig(state(), {
                    name: 'test',
                    flags: { connection: { database: 'app_dev' } },
                    settings: createMockSettings(),
                })!;

                expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

            });

            it('should keep the relaxation when only credentials change and the target is the same', () => {

                process.env['NOORM_CONNECTION_USER'] = 'other';
                process.env['NOORM_CONNECTION_PASSWORD'] = 'other-pw';
                const config = resolveConfig(state(), { settings: createMockSettings() })!;

                expect(config.connection.user).toBe('other');
                expect(getConfigPermission('agent', config, 'db:destroy')).toBe('allow');

            });

            it('should keep the relaxation when an override restates the stored target', () => {

                process.env['NOORM_CONNECTION_DATABASE'] = 'app_test';
                const config = resolveConfig(state(), { settings: createMockSettings() })!;

                expect(getConfigPermission('agent', config, 'db:destroy')).toBe('allow');

            });

        });

        it('should let a same-named stage declaring isTest: false win when an explicit stage is passed', () => {

            dbEnv();
            process.env['NOORM_NAME'] = 'prod';
            process.env['NOORM_isTest'] = 'true';
            const settings = createMockSettings({
                prod: { defaults: { isTest: false } } as Stage,
                other: { defaults: {} } as Stage,
            });
            const config = resolveConfig(createMockState(), { stage: 'other', settings })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        it('should keep the relaxation through withConfigPolicy on a stored isTest config', () => {

            const config = withConfigPolicy(createConfig({ isTest: true }), createMockSettings());

            expect(getConfigPermission('agent', config, 'db:destroy')).toBe('allow');

        });

    });

    // Secrets, vault lookups and tracking records are keyed by name, so an env-only context must not borrow a stored one.
    describe('env-only name of a stored config', () => {

        const inline = { connection: { dialect: 'sqlite' as const, database: ':memory:' } };
        const prodStored = () => createMockState({ configs: { prod: createConfig({ name: 'prod' }) } });

        it('should refuse a NOORM_NAME that a stored config has', () => {

            process.env['NOORM_NAME'] = 'prod';
            process.env['NOORM_CONNECTION_DIALECT'] = 'sqlite';
            process.env['NOORM_CONNECTION_DATABASE'] = ':memory:';

            const [config, err] = attemptSync(() => resolveConfig(prodStored()));

            expect(config).toBeNull();
            expect(err?.message).toContain('a stored config is named "prod"');
            expect(err?.message).toContain('NOORM_CONFIG=prod');

        });

        it('should refuse a flags name that a stored config has', () => {

            const [config, err] = attemptSync(() => resolveConfig(prodStored(), { flags: { name: 'prod', ...inline } }));

            expect(config).toBeNull();
            expect(err?.message).toContain('a stored config is named "prod"');

        });

        it('should refuse a generated name that a stored config has', () => {

            const state = createMockState({ configs: { __inline__: createConfig({ name: '__inline__' }) } });

            const [, err] = attemptSync(() => resolveConfig(state, { flags: inline }));

            expect(err?.message).toContain('a stored config is named "__inline__"');

        });

        it('should accept a NOORM_NAME no stored config has', () => {

            process.env['NOORM_NAME'] = 'ci';

            const config = resolveConfig(prodStored(), { flags: inline })!;

            expect(config.name).toBe('ci');

        });

        it('should still select the stored config through NOORM_CONFIG', () => {

            process.env['NOORM_CONFIG'] = 'prod';

            const config = resolveConfig(prodStored())!;

            expect(config.name).toBe('prod');
            expect(config.connection.database).toBe(createConfig().connection.database);

        });

        // Flags outrank env in the merge, so the name that is checked must be the one the config ends up with.
        it('should name the context from flags over NOORM_NAME', () => {

            process.env['NOORM_NAME'] = 'prod';

            const config = resolveConfig(prodStored(), { flags: { name: 'ci', ...inline } })!;

            expect(config.name).toBe('ci');

        });

        it('should take stage defaults from the flags name, not from NOORM_NAME', () => {

            process.env['NOORM_NAME'] = 'dev';
            const settings = createMockSettings({
                staging: { defaults: { host: 'staging-host' } } as Stage,
                dev: { defaults: { host: 'dev-host' } } as Stage,
            });

            const config = resolveConfig(createMockState(), {
                flags: { name: 'staging', connection: { dialect: 'postgres', database: 'app' } },
                settings,
            })!;

            expect(config.name).toBe('staging');
            expect(config.connection.host).toBe('staging-host');

        });

        it('should refuse a flags name of a stored config even when NOORM_NAME is free', () => {

            process.env['NOORM_NAME'] = 'ci';

            const [, err] = attemptSync(() => resolveConfig(prodStored(), { flags: { name: 'prod', ...inline } }));

            expect(err?.message).toContain('a stored config is named "prod"');

        });

    });

    // The SDK keys secrets, vault lookups and tracking records by the merged name, so an overlay must not land on another stored config's.
    describe('renaming a selected stored config', () => {

        const devAndProd = () => createMockState({
            configs: { dev: createConfig({ name: 'dev' }), prod: createConfig({ name: 'prod' }) },
        });
        const refusal = 'cannot rename config "dev" to the name of stored config "prod"';

        it('should refuse a NOORM_NAME that another stored config has', () => {

            process.env['NOORM_CONFIG'] = 'dev';
            process.env['NOORM_NAME'] = 'prod';

            const [config, err] = attemptSync(() => resolveConfig(devAndProd()));

            expect(config).toBeNull();
            expect(err?.message).toContain(refusal);

        });

        it('should refuse a flags name that another stored config has', () => {

            const [config, err] = attemptSync(() => resolveConfig(devAndProd(), { name: 'dev', flags: { name: 'prod' } }));

            expect(config).toBeNull();
            expect(err?.message).toContain(refusal);

        });

        it('should accept an overlay that repeats the selected name', () => {

            process.env['NOORM_NAME'] = 'dev';

            expect(resolveConfig(devAndProd(), { name: 'dev' })!.name).toBe('dev');

        });

        it('should keep the protected ceiling when renamed to a name no stored config has', () => {

            process.env['NOORM_NAME'] = 'scratch';
            const state = createMockState({ configs: { prod: createConfig({ name: 'prod', isTest: false }) } });
            const settings = createMockSettings({ prod: { defaults: { protected: true } } });

            const config = resolveConfig(state, { name: 'prod', settings })!;

            expect(config.name).toBe('scratch');
            expect(getConfigPermission('user', config, 'sql:ddl')).toBe('deny');

        });

    });

    describe('unstoredName', () => {

        const inline = { connection: { dialect: 'sqlite' as const, database: ':memory:' } };
        const protectedProd = () => createMockSettings({
            prod: { defaults: { protected: true } },
            dev: { defaults: {} },
        });

        // NOORM_NAME is process-wide, so it cannot tell two contexts in one process apart.
        it('should win over NOORM_NAME', () => {

            process.env['NOORM_NAME'] = 'from-env';
            const config = resolveConfig(createMockState(), { unstoredName: 'reporting', flags: inline })!;

            expect(config.name).toBe('reporting');

        });

        it('should name an env-only config that has no inline connection', () => {

            process.env['NOORM_CONNECTION_DIALECT'] = 'sqlite';
            process.env['NOORM_CONNECTION_DATABASE'] = ':memory:';
            const config = resolveConfig(createMockState(), { unstoredName: 'reporting' })!;

            expect(config.name).toBe('reporting');

        });

        // Renaming a stored config would change which stage and protected-stage ceiling apply to it.
        it.each(['option', 'environment', 'active'] as const)('should refuse to rename a stored config selected by %s', (selector) => {

            const state = createMockState({
                configs: { dev: createConfig({ name: 'dev' }) },
                activeConfig: selector === 'active' ? 'dev' : null,
            });
            if (selector === 'environment') process.env['NOORM_CONFIG'] = 'dev';

            const [config, err] = attemptSync(() => resolveConfig(state, {
                name: selector === 'option' ? 'dev' : undefined,
                unstoredName: 'reporting',
            }));

            expect(config).toBeNull();
            expect(err?.message).toContain('stored config "dev"');

        });

        it('should apply the ceiling of a protected stage the config is named after', () => {

            const config = resolveConfig(createMockState(), { unstoredName: 'prod', settings: protectedProd(), flags: inline })!;

            expect(getConfigPermission('user', config, 'sql:ddl')).toBe('deny');

        });

        it('should keep the ceiling of a protected stage option under an unrelated name', () => {

            const config = resolveConfig(createMockState(), {
                unstoredName: 'scratch', stage: 'prod', settings: protectedProd(), flags: inline,
            })!;

            expect(getConfigPermission('user', config, 'sql:ddl')).toBe('deny');

        });

        it('should keep the ceiling of the protected NOORM_NAME stage it displaces', () => {

            process.env['NOORM_NAME'] = 'prod';
            const config = resolveConfig(createMockState(), { unstoredName: 'scratch', settings: protectedProd(), flags: inline })!;

            expect(getConfigPermission('user', config, 'sql:ddl')).toBe('deny');

        });

        // Local secrets, vault lookups and history are keyed by name, so the name would reach the stored config's.
        // A stored config is the saved record; resolving with overlays must never change what the next save writes.
        it('should leave a stored config unchanged when an inline overlay is resolved on top of it', () => {

            const stored = createConfig({ name: 'app', access: { user: 'operator', agent: 'viewer' } });
            stored.connection.ssl = { rejectUnauthorized: true };
            const state = createMockState({ configs: { app: stored } });

            const resolved = resolveConfig(state, {
                name: 'app',
                flags: { connection: { ssl: { rejectUnauthorized: false } }, access: { user: 'admin', agent: 'admin' } } as ConfigInput,
            });

            expect(resolved?.connection.ssl).toEqual({ rejectUnauthorized: false });
            expect(stored.connection.ssl).toEqual({ rejectUnauthorized: true });
            expect(stored.access).toEqual({ user: 'operator', agent: 'viewer' });

        });

        it('should refuse the name of a stored config', () => {

            const state = createMockState({ configs: { prod: createConfig({ name: 'prod' }) } });

            const [config, err] = attemptSync(() => resolveConfig(state, { name: false, unstoredName: 'prod', flags: inline }));

            expect(config).toBeNull();
            expect(err?.message).toContain('a stored config is named "prod"');

        });

        it('should not take the defaults of a stage it is named after', () => {

            const settings = createMockSettings({
                dev: { defaults: { user: 'stage-user', password: 'stage-pw', ssl: false, isTest: true, access: { user: 'admin', agent: 'admin' } } } as Stage,
            });
            const config = resolveConfig(createMockState(), { unstoredName: 'dev', settings, flags: inline })!;

            expect(config.connection.user).toBeUndefined();
            expect(config.connection.password).toBeUndefined();
            expect(config.connection.ssl).toBeUndefined();
            expect(config.isTest).toBe(false);
            expect({ ...config.access }).toEqual({ user: 'admin', agent: 'viewer' });

        });

        // Passing a name must not shed what NOORM_NAME's stage already imposed.
        it('should keep the defaults of the NOORM_NAME stage it displaces', () => {

            process.env['NOORM_NAME'] = 'staging';
            const settings = createMockSettings({ staging: { defaults: { access: { user: 'viewer', agent: false } } } as Stage });
            const config = resolveConfig(createMockState(), { unstoredName: 'reporting', settings, flags: inline })!;

            expect({ ...config.access }).toEqual({ user: 'viewer', agent: false });

        });

        it('should take stage defaults from an explicit stage option', () => {

            const settings = createMockSettings({ ci: { defaults: { user: 'stage-user', isTest: true } } as Stage });
            const config = resolveConfig(createMockState(), { unstoredName: 'scratch', stage: 'ci', settings, flags: inline })!;

            expect(config.connection.user).toBe('stage-user');
            expect(getConfigPermission('agent', config, 'db:destroy')).toBe('allow');

        });

        // Trusted isTest outranks the ceiling, so the displaced protected stage has to refuse the flag itself.
        it('should not trust env isTest by displacing a NOORM_NAME that names a protected stage', () => {

            process.env['NOORM_NAME'] = 'prod';
            process.env['NOORM_isTest'] = 'true';
            const config = resolveConfig(createMockState(), { unstoredName: 'scratch', settings: protectedProd(), flags: inline })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        it('should not trust env isTest when the displaced NOORM_NAME has a stored isTest config with another target', () => {

            process.env['NOORM_NAME'] = 'test';
            process.env['NOORM_isTest'] = 'true';
            const stored = createConfig({ name: 'test', isTest: true, connection: { dialect: 'sqlite', database: '/tmp/stored.db' } });
            const state = createMockState({ configs: { test: stored } });
            const config = resolveConfig(state, { unstoredName: 'scratch', settings: createMockSettings(), flags: inline })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        it('should not trust env isTest when named after a protected stage', () => {

            process.env['NOORM_isTest'] = 'true';
            const config = resolveConfig(createMockState(), { unstoredName: 'prod', settings: protectedProd(), flags: inline })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        it('should not trust env isTest by displacing a NOORM_NAME whose stored config is not isTest', () => {

            process.env['NOORM_NAME'] = 'prod';
            process.env['NOORM_isTest'] = 'true';
            const state = createMockState({ configs: { prod: createConfig({ name: 'prod', isTest: false }) } });
            const config = resolveConfig(state, { unstoredName: 'scratch', settings: createMockSettings(), flags: inline })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        it('should not trust env isTest by displacing a NOORM_NAME whose stage declares isTest: false', () => {

            process.env['NOORM_NAME'] = 'prod';
            process.env['NOORM_isTest'] = 'true';
            const settings = createMockSettings({ prod: { defaults: { isTest: false } } as Stage });
            const config = resolveConfig(createMockState(), { unstoredName: 'scratch', settings, flags: inline })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        // The harness path of spec item 6a must survive a name: the caller supplies its own target.
        it('should still trust env isTest under a name no stage or stored config restricts', () => {

            process.env['NOORM_isTest'] = 'true';
            const config = resolveConfig(createMockState(), { unstoredName: 'scratch', settings: createMockSettings(), flags: inline })!;

            expect(getConfigPermission('agent', config, 'db:destroy')).toBe('allow');

        });

    });

    describe('name: false', () => {

        const inline = { connection: { dialect: 'sqlite' as const, database: '/tmp/inline.db' } };

        // A process can inherit NOORM_CONFIG for a stored config its checkout does not have.
        it('should ignore NOORM_CONFIG and resolve from the inline connection', () => {

            process.env['NOORM_CONFIG'] = 'dev';
            const config = resolveConfig(createMockState(), { name: false, flags: inline })!;

            expect(config.name).toBe('__inline__');
            expect(config.connection.database).toBe('/tmp/inline.db');

        });

        it('should ignore the active config when only environment fields supply the connection', () => {

            process.env['NOORM_CONNECTION_DIALECT'] = 'sqlite';
            process.env['NOORM_CONNECTION_DATABASE'] = '/tmp/env.db';
            const state = createMockState({ configs: { test: createConfig() }, activeConfig: 'test' });
            const config = resolveConfig(state, { name: false })!;

            expect(config.name).toBe('__env__');
            expect(config.connection.database).toBe('/tmp/env.db');

        });

        it('should return null instead of falling back to the active config when no connection is supplied', () => {

            const state = createMockState({ configs: { test: createConfig() }, activeConfig: 'test' });

            expect(resolveConfig(state, { name: false })).toBeNull();

        });

        it('should not merge the stored config NOORM_CONFIG names when env supplies the target', () => {

            process.env['NOORM_CONFIG'] = 'test';
            process.env['NOORM_CONNECTION_DIALECT'] = 'sqlite';
            process.env['NOORM_CONNECTION_DATABASE'] = '/tmp/env.db';
            const stored = createConfig({ connection: { dialect: 'sqlite', database: '/tmp/stored.db', user: 'stored-user' } });
            const config = resolveConfig(createMockState({ configs: { test: stored } }), { name: false, settings: createMockSettings() })!;

            expect(config.name).toBe('__env__');
            expect(config.connection.database).toBe('/tmp/env.db');
            expect(config.connection.user).toBeUndefined();
            expect(getConfigPermission('agent', config, 'db:destroy')).not.toBe('allow');

        });

        // "No stored config" is not "no settings": a stage the caller asks for still supplies defaults and its ceiling.
        it('should still apply the defaults and ceiling of an explicit stage', () => {

            const settings = createMockSettings({ prod: { defaults: { user: 'stage-user', protected: true } } as Stage });
            const config = resolveConfig(createMockState(), { name: false, stage: 'prod', settings, flags: inline })!;

            expect(config.connection.user).toBe('stage-user');
            expect(getConfigPermission('user', config, 'sql:ddl')).toBe('deny');

        });

        // Without the opt-out, NOORM_CONFIG plus an inline connection means "stored base, inline on top".
        it('should keep NOORM_CONFIG as the base, with trusted isTest, when the opt-out is not used', () => {

            process.env['NOORM_CONFIG'] = 'test';
            const stored = createConfig({ connection: { dialect: 'sqlite', database: '/tmp/stored.db', user: 'stored-user' } });
            const state = createMockState({ configs: { test: stored } });
            const config = resolveConfig(state, {
                settings: createMockSettings(),
                flags: { connection: { dialect: 'sqlite', database: '/tmp/stored.db' } },
            })!;

            expect(config.name).toBe('test');
            expect(config.connection.user).toBe('stored-user');
            expect(getConfigPermission('agent', config, 'db:destroy')).toBe('allow');

        });

    });

    describe('effectiveConfig', () => {

        const connection: Config['connection'] = { dialect: 'postgres', database: 'app', host: 'db' };

        function stored(overrides: Partial<Config> = {}): Config {

            return createConfig({ name: 'ci', isTest: false, access: { user: 'viewer', agent: 'viewer' }, connection, ...overrides });

        }

        function stage(defaults: Stage['defaults']): SettingsProvider {

            return createMockSettings({ ci: { defaults } });

        }

        const tlsStage = () => stage({ ssl: { caFile: './certs/ca.pem' }, user: 'stage-user', password: 'stage-pw', port: 6543 });

        it('should give a stored config the caFile and password of its stage', () => {

            const config = effectiveConfig(stored(), tlsStage());

            expect(config.connection.ssl).toEqual({ caFile: './certs/ca.pem' });
            expect(config.connection.password).toBe('stage-pw');

        });

        it('should equal the resolveConfig connection when no NOORM_ variable is set', () => {

            const config = stored({ connection: { ...connection, ssl: true } });
            const resolved = resolveConfig(createMockState({ configs: { ci: config } }), { name: 'ci', settings: tlsStage() });

            expect(effectiveConfig(config, tlsStage()).connection).toEqual(resolved?.connection);

        });

        it('should ignore NOORM_CONNECTION_HOST', () => {

            const before = effectiveConfig(stored(), tlsStage());

            process.env['NOORM_CONNECTION_HOST'] = 'env.example.com';

            const after = effectiveConfig(stored(), tlsStage());

            expect(after).toEqual(before);
            expect(after.connection.host).toBe('db');

        });

        it('should keep the stored roles when NOORM_ACCESS_USER is set', () => {

            process.env['NOORM_ACCESS_USER'] = 'admin';

            expect(effectiveConfig(stored(), tlsStage()).access).toEqual({ user: 'viewer', agent: 'viewer' });

        });

        it('should bind the target identity of the effective connection', () => {

            const config = effectiveConfig(stored(), tlsStage());

            expect(getPolicyContext(config.access)?.targetIdentity)
                .toBe(policyTargetIdentity('/test-project', config.connection));

        });

        it('should mutate neither the stored config nor the stage defaults', () => {

            const config = stored({ connection: { ...connection, ssl: { certFile: './client.pem' }, pool: { max: 3 } } });
            const defaults: Stage['defaults'] = { ssl: { caFile: './certs/ca.pem' }, user: 'stage-user' };
            const configBefore = structuredClone(config);
            const defaultsBefore = structuredClone(defaults);

            effectiveConfig(config, stage(defaults));

            expect(config).toEqual(configBefore);
            expect(defaults).toEqual(defaultsBefore);

        });

        it('should lay a form connection over the stage defaults', () => {

            const form: Config['connection'] = { dialect: 'postgres', database: 'typed', host: 'form-host', port: 5432 };
            const config = effectiveConfig({ name: 'ci', connection: form }, tlsStage());

            expect(config.connection).toMatchObject({ ...form, user: 'stage-user', ssl: { caFile: './certs/ca.pem' } });

        });

        it('should take type, isTest and access from the stage where the stored config lacks them', () => {

            const settings = stage({ type: 'remote', isTest: true, access: { user: 'operator', agent: false } });
            const config = effectiveConfig({ name: 'ci', connection }, settings);

            expect(config.type).toBe('remote');
            expect(config.isTest).toBe(true);
            expect(config.access).toEqual({ user: 'operator', agent: false });

        });

        // A trusted isTest gives every role at least the admin cell, so a stage must not be able to grant it.
        it.each([true, false])('should not trust a stage isTest (roles validated: %p)', (validate) => {

            const settings = stage({ isTest: true });
            const untrusted = effectiveConfig({ name: 'ci', access: { user: 'viewer', agent: 'viewer' }, connection }, settings, validate);
            const trusted = effectiveConfig(stored({ isTest: true }), settings, validate);

            expect(untrusted.isTest).toBe(true);
            expect(getPolicyContext(untrusted.access)?.isTest).toBe(false);
            expect(getConfigPermission('user', untrusted, 'db:destroy')).toBe('deny');
            expect(getPolicyContext(trusted.access)?.isTest).toBe(true);

        });

        it('should have the policy fingerprint of the resolveConfig result when no NOORM_ variable is set', () => {

            const config = stored();
            const resolved = resolveConfig(createMockState({ configs: { ci: config } }), { name: 'ci', settings: tlsStage() });

            if (!resolved) throw new Error('resolveConfig returned no config for "ci"');

            expect(getPolicyFingerprint(effectiveConfig(config, tlsStage()))).toBe(getPolicyFingerprint(resolved));

        });

        it('should treat an undefined stored user and password as absent', () => {

            const config = effectiveConfig(stored({ connection: { ...connection, user: undefined, password: undefined } }), tlsStage());

            expect(config.connection.user).toBe('stage-user');
            expect(config.connection.password).toBe('stage-pw');

        });

        it('should take the stage roles when the stored access is undefined', () => {

            const settings = stage({ access: { user: 'viewer', agent: false } });
            const config = effectiveConfig({ name: 'ci', access: undefined, connection }, settings);

            expect(config.access).toEqual({ user: 'viewer', agent: false });

        });

        it('should treat an undefined form user and password as absent', () => {

            const form: Config['connection'] = { ...connection, host: 'form-host', user: undefined, password: undefined };
            const config = effectiveConfig({ name: 'ci', connection: form }, tlsStage());

            expect(config.connection.user).toBe('stage-user');
            expect(config.connection.password).toBe('stage-pw');

        });

        it('should throw on an unknown role when roles are validated and bind it when they are not', () => {

            const config = stored({ access: { user: 'ghost', agent: 'viewer' } });

            expect(() => effectiveConfig(config, tlsStage())).toThrow(UnknownAccessRoleError);

            const bound = effectiveConfig(config, tlsStage(), false);

            expect(bound.access.user).toBe('ghost');
            expect(getPolicyContext(bound.access)).toBeDefined();

        });

    });

});
