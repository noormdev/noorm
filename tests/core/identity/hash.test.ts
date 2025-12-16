/**
 * Identity hash tests.
 */
import { describe, it, expect } from 'vitest'
import {
    computeIdentityHash,
    isValidIdentityHash,
    truncateHash,
} from '../../../src/core/identity/hash.js'


describe('identity: hash', () => {

    describe('computeIdentityHash', () => {

        it('should compute a SHA-256 hash', () => {

            const hash = computeIdentityHash({
                email: 'alice@example.com',
                name: 'Alice Smith',
                machine: 'alice-macbook',
                os: 'darwin 24.5.0',
            })

            // SHA-256 produces 64 hex characters
            expect(hash.length).toBe(64)
            expect(hash).toMatch(/^[0-9a-f]{64}$/)
        })

        it('should produce same hash for same inputs', () => {

            const input = {
                email: 'alice@example.com',
                name: 'Alice Smith',
                machine: 'alice-macbook',
                os: 'darwin 24.5.0',
            }

            const hash1 = computeIdentityHash(input)
            const hash2 = computeIdentityHash(input)

            expect(hash1).toBe(hash2)
        })

        it('should produce different hashes for different emails', () => {

            const hash1 = computeIdentityHash({
                email: 'alice@example.com',
                name: 'Alice Smith',
                machine: 'alice-macbook',
                os: 'darwin 24.5.0',
            })

            const hash2 = computeIdentityHash({
                email: 'bob@example.com',
                name: 'Alice Smith',
                machine: 'alice-macbook',
                os: 'darwin 24.5.0',
            })

            expect(hash1).not.toBe(hash2)
        })

        it('should produce different hashes for different machines', () => {

            const hash1 = computeIdentityHash({
                email: 'alice@example.com',
                name: 'Alice Smith',
                machine: 'alice-macbook',
                os: 'darwin 24.5.0',
            })

            const hash2 = computeIdentityHash({
                email: 'alice@example.com',
                name: 'Alice Smith',
                machine: 'alice-workstation',
                os: 'darwin 24.5.0',
            })

            expect(hash1).not.toBe(hash2)
        })

        it('should produce different hashes for different OS versions', () => {

            const hash1 = computeIdentityHash({
                email: 'alice@example.com',
                name: 'Alice Smith',
                machine: 'alice-macbook',
                os: 'darwin 24.5.0',
            })

            const hash2 = computeIdentityHash({
                email: 'alice@example.com',
                name: 'Alice Smith',
                machine: 'alice-macbook',
                os: 'darwin 23.0.0',
            })

            expect(hash1).not.toBe(hash2)
        })

        it('should throw if email is missing', () => {

            expect(() => {

                computeIdentityHash({
                    email: '',
                    name: 'Alice',
                    machine: 'machine',
                    os: 'darwin',
                })
            }).toThrow(/email/i)
        })

        it('should throw if name is missing', () => {

            expect(() => {

                computeIdentityHash({
                    email: 'alice@example.com',
                    name: '',
                    machine: 'machine',
                    os: 'darwin',
                })
            }).toThrow(/name/i)
        })

        it('should handle unicode characters', () => {

            const hash = computeIdentityHash({
                email: 'user@日本語.com',
                name: '日本語ユーザー',
                machine: 'マシン',
                os: 'darwin 24.5.0',
            })

            expect(hash.length).toBe(64)
            expect(hash).toMatch(/^[0-9a-f]{64}$/)
        })
    })

    describe('isValidIdentityHash', () => {

        it('should accept valid 64-char hex string', () => {

            const validHash = 'a'.repeat(64)

            expect(isValidIdentityHash(validHash)).toBe(true)
        })

        it('should accept mixed case hex', () => {

            const hash = 'aAbBcCdDeEfF0123456789' + 'a'.repeat(42)

            expect(isValidIdentityHash(hash)).toBe(true)
        })

        it('should reject too short', () => {

            expect(isValidIdentityHash('abc123')).toBe(false)
        })

        it('should reject too long', () => {

            expect(isValidIdentityHash('a'.repeat(65))).toBe(false)
        })

        it('should reject non-hex characters', () => {

            const invalidHash = 'g' + 'a'.repeat(63)

            expect(isValidIdentityHash(invalidHash)).toBe(false)
        })

        it('should reject empty string', () => {

            expect(isValidIdentityHash('')).toBe(false)
        })
    })

    describe('truncateHash', () => {

        it('should truncate to 8 characters by default', () => {

            const hash = 'a'.repeat(64)

            expect(truncateHash(hash)).toBe('aaaaaaaa')
        })

        it('should truncate to specified length', () => {

            const hash = 'abcdef0123456789' + 'a'.repeat(48)

            expect(truncateHash(hash, 16)).toBe('abcdef0123456789')
        })

        it('should handle length longer than hash', () => {

            const hash = 'abcd'

            expect(truncateHash(hash, 100)).toBe('abcd')
        })
    })
})
