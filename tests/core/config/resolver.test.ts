/**
 * Config resolver tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
    resolveConfig,
    checkConfigCompleteness,
    canDeleteConfig,
    type StateProvider,
    type SettingsProvider,
} from '../../../src/core/config/index.js'
import type { Config, Stage } from '../../../src/core/config/index.js'


/**
 * Create a mock state provider for testing.
 */
function createMockState(options: {
    configs?: Record<string, Config>
    activeConfig?: string | null
    secrets?: Record<string, string[]>
} = {}): StateProvider {

    const configs = options.configs ?? {}
    const activeConfig = options.activeConfig ?? null
    const secrets = options.secrets ?? {}

    return {
        getConfig(name: string): Config | null {

            return configs[name] ?? null
        },
        getActiveConfigName(): string | null {

            return activeConfig
        },
        listSecrets(configName: string): string[] {

            return secrets[configName] ?? []
        },
    }
}


/**
 * Create a mock settings provider for testing.
 */
function createMockSettings(stages: Record<string, Stage> = {}): SettingsProvider {

    return {
        getStage(name: string): Stage | null {

            return stages[name] ?? null
        },
        findStageForConfig(configName: string): Stage | null {

            return stages[configName] ?? null
        },
    }
}


/**
 * Create a valid test config.
 */
function createConfig(overrides: Partial<Config> = {}): Config {

    return {
        name: 'test',
        type: 'local',
        isTest: true,
        protected: false,
        connection: {
            dialect: 'sqlite',
            database: ':memory:',
        },
        paths: {
            schema: './schema',
            changesets: './changesets',
        },
        ...overrides,
    }
}


describe('config: resolver', () => {

    const envBackup: Record<string, string | undefined> = {}

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
            // Paths
            'NOORM_PATHS_SCHEMA',
            'NOORM_PATHS_CHANGESETS',
            // Top-level
            'NOORM_CONFIG',
            'NOORM_PROTECTED',
            'NOORM_IDENTITY',
        ]

        for (const key of envVars) {

            envBackup[key] = process.env[key]
            delete process.env[key]
        }
    })

    afterEach(() => {

        // Restore env vars
        for (const [key, value] of Object.entries(envBackup)) {

            if (value === undefined) {

                delete process.env[key]
            }
            else {

                process.env[key] = value
            }
        }
    })

    describe('resolveConfig', () => {

        it('should return null when no config available', () => {

            const state = createMockState()

            const config = resolveConfig(state)

            expect(config).toBeNull()
        })

        it('should load active config from state', () => {

            const stored = createConfig({ name: 'dev' })
            const state = createMockState({
                configs: { dev: stored },
                activeConfig: 'dev',
            })

            const config = resolveConfig(state)

            expect(config).not.toBeNull()
            expect(config!.name).toBe('dev')
        })

        it('should load config by name option', () => {

            const stored = createConfig({ name: 'staging' })
            const state = createMockState({
                configs: { staging: stored },
                activeConfig: 'dev',  // active is different
            })

            const config = resolveConfig(state, { name: 'staging' })

            expect(config).not.toBeNull()
            expect(config!.name).toBe('staging')
        })

        it('should prefer name option over env var for config selection', () => {

            // NOORM_CONFIG points to a different config
            process.env['NOORM_CONFIG'] = 'from-env'

            const envConfig = createConfig({ name: 'from-env' })
            const optionConfig = createConfig({ name: 'from-option' })
            const state = createMockState({
                configs: {
                    'from-env': envConfig,
                    'from-option': optionConfig,
                },
            })

            // options.name should select which config to load (from-option)
            // even though NOORM_CONFIG is set to 'from-env'
            const config = resolveConfig(state, { name: 'from-option' })

            // The loaded config should be from-option's stored values
            expect(config!.name).toBe('from-option')
        })

        it('should prefer env var over active config', () => {

            process.env['NOORM_CONFIG'] = 'from-env'

            const stored = createConfig({ name: 'from-env' })
            const state = createMockState({
                configs: { 'from-env': stored, active: createConfig({ name: 'active' }) },
                activeConfig: 'active',
            })

            const config = resolveConfig(state)

            expect(config!.name).toBe('from-env')
        })

        it('should throw when config not found', () => {

            const state = createMockState()

            expect(() => resolveConfig(state, { name: 'nonexistent' }))
                .toThrow('Config "nonexistent" not found')
        })

        it('should merge env vars over stored config', () => {

            process.env['NOORM_CONNECTION_HOST'] = 'override.local'
            process.env['NOORM_CONNECTION_PORT'] = '9999'

            const stored = createConfig({
                name: 'dev',
                connection: {
                    dialect: 'postgres',
                    host: 'original.local',
                    port: 5432,
                    database: 'test',
                },
            })
            const state = createMockState({
                configs: { dev: stored },
                activeConfig: 'dev',
            })

            const config = resolveConfig(state)

            expect(config!.connection.host).toBe('override.local')
            expect(config!.connection.port).toBe(9999)
            expect(config!.connection.dialect).toBe('postgres')  // unchanged
        })

        it('should merge flags over env vars', () => {

            process.env['NOORM_CONNECTION_HOST'] = 'from-env'

            const stored = createConfig({ name: 'dev' })
            const state = createMockState({
                configs: { dev: stored },
                activeConfig: 'dev',
            })

            const config = resolveConfig(state, {
                flags: { connection: { host: 'from-flags' } },
            })

            expect(config!.connection.host).toBe('from-flags')
        })

        it('should apply defaults for missing values', () => {

            const stored = createConfig({ name: 'minimal' })
            const state = createMockState({
                configs: { minimal: stored },
                activeConfig: 'minimal',
            })

            const config = resolveConfig(state)

            // Default paths should be applied if not in stored
            expect(config!.paths.schema).toBe('./schema')
            expect(config!.paths.changesets).toBe('./changesets')
        })

        it('should validate merged config', () => {

            // Config with invalid port from env var
            process.env['NOORM_CONNECTION_PORT'] = '99999'

            const stored = createConfig({ name: 'dev' })
            const state = createMockState({
                configs: { dev: stored },
                activeConfig: 'dev',
            })

            expect(() => resolveConfig(state))
                .toThrow('Port must be at most 65535')
        })
    })

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
                'NOORM_PATHS_SCHEMA',
                'NOORM_PATHS_CHANGESETS',
                'NOORM_CONFIG',
                'NOORM_PROTECTED',
                'NOORM_IDENTITY',
            ]
            for (const key of envVars) {

                delete process.env[key]
            }
        })

        it('should create config from env vars only', () => {

            process.env['NOORM_CONNECTION_DIALECT'] = 'sqlite'
            process.env['NOORM_CONNECTION_DATABASE'] = ':memory:'

            const state = createMockState()  // Empty state

            const config = resolveConfig(state)

            expect(config).not.toBeNull()
            expect(config!.name).toBe('__env__')
            expect(config!.connection.dialect).toBe('sqlite')
            expect(config!.connection.database).toBe(':memory:')
        })

        it('should require dialect and database for env-only', () => {

            process.env['NOORM_CONNECTION_DIALECT'] = 'postgres'
            // Missing database

            const state = createMockState()

            const config = resolveConfig(state)

            expect(config).toBeNull()
        })

        it('should apply defaults in env-only mode', () => {

            process.env['NOORM_CONNECTION_DIALECT'] = 'sqlite'
            process.env['NOORM_CONNECTION_DATABASE'] = ':memory:'

            const state = createMockState()

            const config = resolveConfig(state)

            expect(config!.type).toBe('local')
            expect(config!.protected).toBe(false)
            expect(config!.paths.schema).toBe('./schema')
        })

        it('should validate env-only config', () => {

            process.env['NOORM_CONNECTION_DIALECT'] = 'postgres'
            process.env['NOORM_CONNECTION_DATABASE'] = 'test'

            const state = createMockState()

            // With default host 'localhost', validation passes
            const config = resolveConfig(state)
            expect(config!.connection.host).toBe('localhost')
        })

        it('should fail validation when host explicitly cleared', () => {

            process.env['NOORM_CONNECTION_DIALECT'] = 'postgres'
            process.env['NOORM_CONNECTION_DATABASE'] = 'test'

            const state = createMockState()

            // Override host to empty via flags to trigger validation error
            expect(() => resolveConfig(state, {
                flags: { connection: { host: '' } }
            })).toThrow('Host is required for non-SQLite')
        })
    })

    describe('stage defaults', () => {

        it('should apply stage defaults when settings provided', () => {

            const stored = createConfig({
                name: 'prod',
                connection: {
                    dialect: 'postgres',
                    database: 'myapp',
                    host: 'localhost',
                },
            })

            const state = createMockState({
                configs: { prod: stored },
                activeConfig: 'prod',
            })

            const settings = createMockSettings({
                prod: {
                    defaults: {
                        protected: true,
                        connection: { host: 'stage-default.local' },
                    },
                },
            })

            // Stored config has host=localhost, stage has host=stage-default.local
            // Stored should override stage defaults
            const config = resolveConfig(state, { settings })

            expect(config!.protected).toBe(false)  // stored has protected=false
            expect(config!.connection.host).toBe('localhost')  // stored overrides stage
        })

        it('should use stage defaults for missing values', () => {

            const stored = createConfig({
                name: 'prod',
                type: 'local',
                isTest: false,
                protected: false,
                connection: {
                    dialect: 'postgres',
                    database: 'myapp',
                    host: 'localhost',
                },
                paths: {
                    schema: './schema',
                    changesets: './changesets',
                },
            })

            const state = createMockState({
                configs: { prod: stored },
                activeConfig: 'prod',
            })

            const settings = createMockSettings({
                prod: {
                    defaults: {
                        identity: 'stage-identity',
                    },
                },
            })

            const config = resolveConfig(state, { settings })

            // identity wasn't in stored, so stage default applies
            expect(config!.identity).toBe('stage-identity')
        })

        it('should find stage by config name automatically', () => {

            const stored = createConfig({ name: 'staging' })

            const state = createMockState({
                configs: { staging: stored },
                activeConfig: 'staging',
            })

            const settings = createMockSettings({
                staging: {
                    defaults: {
                        protected: true,
                    },
                },
            })

            const config = resolveConfig(state, { settings })

            // Since stored has protected=false, it overrides stage default
            expect(config!.protected).toBe(false)
        })

        it('should use explicit stage over config name match', () => {

            const stored = createConfig({ name: 'myconfig' })

            const state = createMockState({
                configs: { myconfig: stored },
                activeConfig: 'myconfig',
            })

            const settings = createMockSettings({
                myconfig: {
                    defaults: {
                        identity: 'from-myconfig-stage',
                    },
                },
                production: {
                    defaults: {
                        identity: 'from-production-stage',
                    },
                },
            })

            // Explicit stage=production should be used
            const config = resolveConfig(state, { settings, stage: 'production' })

            expect(config!.identity).toBe('from-production-stage')
        })
    })

    describe('checkConfigCompleteness', () => {

        it('should return complete when no stage', () => {

            const config = createConfig({ name: 'dev' })
            const state = createMockState()

            const result = checkConfigCompleteness(config, state)

            expect(result.complete).toBe(true)
            expect(result.missingSecrets).toEqual([])
            expect(result.violations).toEqual([])
        })

        it('should detect missing required secrets', () => {

            const config = createConfig({ name: 'prod' })
            const state = createMockState({
                secrets: { prod: ['EXISTING_KEY'] },
            })

            const settings = createMockSettings({
                prod: {
                    secrets: [
                        { key: 'DB_PASSWORD', type: 'password' },
                        { key: 'EXISTING_KEY', type: 'string' },
                        { key: 'API_KEY', type: 'api_key' },
                    ],
                },
            })

            const result = checkConfigCompleteness(config, state, settings)

            expect(result.complete).toBe(false)
            expect(result.missingSecrets).toContain('DB_PASSWORD')
            expect(result.missingSecrets).toContain('API_KEY')
            expect(result.missingSecrets).not.toContain('EXISTING_KEY')
        })

        it('should ignore optional secrets', () => {

            const config = createConfig({ name: 'prod' })
            const state = createMockState({
                secrets: { prod: [] },
            })

            const settings = createMockSettings({
                prod: {
                    secrets: [
                        { key: 'OPTIONAL_KEY', type: 'string', required: false },
                    ],
                },
            })

            const result = checkConfigCompleteness(config, state, settings)

            expect(result.complete).toBe(true)
            expect(result.missingSecrets).toEqual([])
        })

        it('should detect protected constraint violation', () => {

            const config = createConfig({
                name: 'prod',
                protected: false,
            })
            const state = createMockState()

            const settings = createMockSettings({
                prod: {
                    defaults: {
                        protected: true,
                    },
                },
            })

            const result = checkConfigCompleteness(config, state, settings)

            expect(result.complete).toBe(false)
            expect(result.violations).toHaveLength(1)
            expect(result.violations[0]).toContain('protected=true')
        })

        it('should detect isTest constraint violation', () => {

            const config = createConfig({
                name: 'test',
                isTest: false,
            })
            const state = createMockState()

            const settings = createMockSettings({
                test: {
                    defaults: {
                        isTest: true,
                    },
                },
            })

            const result = checkConfigCompleteness(config, state, settings)

            expect(result.complete).toBe(false)
            expect(result.violations).toHaveLength(1)
            expect(result.violations[0]).toContain('isTest=true')
        })

        it('should be complete when all requirements met', () => {

            const config = createConfig({
                name: 'prod',
                protected: true,
            })
            const state = createMockState({
                secrets: { prod: ['DB_PASSWORD', 'API_KEY'] },
            })

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
            })

            const result = checkConfigCompleteness(config, state, settings)

            expect(result.complete).toBe(true)
            expect(result.missingSecrets).toEqual([])
            expect(result.violations).toEqual([])
        })
    })

    describe('canDeleteConfig', () => {

        it('should allow deletion without settings', () => {

            const result = canDeleteConfig('prod')

            expect(result.allowed).toBe(true)
            expect(result.reason).toBeUndefined()
        })

        it('should allow deletion when stage not locked', () => {

            const settings = createMockSettings({
                dev: {
                    locked: false,
                },
            })

            const result = canDeleteConfig('dev', settings)

            expect(result.allowed).toBe(true)
        })

        it('should block deletion when stage is locked', () => {

            const settings = createMockSettings({
                prod: {
                    locked: true,
                },
            })

            const result = canDeleteConfig('prod', settings)

            expect(result.allowed).toBe(false)
            expect(result.reason).toContain('locked stage')
            expect(result.reason).toContain('prod')
        })

        it('should use explicit stage name when provided', () => {

            const settings = createMockSettings({
                production: {
                    locked: true,
                },
            })

            // Config name doesn't match any stage, but explicit stage does
            const result = canDeleteConfig('my-prod-db', settings, 'production')

            expect(result.allowed).toBe(false)
            expect(result.reason).toContain('locked')
        })
    })
})
