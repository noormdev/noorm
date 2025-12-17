/**
 * Lock error tests.
 */
import { describe, it, expect } from 'vitest'
import {
    LockAcquireError,
    LockExpiredError,
    LockNotFoundError,
    LockOwnershipError,
} from '../../../src/core/lock/index.js'


describe('lock: errors', () => {

    describe('LockAcquireError', () => {

        it('should have correct name', () => {

            const error = new LockAcquireError(
                'dev',
                'alice@example.com',
                new Date('2024-01-01T00:00:00Z'),
                new Date('2024-01-01T00:05:00Z'),
            )

            expect(error.name).toBe('LockAcquireError')
        })

        it('should store all properties', () => {

            const heldSince = new Date('2024-01-01T00:00:00Z')
            const expiresAt = new Date('2024-01-01T00:05:00Z')

            const error = new LockAcquireError(
                'dev',
                'alice@example.com',
                heldSince,
                expiresAt,
                'Running migrations',
            )

            expect(error.configName).toBe('dev')
            expect(error.holder).toBe('alice@example.com')
            expect(error.heldSince).toBe(heldSince)
            expect(error.expiresAt).toBe(expiresAt)
            expect(error.reason).toBe('Running migrations')
        })

        it('should format message with reason', () => {

            const error = new LockAcquireError(
                'dev',
                'alice@example.com',
                new Date('2024-01-01T00:00:00Z'),
                new Date('2024-01-01T00:05:00Z'),
                'Running migrations',
            )

            expect(error.message).toContain('dev')
            expect(error.message).toContain('alice@example.com')
            expect(error.message).toContain('(Running migrations)')
        })

        it('should format message without reason', () => {

            const error = new LockAcquireError(
                'dev',
                'alice@example.com',
                new Date('2024-01-01T00:00:00Z'),
                new Date('2024-01-01T00:05:00Z'),
            )

            expect(error.message).not.toContain('()')
            expect(error.message).toContain('dev')
            expect(error.message).toContain('alice@example.com')
        })

        it('should be instanceof Error', () => {

            const error = new LockAcquireError(
                'dev',
                'alice@example.com',
                new Date(),
                new Date(),
            )

            expect(error).toBeInstanceOf(Error)
        })
    })

    describe('LockExpiredError', () => {

        it('should have correct name', () => {

            const error = new LockExpiredError(
                'dev',
                'alice@example.com',
                new Date(),
            )

            expect(error.name).toBe('LockExpiredError')
        })

        it('should store all properties', () => {

            const expiredAt = new Date('2024-01-01T00:05:00Z')

            const error = new LockExpiredError(
                'dev',
                'alice@example.com',
                expiredAt,
            )

            expect(error.configName).toBe('dev')
            expect(error.identity).toBe('alice@example.com')
            expect(error.expiredAt).toBe(expiredAt)
        })

        it('should format message correctly', () => {

            const error = new LockExpiredError(
                'dev',
                'alice@example.com',
                new Date('2024-01-01T00:05:00Z'),
            )

            expect(error.message).toContain('dev')
            expect(error.message).toContain('expired')
        })

        it('should be instanceof Error', () => {

            const error = new LockExpiredError('dev', 'alice', new Date())

            expect(error).toBeInstanceOf(Error)
        })
    })

    describe('LockNotFoundError', () => {

        it('should have correct name', () => {

            const error = new LockNotFoundError('dev', 'alice@example.com')

            expect(error.name).toBe('LockNotFoundError')
        })

        it('should store all properties', () => {

            const error = new LockNotFoundError('dev', 'alice@example.com')

            expect(error.configName).toBe('dev')
            expect(error.identity).toBe('alice@example.com')
        })

        it('should format message correctly', () => {

            const error = new LockNotFoundError('dev', 'alice@example.com')

            expect(error.message).toContain('dev')
            expect(error.message).toContain('alice@example.com')
            expect(error.message).toContain('No lock found')
        })

        it('should be instanceof Error', () => {

            const error = new LockNotFoundError('dev', 'alice')

            expect(error).toBeInstanceOf(Error)
        })
    })

    describe('LockOwnershipError', () => {

        it('should have correct name', () => {

            const error = new LockOwnershipError(
                'dev',
                'bob@example.com',
                'alice@example.com',
            )

            expect(error.name).toBe('LockOwnershipError')
        })

        it('should store all properties', () => {

            const error = new LockOwnershipError(
                'dev',
                'bob@example.com',
                'alice@example.com',
            )

            expect(error.configName).toBe('dev')
            expect(error.requestedBy).toBe('bob@example.com')
            expect(error.actualHolder).toBe('alice@example.com')
        })

        it('should format message correctly', () => {

            const error = new LockOwnershipError(
                'dev',
                'bob@example.com',
                'alice@example.com',
            )

            expect(error.message).toContain('dev')
            expect(error.message).toContain('alice@example.com')
            expect(error.message).toContain('bob@example.com')
        })

        it('should be instanceof Error', () => {

            const error = new LockOwnershipError('dev', 'bob', 'alice')

            expect(error).toBeInstanceOf(Error)
        })
    })
})
