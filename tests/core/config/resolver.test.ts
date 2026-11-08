/**
 * Config resolver tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import {
    resolveConfig,
    checkConfigCompleteness,
    canDeleteConfig,
    type StateProvider,
} from '../../../src/core/config/index.js';
import { SettingsProvider } from '../../../src/core/config/resolver.js';
import type { Config, Stage } from '../../../src/core/config/index.js';
import { guarded } from '../../../src/core/policy/index.js';

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

    const mock = {
        getStage(name: string): Stage | null {

            return stages[name] ?? null;

        },
        findStageForConfig(configName: string): Stage | null {

            return stages[configName] ?? null;

        },
    };

    return Object.assign(Object.create(SettingsProvider.prototype), mock);

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
            expect(config!.access).toEqual({ user: 'operator', agent: 'viewer' });

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
            expect(config!.access).toEqual({ user: 'operator', agent: false });

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
            expect(config!.access).toEqual({ user: 'operator', agent: false });

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

            // Stage `protected: true` is an access ceiling, not a value the
            // stored config can override to something looser: stored has no
            // explicit access (defaults to admin/admin), which is looser
            // than the operator/viewer ceiling, so it gets clamped down.
            expect(guarded(config!)).toBe(true);
            expect(config!.access).toEqual({ user: 'operator', agent: 'viewer' });
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

            // Stage `protected: true` clamps the stored config's (looser,
            // default admin/admin) access down to the ceiling.
            expect(guarded(config!)).toBe(true);
            expect(config!.access).toEqual({ user: 'operator', agent: 'viewer' });

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

        it('should clamp a looser user+agent access down to the ceiling', () => {

            const config = resolveWithStageProtected({ user: 'admin', agent: 'admin' }, true);

            expect(config!.access).toEqual({ user: 'operator', agent: 'viewer' });
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

        it('should clamp each channel independently', () => {

            // user is looser than the ceiling, agent is already stricter
            const config = resolveWithStageProtected({ user: 'admin', agent: false }, true);

            expect(config!.access).toEqual({ user: 'operator', agent: false });

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

            // A config with open access reaching this check is only
            // possible outside resolveConfig, which clamps access to the
            // stage ceiling before returning. checkConfigCompleteness no
            // longer duplicates that enforcement as a violation.
            const config = createConfig({
                name: 'prod',
                access: { user: 'admin', agent: 'admin' },
            });
            const state = createMockState();

            const settings = createMockSettings({
                prod: {
                    defaults: {
                        protected: true,
                        log: { level: 'info' },
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
                        log: { level: 'info' },
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
                        log: { level: 'info' },
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

});
