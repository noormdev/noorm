/**
 * Environment variable config tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    getEnvConfig,
    getEnvConfigName,
    getEnvPassphrase,
    isCI,
    shouldSkipConfirmations,
    shouldOutputJson,
} from '../../../src/core/config/index.js'


describe('config: env', () => {

    const envBackup: Record<string, string | undefined> = {}

    beforeEach(() => {

        // Backup current env vars
        const envVars = [
            'NOORM_DIALECT', 'NOORM_HOST', 'NOORM_PORT', 'NOORM_DATABASE',
            'NOORM_USER', 'NOORM_PASSWORD', 'NOORM_SSL',
            'NOORM_SCHEMA_PATH', 'NOORM_CHANGESET_PATH',
            'NOORM_CONFIG', 'NOORM_PROTECTED', 'NOORM_IDENTITY',
            'NOORM_YES', 'NOORM_JSON', 'NOORM_PASSPHRASE', 'CI',
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

    describe('getEnvConfig', () => {

        it('should return empty config when no env vars set', () => {

            const config = getEnvConfig()
            expect(config).toEqual({})
        })

        it('should read connection dialect', () => {

            process.env['NOORM_DIALECT'] = 'postgres'

            const config = getEnvConfig()

            expect(config.connection?.dialect).toBe('postgres')
        })

        it('should read all connection properties', () => {

            process.env['NOORM_DIALECT'] = 'postgres'
            process.env['NOORM_HOST'] = 'db.example.com'
            process.env['NOORM_PORT'] = '5432'
            process.env['NOORM_DATABASE'] = 'myapp'
            process.env['NOORM_USER'] = 'admin'
            process.env['NOORM_PASSWORD'] = 'secret'
            process.env['NOORM_SSL'] = 'true'

            const config = getEnvConfig()

            expect(config.connection).toEqual({
                dialect: 'postgres',
                host: 'db.example.com',
                port: 5432,
                database: 'myapp',
                user: 'admin',
                password: 'secret',
                ssl: true,
            })
        })

        it('should parse port as number', () => {

            process.env['NOORM_PORT'] = '3306'

            const config = getEnvConfig()

            expect(config.connection?.port).toBe(3306)
            expect(typeof config.connection?.port).toBe('number')
        })

        it('should throw on invalid port', () => {

            process.env['NOORM_PORT'] = 'not-a-number'

            expect(() => getEnvConfig()).toThrow('Invalid NOORM_PORT: must be a number')
        })

        it('should parse ssl as boolean', () => {

            process.env['NOORM_SSL'] = '1'

            let config = getEnvConfig()
            expect(config.connection?.ssl).toBe(true)

            process.env['NOORM_SSL'] = 'true'
            config = getEnvConfig()
            expect(config.connection?.ssl).toBe(true)

            process.env['NOORM_SSL'] = 'false'
            config = getEnvConfig()
            expect(config.connection?.ssl).toBe(false)

            process.env['NOORM_SSL'] = '0'
            config = getEnvConfig()
            expect(config.connection?.ssl).toBe(false)
        })

        it('should validate dialect', () => {

            process.env['NOORM_DIALECT'] = 'oracle'

            expect(() => getEnvConfig()).toThrow('Invalid NOORM_DIALECT: must be one of')
        })

        it('should accept all valid dialects', () => {

            const dialects = ['postgres', 'mysql', 'sqlite', 'mssql']

            for (const dialect of dialects) {

                process.env['NOORM_DIALECT'] = dialect

                const config = getEnvConfig()
                expect(config.connection?.dialect).toBe(dialect)
            }
        })

        it('should read path properties', () => {

            process.env['NOORM_SCHEMA_PATH'] = './custom/schema'
            process.env['NOORM_CHANGESET_PATH'] = './custom/changesets'

            const config = getEnvConfig()

            expect(config.paths?.schema).toBe('./custom/schema')
            expect(config.paths?.changesets).toBe('./custom/changesets')
        })

        it('should read behavior properties', () => {

            // Note: NOORM_CONFIG is handled separately by getEnvConfigName()
            // and not included in getEnvConfig() output
            process.env['NOORM_PROTECTED'] = 'true'
            process.env['NOORM_IDENTITY'] = 'deploy-bot'

            const config = getEnvConfig()

            expect(config.protected).toBe(true)
            expect(config.identity).toBe('deploy-bot')
        })
    })

    describe('getEnvConfigName', () => {

        it('should return undefined when not set', () => {

            expect(getEnvConfigName()).toBeUndefined()
        })

        it('should return config name when set', () => {

            process.env['NOORM_CONFIG'] = 'staging'

            expect(getEnvConfigName()).toBe('staging')
        })
    })

    describe('getEnvPassphrase', () => {

        it('should return undefined when not set', () => {

            expect(getEnvPassphrase()).toBeUndefined()
        })

        it('should return passphrase when set', () => {

            process.env['NOORM_PASSPHRASE'] = 'my-secret-phrase'

            expect(getEnvPassphrase()).toBe('my-secret-phrase')
        })
    })

    describe('isCI', () => {

        it('should return false when CI not set', () => {

            expect(isCI()).toBe(false)
        })

        it('should return true when CI=1', () => {

            process.env['CI'] = '1'

            expect(isCI()).toBe(true)
        })

        it('should return true when CI=true', () => {

            process.env['CI'] = 'true'

            expect(isCI()).toBe(true)
        })

        it('should return false for other values', () => {

            process.env['CI'] = 'false'

            expect(isCI()).toBe(false)
        })
    })

    describe('shouldSkipConfirmations', () => {

        it('should return false when not set', () => {

            expect(shouldSkipConfirmations()).toBe(false)
        })

        it('should return true when NOORM_YES=1', () => {

            process.env['NOORM_YES'] = '1'

            expect(shouldSkipConfirmations()).toBe(true)
        })

        it('should return true when NOORM_YES=true', () => {

            process.env['NOORM_YES'] = 'true'

            expect(shouldSkipConfirmations()).toBe(true)
        })
    })

    describe('shouldOutputJson', () => {

        it('should return false when not set', () => {

            expect(shouldOutputJson()).toBe(false)
        })

        it('should return true when NOORM_JSON=1', () => {

            process.env['NOORM_JSON'] = '1'

            expect(shouldOutputJson()).toBe(true)
        })

        it('should return true when NOORM_JSON=true', () => {

            process.env['NOORM_JSON'] = 'true'

            expect(shouldOutputJson()).toBe(true)
        })
    })
})
