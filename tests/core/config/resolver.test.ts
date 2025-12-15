/**
 * Config resolver tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { resolveConfig, type StateProvider } from '../../../src/core/config/index.js'
import type { Config } from '../../../src/core/config/index.js'


/**
 * Create a mock state provider for testing.
 */
function createMockState(options: {
    configs?: Record<string, Config>
    activeConfig?: string | null
} = {}): StateProvider {

    const configs = options.configs ?? {}
    const activeConfig = options.activeConfig ?? null

    return {
        getConfig(name: string): Config | null {

            return configs[name] ?? null
        },
        getActiveConfigName(): string | null {

            return activeConfig
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

        // Backup and clear relevant env vars
        const envVars = [
            'NOORM_DIALECT', 'NOORM_HOST', 'NOORM_PORT', 'NOORM_DATABASE',
            'NOORM_USER', 'NOORM_PASSWORD', 'NOORM_SSL',
            'NOORM_SCHEMA_PATH', 'NOORM_CHANGESET_PATH',
            'NOORM_CONFIG', 'NOORM_PROTECTED', 'NOORM_IDENTITY',
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

            process.env['NOORM_HOST'] = 'override.local'
            process.env['NOORM_PORT'] = '9999'

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

            process.env['NOORM_HOST'] = 'from-env'

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
            process.env['NOORM_PORT'] = '99999'

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
                'NOORM_DIALECT', 'NOORM_HOST', 'NOORM_PORT', 'NOORM_DATABASE',
                'NOORM_USER', 'NOORM_PASSWORD', 'NOORM_SSL',
                'NOORM_SCHEMA_PATH', 'NOORM_CHANGESET_PATH',
                'NOORM_CONFIG', 'NOORM_PROTECTED', 'NOORM_IDENTITY',
            ]
            for (const key of envVars) {

                delete process.env[key]
            }
        })

        it('should create config from env vars only', () => {

            process.env['NOORM_DIALECT'] = 'sqlite'
            process.env['NOORM_DATABASE'] = ':memory:'

            const state = createMockState()  // Empty state

            const config = resolveConfig(state)

            expect(config).not.toBeNull()
            expect(config!.name).toBe('__env__')
            expect(config!.connection.dialect).toBe('sqlite')
            expect(config!.connection.database).toBe(':memory:')
        })

        it('should require dialect and database for env-only', () => {

            process.env['NOORM_DIALECT'] = 'postgres'
            // Missing database

            const state = createMockState()

            const config = resolveConfig(state)

            expect(config).toBeNull()
        })

        it('should apply defaults in env-only mode', () => {

            process.env['NOORM_DIALECT'] = 'sqlite'
            process.env['NOORM_DATABASE'] = ':memory:'

            const state = createMockState()

            const config = resolveConfig(state)

            expect(config!.type).toBe('local')
            expect(config!.protected).toBe(false)
            expect(config!.paths.schema).toBe('./schema')
        })

        it('should validate env-only config', () => {

            process.env['NOORM_DIALECT'] = 'postgres'
            process.env['NOORM_DATABASE'] = 'test'

            const state = createMockState()

            // With default host 'localhost', validation passes
            const config = resolveConfig(state)
            expect(config!.connection.host).toBe('localhost')
        })

        it('should fail validation when host explicitly cleared', () => {

            process.env['NOORM_DIALECT'] = 'postgres'
            process.env['NOORM_DATABASE'] = 'test'

            const state = createMockState()

            // Override host to empty via flags to trigger validation error
            expect(() => resolveConfig(state, {
                flags: { connection: { host: '' } }
            })).toThrow('Host is required for non-SQLite')
        })
    })
})
