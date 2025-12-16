import { describe, it, expect } from 'vitest'

import {
    validateSettings,
    parseSettings,
    validateStage,
    validateRule,
    SettingsValidationError,
} from '../../../src/core/settings/schema.js'


describe('settings: schema validation', () => {

    describe('validateSettings', () => {

        it('should accept empty object', () => {

            expect(() => validateSettings({})).not.toThrow()
        })

        it('should accept valid complete settings', () => {

            const settings = {
                build: {
                    include: ['schema/tables', 'schema/views'],
                    exclude: ['schema/archive'],
                },
                paths: {
                    schema: './db/schema',
                    changesets: './db/changesets',
                },
                rules: [
                    {
                        match: { isTest: true },
                        include: ['schema/seeds'],
                    },
                ],
                stages: {
                    dev: {
                        description: 'Development database',
                        locked: false,
                        defaults: {
                            dialect: 'postgres',
                            host: 'localhost',
                            port: 5432,
                        },
                    },
                },
                strict: {
                    enabled: true,
                    stages: ['dev', 'prod'],
                },
                logging: {
                    enabled: true,
                    level: 'info',
                    file: '.noorm/app.log',
                    maxSize: '5mb',
                    maxFiles: 3,
                },
            }

            expect(() => validateSettings(settings)).not.toThrow()
        })

        it('should reject invalid dialect in stage defaults', () => {

            const settings = {
                stages: {
                    dev: {
                        defaults: {
                            dialect: 'oracle', // invalid
                        },
                    },
                },
            }

            expect(() => validateSettings(settings)).toThrow(SettingsValidationError)
        })

        it('should reject invalid port in stage defaults', () => {

            const settings = {
                stages: {
                    dev: {
                        defaults: {
                            port: 99999, // too high
                        },
                    },
                },
            }

            expect(() => validateSettings(settings)).toThrow(SettingsValidationError)
        })

        it('should reject invalid log level', () => {

            const settings = {
                logging: {
                    level: 'debug', // not a valid level
                },
            }

            expect(() => validateSettings(settings)).toThrow(SettingsValidationError)
        })

        it('should reject invalid file size format', () => {

            const settings = {
                logging: {
                    maxSize: '10megabytes', // invalid format
                },
            }

            expect(() => validateSettings(settings)).toThrow(SettingsValidationError)
        })

        it('should accept valid file size formats', () => {

            const formats = ['100b', '10kb', '10mb', '1gb', '10MB', '10KB']

            for (const maxSize of formats) {

                expect(() => validateSettings({ logging: { maxSize } })).not.toThrow()
            }
        })
    })

    describe('parseSettings', () => {

        it('should return defaults for empty object', () => {

            const result = parseSettings({})

            expect(result).toEqual({})
        })

        it('should apply defaults to logging', () => {

            const result = parseSettings({
                logging: {},
            })

            expect(result.logging?.enabled).toBe(true)
            expect(result.logging?.level).toBe('info')
            expect(result.logging?.file).toBe('.noorm/noorm.log')
            expect(result.logging?.maxSize).toBe('10mb')
            expect(result.logging?.maxFiles).toBe(5)
        })

        it('should apply defaults to stage locked field', () => {

            const result = parseSettings({
                stages: {
                    dev: {
                        description: 'Dev',
                    },
                },
            })

            expect(result.stages?.dev?.locked).toBe(false)
        })

        it('should apply defaults to strict enabled', () => {

            const result = parseSettings({
                strict: {},
            })

            expect(result.strict?.enabled).toBe(false)
        })

        it('should preserve user-provided values', () => {

            const result = parseSettings({
                logging: {
                    level: 'verbose',
                    maxFiles: 10,
                },
            })

            expect(result.logging?.level).toBe('verbose')
            expect(result.logging?.maxFiles).toBe(10)
        })
    })

    describe('validateStage', () => {

        it('should accept valid stage', () => {

            const stage = {
                description: 'Production database',
                locked: true,
                defaults: {
                    dialect: 'postgres',
                    protected: true,
                },
                secrets: [
                    {
                        key: 'DB_PASSWORD',
                        type: 'password',
                        description: 'Database password',
                    },
                ],
            }

            expect(() => validateStage(stage)).not.toThrow()
        })

        it('should accept minimal stage', () => {

            expect(() => validateStage({})).not.toThrow()
        })

        it('should reject invalid secret type', () => {

            const stage = {
                secrets: [
                    {
                        key: 'API_KEY',
                        type: 'bearer_token', // invalid type
                    },
                ],
            }

            expect(() => validateStage(stage)).toThrow(SettingsValidationError)
        })

        it('should reject empty secret key', () => {

            const stage = {
                secrets: [
                    {
                        key: '', // empty
                        type: 'string',
                    },
                ],
            }

            expect(() => validateStage(stage)).toThrow(SettingsValidationError)
        })

        it('should accept all valid secret types', () => {

            const types = ['string', 'password', 'api_key', 'connection_string']

            for (const type of types) {

                const stage = {
                    secrets: [{ key: 'TEST', type }],
                }

                expect(() => validateStage(stage)).not.toThrow()
            }
        })

        it('should accept all valid dialects in defaults', () => {

            const dialects = ['postgres', 'mysql', 'sqlite', 'mssql']

            for (const dialect of dialects) {

                const stage = {
                    defaults: { dialect },
                }

                expect(() => validateStage(stage)).not.toThrow()
            }
        })
    })

    describe('validateRule', () => {

        it('should accept valid rule with include', () => {

            const rule = {
                match: { isTest: true },
                include: ['schema/seeds'],
            }

            expect(() => validateRule(rule)).not.toThrow()
        })

        it('should accept valid rule with exclude', () => {

            const rule = {
                match: { protected: true },
                exclude: ['schema/dangerous'],
            }

            expect(() => validateRule(rule)).not.toThrow()
        })

        it('should accept rule with both include and exclude', () => {

            const rule = {
                match: { type: 'local' },
                include: ['schema/dev-only'],
                exclude: ['schema/prod-only'],
            }

            expect(() => validateRule(rule)).not.toThrow()
        })

        it('should accept rule with multiple match conditions', () => {

            const rule = {
                match: {
                    name: 'dev',
                    type: 'local',
                    isTest: false,
                    protected: false,
                },
                include: ['schema/all'],
            }

            expect(() => validateRule(rule)).not.toThrow()
        })

        it('should reject rule without include or exclude', () => {

            const rule = {
                match: { isTest: true },
            }

            expect(() => validateRule(rule)).toThrow(SettingsValidationError)
        })

        it('should reject rule with empty match', () => {

            const rule = {
                match: {},
                include: ['schema/seeds'],
            }

            expect(() => validateRule(rule)).toThrow(SettingsValidationError)
        })

        it('should reject rule with invalid type in match', () => {

            const rule = {
                match: { type: 'cloud' }, // invalid type
                include: ['schema/cloud'],
            }

            expect(() => validateRule(rule)).toThrow(SettingsValidationError)
        })
    })

    describe('SettingsValidationError', () => {

        it('should include field and issues in error', () => {

            try {

                validateSettings({
                    stages: {
                        dev: {
                            defaults: {
                                port: -1, // invalid
                            },
                        },
                    },
                })

                expect.fail('Should have thrown')
            }
            catch (err) {

                expect(err).toBeInstanceOf(SettingsValidationError)

                const validationErr = err as SettingsValidationError

                expect(validationErr.field).toBeDefined()
                expect(validationErr.issues).toBeInstanceOf(Array)
                expect(validationErr.issues.length).toBeGreaterThan(0)
            }
        })
    })
})
