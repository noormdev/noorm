/**
 * Identity resolution tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    resolveIdentity,
    clearIdentityCache,
    formatIdentity,
    identityToString,
    getIdentityForConfig,
} from '../../../src/core/identity/index.js'


describe('identity: resolver', () => {

    const envBackup: Record<string, string | undefined> = {}

    beforeEach(() => {

        clearIdentityCache()
        envBackup['NOORM_IDENTITY'] = process.env['NOORM_IDENTITY']
        delete process.env['NOORM_IDENTITY']
    })

    afterEach(() => {

        clearIdentityCache()
        if (envBackup['NOORM_IDENTITY'] === undefined) {

            delete process.env['NOORM_IDENTITY']
        }
        else {

            process.env['NOORM_IDENTITY'] = envBackup['NOORM_IDENTITY']
        }
    })

    describe('resolveIdentity', () => {

        it('should resolve from config override', () => {

            const identity = resolveIdentity({
                configIdentity: 'Test User <test@example.com>',
            })

            expect(identity.name).toBe('Test User')
            expect(identity.email).toBe('test@example.com')
            expect(identity.source).toBe('config')
        })

        it('should resolve from env var', () => {

            process.env['NOORM_IDENTITY'] = 'CI Bot'

            const identity = resolveIdentity()

            expect(identity.name).toBe('CI Bot')
            expect(identity.source).toBe('env')
        })

        it('should resolve from env var with email', () => {

            process.env['NOORM_IDENTITY'] = 'CI Bot <ci@example.com>'

            const identity = resolveIdentity()

            expect(identity.name).toBe('CI Bot')
            expect(identity.email).toBe('ci@example.com')
            expect(identity.source).toBe('env')
        })

        it('should prefer config over env var', () => {

            process.env['NOORM_IDENTITY'] = 'From Env'

            const identity = resolveIdentity({
                configIdentity: 'From Config',
            })

            expect(identity.name).toBe('From Config')
            expect(identity.source).toBe('config')
        })

        it('should parse identity with email', () => {

            const identity = resolveIdentity({
                configIdentity: 'John Doe <john@example.com>',
            })

            expect(identity.name).toBe('John Doe')
            expect(identity.email).toBe('john@example.com')
        })

        it('should parse identity without email', () => {

            const identity = resolveIdentity({
                configIdentity: 'John Doe',
            })

            expect(identity.name).toBe('John Doe')
            expect(identity.email).toBeUndefined()
        })

        it('should handle leading/trailing whitespace in identity string', () => {

            const identity = resolveIdentity({
                configIdentity: '  John Doe <john@example.com>  ',
            })

            expect(identity.name).toBe('John Doe')
            expect(identity.email).toBe('john@example.com')
        })

        it('should fall back to system user when skipGit is true', () => {

            const identity = resolveIdentity({ skipGit: true })

            expect(identity.source).toBe('system')
            expect(identity.name).toBeTruthy()
        })

        it('should resolve from git when available', () => {

            // This test will resolve from git if available, otherwise system
            const identity = resolveIdentity()

            expect(['git', 'system']).toContain(identity.source)
            expect(identity.name).toBeTruthy()
        })
    })

    describe('caching', () => {

        it('should cache identity', () => {

            const first = resolveIdentity({ skipGit: true })
            const second = resolveIdentity({ skipGit: true })

            expect(first).toBe(second) // Same reference
        })

        it('should not cache config overrides', () => {

            const first = resolveIdentity({ configIdentity: 'User A' })
            const second = resolveIdentity({ configIdentity: 'User B' })

            expect(first.name).toBe('User A')
            expect(second.name).toBe('User B')
            expect(first).not.toBe(second)
        })

        it('should clear cache', () => {

            const first = resolveIdentity({ skipGit: true })
            clearIdentityCache()
            const second = resolveIdentity({ skipGit: true })

            // Same values but different references after cache clear
            expect(first.name).toBe(second.name)
            expect(first).not.toBe(second)
        })
    })

    describe('formatIdentity', () => {

        it('should format identity with email', () => {

            const result = formatIdentity({
                name: 'John',
                email: 'john@example.com',
                source: 'git',
            })

            expect(result).toBe('John <john@example.com>')
        })

        it('should format identity without email', () => {

            const result = formatIdentity({
                name: 'John',
                source: 'system',
            })

            expect(result).toBe('John')
        })
    })

    describe('identityToString', () => {

        it('should return same as formatIdentity', () => {

            const identity = {
                name: 'John',
                email: 'john@example.com',
                source: 'git' as const,
            }

            expect(identityToString(identity)).toBe(formatIdentity(identity))
        })
    })

    describe('getIdentityForConfig', () => {

        it('should use config identity when provided', () => {

            const config = { identity: 'Deploy Bot' }

            const identity = getIdentityForConfig(config)

            expect(identity.name).toBe('Deploy Bot')
            expect(identity.source).toBe('config')
        })

        it('should fall back when config has no identity', () => {

            const config = {}

            const identity = getIdentityForConfig(config)

            expect(identity.name).toBeTruthy()
            expect(['git', 'system']).toContain(identity.source)
        })

        it('should use env var when config has no identity', () => {

            process.env['NOORM_IDENTITY'] = 'Env User'
            const config = {}

            clearIdentityCache() // Clear to pick up new env var
            const identity = getIdentityForConfig(config)

            expect(identity.name).toBe('Env User')
            expect(identity.source).toBe('env')
        })
    })

    describe('edge cases', () => {

        it('should fall through when config identity is empty', () => {

            // Empty string is falsy, so it falls through to next source
            const identity = resolveIdentity({ configIdentity: '' })

            // Falls through to git or system
            expect(['git', 'system']).toContain(identity.source)
            expect(identity.name).toBeTruthy()
        })

        it('should handle identity with angle brackets in name', () => {

            // If someone puts angle brackets without proper email format
            const identity = resolveIdentity({
                configIdentity: 'User <Not An Email',
            })

            // Should be parsed as just a name since it doesn't match the pattern
            expect(identity.name).toBe('User <Not An Email')
            expect(identity.email).toBeUndefined()
        })

        it('should handle unicode characters', () => {

            const identity = resolveIdentity({
                configIdentity: '日本語ユーザー <user@日本語.com>',
            })

            expect(identity.name).toBe('日本語ユーザー')
            expect(identity.email).toBe('user@日本語.com')
        })

        it('should handle special characters in email', () => {

            const identity = resolveIdentity({
                configIdentity: 'User <user+tag@example.com>',
            })

            expect(identity.name).toBe('User')
            expect(identity.email).toBe('user+tag@example.com')
        })
    })
})
