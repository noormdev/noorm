/**
 * Template utilities tests.
 */
import { describe, it, expect } from 'vitest'
import {
    toContextKey,
    sqlEscape,
    sqlQuote,
    generateUuid,
    isoNow,
} from '../../../src/core/template/utils.js'


describe('template: utils', () => {

    describe('toContextKey', () => {

        it('should convert kebab-case to camelCase', () => {

            expect(toContextKey('my-config.json5')).toBe('myConfig')
        })

        it('should convert snake_case to camelCase', () => {

            expect(toContextKey('seed_data.yml')).toBe('seedData')
        })

        it('should convert SCREAMING_CASE to camelCase', () => {

            expect(toContextKey('API_KEYS.json')).toBe('apiKeys')
        })

        it('should handle simple filenames', () => {

            expect(toContextKey('users.csv')).toBe('users')
        })

        it('should handle multiple extensions', () => {

            expect(toContextKey('data.json5')).toBe('data')
        })

        it('should handle mixed case', () => {

            expect(toContextKey('MyConfig.json')).toBe('myConfig')
        })
    })

    describe('sqlEscape', () => {

        it('should escape single quotes', () => {

            expect(sqlEscape("O'Brien")).toBe("O''Brien")
        })

        it('should handle multiple quotes', () => {

            expect(sqlEscape("it's John's")).toBe("it''s John''s")
        })

        it('should return unchanged string without quotes', () => {

            expect(sqlEscape('normal')).toBe('normal')
        })

        it('should handle empty string', () => {

            expect(sqlEscape('')).toBe('')
        })
    })

    describe('sqlQuote', () => {

        it('should quote and escape strings', () => {

            expect(sqlQuote("O'Brien")).toBe("'O''Brien'")
        })

        it('should quote numbers', () => {

            expect(sqlQuote(42)).toBe("'42'")
        })

        it('should quote booleans', () => {

            expect(sqlQuote(true)).toBe("'true'")
            expect(sqlQuote(false)).toBe("'false'")
        })

        it('should return NULL for null', () => {

            expect(sqlQuote(null)).toBe('NULL')
        })

        it('should handle empty string', () => {

            expect(sqlQuote('')).toBe("''")
        })
    })

    describe('generateUuid', () => {

        it('should generate valid UUID v4 format', () => {

            const uuid = generateUuid()
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

            expect(uuid).toMatch(uuidRegex)
        })

        it('should generate unique UUIDs', () => {

            const uuid1 = generateUuid()
            const uuid2 = generateUuid()

            expect(uuid1).not.toBe(uuid2)
        })
    })

    describe('isoNow', () => {

        it('should return valid ISO timestamp', () => {

            const now = isoNow()
            const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

            expect(now).toMatch(isoRegex)
        })

        it('should return current time', () => {

            const before = Date.now()
            const now = new Date(isoNow()).getTime()
            const after = Date.now()

            expect(now).toBeGreaterThanOrEqual(before)
            expect(now).toBeLessThanOrEqual(after)
        })
    })
})
