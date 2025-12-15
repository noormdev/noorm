/**
 * Config schema validation tests.
 */
import { describe, it, expect } from 'vitest'

import {
    validateConfig,
    validateConfigInput,
    parseConfig,
    ConfigValidationError,
} from '../../../src/core/config/index.js'
import type { Config } from '../../../src/core/config/index.js'


/**
 * Create a valid test config.
 */
function createValidConfig(overrides: Partial<Config> = {}): Config {

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


describe('config: schema validation', () => {

    describe('validateConfig', () => {

        it('should accept valid config', () => {

            const config = createValidConfig()
            expect(() => validateConfig(config)).not.toThrow()
        })

        it('should accept all valid dialects', () => {

            const dialects = ['postgres', 'mysql', 'sqlite', 'mssql'] as const

            for (const dialect of dialects) {

                const config = createValidConfig({
                    connection: {
                        dialect,
                        database: 'test',
                        host: dialect === 'sqlite' ? undefined : 'localhost',
                    },
                })

                expect(() => validateConfig(config)).not.toThrow()
            }
        })

        it('should require name', () => {

            const config = createValidConfig({ name: '' })

            expect(() => validateConfig(config)).toThrow(ConfigValidationError)
            expect(() => validateConfig(config)).toThrow('Config name is required')
        })

        it('should reject invalid name characters', () => {

            const config = createValidConfig({ name: 'my config!' })

            expect(() => validateConfig(config)).toThrow(ConfigValidationError)
            expect(() => validateConfig(config)).toThrow('letters, numbers, hyphens')
        })

        it('should accept valid name patterns', () => {

            const validNames = ['dev', 'DEV', 'dev-local', 'dev_local', 'dev123', 'My-Config_123']

            for (const name of validNames) {

                const config = createValidConfig({ name })
                expect(() => validateConfig(config)).not.toThrow()
            }
        })

        it('should require connection', () => {

            const config = createValidConfig()
            // @ts-expect-error testing invalid input
            delete config.connection

            expect(() => validateConfig(config)).toThrow(ConfigValidationError)
        })

        it('should require dialect', () => {

            const config = createValidConfig()
            // @ts-expect-error testing invalid input
            delete config.connection.dialect

            expect(() => validateConfig(config)).toThrow(ConfigValidationError)
        })

        it('should reject invalid dialect', () => {

            const config = createValidConfig()
            // @ts-expect-error testing invalid input
            config.connection.dialect = 'oracle'

            expect(() => validateConfig(config)).toThrow(ConfigValidationError)
        })

        it('should require database', () => {

            const config = createValidConfig()
            // @ts-expect-error testing invalid input
            delete config.connection.database

            expect(() => validateConfig(config)).toThrow(ConfigValidationError)
        })

        it('should require host for non-SQLite databases', () => {

            const config = createValidConfig({
                connection: {
                    dialect: 'postgres',
                    database: 'test',
                    // missing host
                },
            })

            expect(() => validateConfig(config)).toThrow('Host is required for non-SQLite')
        })

        it('should not require host for SQLite', () => {

            const config = createValidConfig({
                connection: {
                    dialect: 'sqlite',
                    database: ':memory:',
                },
            })

            expect(() => validateConfig(config)).not.toThrow()
        })

        it('should validate port range', () => {

            const lowConfig = createValidConfig({
                connection: { dialect: 'sqlite', database: ':memory:', port: 0 },
            })

            expect(() => validateConfig(lowConfig)).toThrow('Port must be at least 1')

            const highConfig = createValidConfig({
                connection: { dialect: 'sqlite', database: ':memory:', port: 99999 },
            })

            expect(() => validateConfig(highConfig)).toThrow('Port must be at most 65535')
        })

        it('should accept valid port', () => {

            const config = createValidConfig({
                connection: { dialect: 'sqlite', database: ':memory:', port: 5432 },
            })

            expect(() => validateConfig(config)).not.toThrow()
        })

        it('should require paths', () => {

            const config = createValidConfig()
            // @ts-expect-error testing invalid input
            delete config.paths

            expect(() => validateConfig(config)).toThrow(ConfigValidationError)
        })

        it('should require schema path', () => {

            const config = createValidConfig()
            // @ts-expect-error testing invalid input
            delete config.paths.schema

            expect(() => validateConfig(config)).toThrow(ConfigValidationError)
        })

        it('should require changesets path', () => {

            const config = createValidConfig()
            // @ts-expect-error testing invalid input
            delete config.paths.changesets

            expect(() => validateConfig(config)).toThrow(ConfigValidationError)
        })

        it('should validate type enum', () => {

            const config = createValidConfig()
            // @ts-expect-error testing invalid input
            config.type = 'invalid'

            expect(() => validateConfig(config)).toThrow(ConfigValidationError)
        })

        it('should include field name in error', () => {

            const config = createValidConfig({ name: '' })

            try {

                validateConfig(config)
            }
            catch (err) {

                expect(err).toBeInstanceOf(ConfigValidationError)
                expect((err as ConfigValidationError).field).toBe('name')
            }
        })

        it('should include issues array in error', () => {

            const config = createValidConfig({ name: '' })

            try {

                validateConfig(config)
            }
            catch (err) {

                expect(err).toBeInstanceOf(ConfigValidationError)
                expect((err as ConfigValidationError).issues).toBeInstanceOf(Array)
                expect((err as ConfigValidationError).issues.length).toBeGreaterThan(0)
            }
        })
    })

    describe('validateConfigInput', () => {

        it('should accept empty input', () => {

            expect(() => validateConfigInput({})).not.toThrow()
        })

        it('should validate name when present', () => {

            expect(() => validateConfigInput({ name: 'valid-name' })).not.toThrow()
            expect(() => validateConfigInput({ name: 'invalid name!' })).toThrow()
        })

        it('should accept partial connection config', () => {

            // Partial schema allows partial connection without database
            expect(() => validateConfigInput({
                connection: { host: 'localhost' }
            })).not.toThrow()
        })

        it('should validate port when present', () => {

            expect(() => validateConfigInput({ connection: { port: 5432 } })).not.toThrow()
            expect(() => validateConfigInput({ connection: { port: 99999 } })).toThrow()
        })

        it('should validate type when present', () => {

            expect(() => validateConfigInput({ type: 'local' })).not.toThrow()
            expect(() => validateConfigInput({ type: 'remote' })).not.toThrow()
            // @ts-expect-error testing invalid input
            expect(() => validateConfigInput({ type: 'invalid' })).toThrow()
        })
    })

    describe('parseConfig', () => {

        it('should apply defaults for missing optional fields', () => {

            const minimal = {
                name: 'minimal',
                connection: {
                    dialect: 'sqlite' as const,
                    database: ':memory:',
                },
                paths: {
                    schema: './schema',
                    changesets: './changesets',
                },
            }

            const result = parseConfig(minimal)

            expect(result.type).toBe('local')
            expect(result.isTest).toBe(false)
            expect(result.protected).toBe(false)
        })

        it('should preserve provided values', () => {

            const config = createValidConfig({
                type: 'remote',
                isTest: true,
                protected: true,
            })

            const result = parseConfig(config)

            expect(result.type).toBe('remote')
            expect(result.isTest).toBe(true)
            expect(result.protected).toBe(true)
        })

        it('should throw on invalid config', () => {

            const invalid = { name: '' }

            expect(() => parseConfig(invalid)).toThrow(ConfigValidationError)
        })
    })
})
