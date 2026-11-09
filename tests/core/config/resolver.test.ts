/**
 * Config resolver tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { attemptSync } from '@logosdx/utils';

import {
    resolveConfig,
    checkConfigCompleteness,
    canDeleteConfig,
    type StateProvider,
} from '../../../src/core/config/index.js';
import { SettingsProvider, withConfigPolicy } from '../../../src/core/config/resolver.js';
import type { Config } from '../../../src/core/config/index.js';
import { getConfigPermission, guarded, UnknownAccessRoleError } from '../../../src/core/policy/index.js';
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
function createMockSettings(stages: Record<string, Stage> = {}): SettingsProvider {

    const manager = {
        projectRoot: '/test-project',
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

            const state = createMockState({ configs: { prod: createConfig({ name: 'prod' }) } });
            const settings = createMockSettings({
                prod: { defaults: { protected: true } },
                dev: { defaults: {} },
            });
            const config = resolveConfig(state, { name: 'prod', stage: 'dev', settings })!;

            expect(getConfigPermission('user', config, 'sql:ddl')).toBe('deny');
            expect(getConfigPermission('agent', config, 'sql:ddl')).toBe('deny');

        });

        it('should cap an unprotected config when the caller selects a protected stage', () => {

            const state = createMockState({ configs: { dev: createConfig({ name: 'dev' }) } });
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
            const state = createMockState({ configs: { prod: createConfig({ name: 'prod' }) } });
            const settings = createMockSettings({ prod: { defaults: { protected: true } } });
            const config = resolveConfig(state, { name: 'prod', settings })!;

            expect(getConfigPermission('user', config, 'sql:ddl')).toBe('deny');

        });

        it('should keep the ceiling when a flag renames a stored protected-stage config', () => {

            const state = createMockState({ configs: { prod: createConfig({ name: 'prod' }) } });
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
        const stored = createConfig({ access: { user: 'auditor', agent: false } });
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

            const config = createConfig({ name: 'prod' });
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

            const config = createConfig({ name: 'prod' });
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

        it('should ignore env isTest when a stored config of that name is not isTest', () => {

            dbEnv();
            process.env['NOORM_NAME'] = 'prod';
            process.env['NOORM_isTest'] = 'true';
            const state = createMockState({ configs: { prod: createConfig({ name: 'prod', isTest: false }) } });
            const config = resolveConfig(state, { settings: createMockSettings() })!;

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

        it('should relax an env-only sqlite config whose same-named stored isTest config has the same target', () => {

            process.env['NOORM_NAME'] = 'test';
            process.env['NOORM_CONNECTION_DIALECT'] = 'sqlite';
            process.env['NOORM_CONNECTION_DATABASE'] = '/tmp/stored.db';
            process.env['NOORM_isTest'] = 'true';
            const state = createMockState({
                configs: {
                    test: createConfig({ name: 'test', isTest: true, connection: { dialect: 'sqlite', database: '/tmp/stored.db' } }),
                },
            });
            const config = resolveConfig(state, { settings: createMockSettings() })!;
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

});
