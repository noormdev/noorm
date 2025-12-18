/**
 * Headless mode tests.
 *
 * Tests CI/CD mode detection and logging.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
    shouldRunHeadless,
    HeadlessLogger,
    runHeadless,
    registerHeadlessHandler,
} from '../../src/cli/headless.js'
import { observer } from '../../src/core/observer.js'
import type { CliFlags } from '../../src/cli/types.js'


/**
 * Create default CLI flags.
 */
function createFlags(overrides: Partial<CliFlags> = {}): CliFlags {

    return {
        headless: false,
        json: false,
        yes: false,
        force: false,
        dryRun: false,
        ...overrides,
    }
}


describe('cli: headless', () => {

    describe('shouldRunHeadless', () => {

        const originalEnv = { ...process.env }
        const originalIsTTY = process.stdout.isTTY

        beforeEach(() => {

            // Reset environment
            process.env = { ...originalEnv }
            // Clear CI variables
            delete process.env['CI']
            delete process.env['CONTINUOUS_INTEGRATION']
            delete process.env['GITHUB_ACTIONS']
            delete process.env['GITLAB_CI']
            delete process.env['CIRCLECI']
            delete process.env['TRAVIS']
            delete process.env['JENKINS_URL']
            delete process.env['BUILDKITE']
            delete process.env['NOORM_HEADLESS']
        })

        afterEach(() => {

            process.env = originalEnv
            Object.defineProperty(process.stdout, 'isTTY', {
                value: originalIsTTY,
                writable: true,
            })
        })

        it('should return true when headless flag is set', () => {

            const flags = createFlags({ headless: true })

            expect(shouldRunHeadless(flags)).toBe(true)
        })

        it('should return true when NOORM_HEADLESS is true', () => {

            process.env['NOORM_HEADLESS'] = 'true'
            const flags = createFlags()

            expect(shouldRunHeadless(flags)).toBe(true)
        })

        it('should return false when NOORM_HEADLESS is not true', () => {

            process.env['NOORM_HEADLESS'] = 'false'
            Object.defineProperty(process.stdout, 'isTTY', {
                value: true,
                writable: true,
            })
            const flags = createFlags()

            expect(shouldRunHeadless(flags)).toBe(false)
        })

        it('should return true when CI environment variable is set', () => {

            process.env['CI'] = 'true'
            const flags = createFlags()

            expect(shouldRunHeadless(flags)).toBe(true)
        })

        it('should detect GITHUB_ACTIONS', () => {

            process.env['GITHUB_ACTIONS'] = 'true'
            const flags = createFlags()

            expect(shouldRunHeadless(flags)).toBe(true)
        })

        it('should detect GITLAB_CI', () => {

            process.env['GITLAB_CI'] = 'true'
            const flags = createFlags()

            expect(shouldRunHeadless(flags)).toBe(true)
        })

        it('should detect CIRCLECI', () => {

            process.env['CIRCLECI'] = 'true'
            const flags = createFlags()

            expect(shouldRunHeadless(flags)).toBe(true)
        })

        it('should detect TRAVIS', () => {

            process.env['TRAVIS'] = 'true'
            const flags = createFlags()

            expect(shouldRunHeadless(flags)).toBe(true)
        })

        it('should detect JENKINS_URL', () => {

            process.env['JENKINS_URL'] = 'http://jenkins.example.com'
            const flags = createFlags()

            expect(shouldRunHeadless(flags)).toBe(true)
        })

        it('should detect BUILDKITE', () => {

            process.env['BUILDKITE'] = 'true'
            const flags = createFlags()

            expect(shouldRunHeadless(flags)).toBe(true)
        })

        it('should detect CONTINUOUS_INTEGRATION', () => {

            process.env['CONTINUOUS_INTEGRATION'] = 'true'
            const flags = createFlags()

            expect(shouldRunHeadless(flags)).toBe(true)
        })

        it('should return true when no TTY', () => {

            Object.defineProperty(process.stdout, 'isTTY', {
                value: false,
                writable: true,
            })
            const flags = createFlags()

            expect(shouldRunHeadless(flags)).toBe(true)
        })

        it('should return false in normal TTY environment', () => {

            Object.defineProperty(process.stdout, 'isTTY', {
                value: true,
                writable: true,
            })
            const flags = createFlags()

            expect(shouldRunHeadless(flags)).toBe(false)
        })
    })

    describe('HeadlessLogger', () => {

        let consoleSpy: ReturnType<typeof vi.spyOn>

        beforeEach(() => {

            consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        })

        afterEach(() => {

            consoleSpy.mockRestore()
        })

        it('should log events as JSON when json mode is true', () => {

            const logger = new HeadlessLogger(true)
            logger.start()

            observer.emit('build:start', {
                configName: 'test',
                schemaPath: './schema',
                fileCount: 5,
            })

            logger.stop()

            expect(consoleSpy).toHaveBeenCalled()
            const output = consoleSpy.mock.calls[0]?.[0] as string
            const parsed = JSON.parse(output)

            expect(parsed.event).toBe('build:start')
            expect(parsed.fileCount).toBe(5)
            expect(parsed.timestamp).toBeDefined()
        })

        it('should log events as human-readable when json mode is false', () => {

            const logger = new HeadlessLogger(false)
            logger.start()

            observer.emit('build:start', {
                configName: 'test',
                schemaPath: './schema',
                fileCount: 10,
            })

            logger.stop()

            expect(consoleSpy).toHaveBeenCalled()
            const output = consoleSpy.mock.calls[0]?.[0] as string

            expect(output).toContain('Building schema')
            expect(output).toContain('10 files')
        })

        it('should format build:complete event', () => {

            const logger = new HeadlessLogger(false)
            logger.start()

            observer.emit('build:complete', {
                configName: 'test',
                status: 'success',
                filesRun: 5,
                filesSkipped: 2,
                filesFailed: 0,
                durationMs: 123,
            })

            logger.stop()

            const output = consoleSpy.mock.calls[0]?.[0] as string

            expect(output).toContain('✓')
            expect(output).toContain('success')
            expect(output).toContain('5 run')
            expect(output).toContain('2 skipped')
            expect(output).toContain('123ms')
        })

        it('should format file:before event', () => {

            const logger = new HeadlessLogger(false)
            logger.start()

            observer.emit('file:before', {
                filepath: './schema/001_users.sql',
                checksum: 'abc123',
                configName: 'test',
            })

            logger.stop()

            const output = consoleSpy.mock.calls[0]?.[0] as string

            expect(output).toContain('Running')
            expect(output).toContain('./schema/001_users.sql')
        })

        it('should format file:after success', () => {

            const logger = new HeadlessLogger(false)
            logger.start()

            observer.emit('file:after', {
                filepath: './schema/001_users.sql',
                status: 'success',
                durationMs: 45,
            })

            logger.stop()

            const output = consoleSpy.mock.calls[0]?.[0] as string

            expect(output).toContain('✓')
            expect(output).toContain('./schema/001_users.sql')
            expect(output).toContain('45ms')
        })

        it('should format file:after failure', () => {

            const logger = new HeadlessLogger(false)
            logger.start()

            observer.emit('file:after', {
                filepath: './schema/001_users.sql',
                status: 'failed',
                durationMs: 10,
                error: 'Syntax error',
            })

            logger.stop()

            const output = consoleSpy.mock.calls[0]?.[0] as string

            expect(output).toContain('✗')
        })

        it('should format file:skip event', () => {

            const logger = new HeadlessLogger(false)
            logger.start()

            observer.emit('file:skip', {
                filepath: './schema/001_users.sql',
                reason: 'unchanged',
            })

            logger.stop()

            const output = consoleSpy.mock.calls[0]?.[0] as string

            expect(output).toContain('○')
            expect(output).toContain('unchanged')
        })

        it('should format changeset:start event', () => {

            const logger = new HeadlessLogger(false)
            logger.start()

            observer.emit('changeset:start', {
                name: '2024-01-15_add-users',
                direction: 'change',
                configName: 'test',
            })

            logger.stop()

            const output = consoleSpy.mock.calls[0]?.[0] as string

            expect(output).toContain('Applying')
            expect(output).toContain('2024-01-15_add-users')
        })

        it('should format changeset:start revert', () => {

            const logger = new HeadlessLogger(false)
            logger.start()

            observer.emit('changeset:start', {
                name: '2024-01-15_add-users',
                direction: 'revert',
                configName: 'test',
            })

            logger.stop()

            const output = consoleSpy.mock.calls[0]?.[0] as string

            expect(output).toContain('Reverting')
        })

        it('should format lock:acquired event', () => {

            const logger = new HeadlessLogger(false)
            logger.start()

            const expiresAt = new Date('2024-01-15T12:00:00Z')

            observer.emit('lock:acquired', {
                configName: 'test',
                holder: 'user1',
                expiresAt,
            })

            logger.stop()

            const output = consoleSpy.mock.calls[0]?.[0] as string

            expect(output).toContain('🔒')
            expect(output).toContain('Lock acquired')
        })

        it('should format lock:released event', () => {

            const logger = new HeadlessLogger(false)
            logger.start()

            observer.emit('lock:released', {
                configName: 'test',
            })

            logger.stop()

            const output = consoleSpy.mock.calls[0]?.[0] as string

            expect(output).toContain('🔓')
            expect(output).toContain('Lock released')
        })

        it('should format error event', () => {

            const logger = new HeadlessLogger(false)
            logger.start()

            observer.emit('error', {
                source: 'runner',
                error: new Error('Something went wrong'),
            })

            logger.stop()

            const output = consoleSpy.mock.calls[0]?.[0] as string

            expect(output).toContain('Error')
            expect(output).toContain('[runner]')
            expect(output).toContain('Something went wrong')
        })

        it('should format connection:open event', () => {

            const logger = new HeadlessLogger(false)
            logger.start()

            observer.emit('connection:open', {
                configName: 'production',
                dialect: 'postgres',
            })

            logger.stop()

            const output = consoleSpy.mock.calls[0]?.[0] as string

            expect(output).toContain('Connected to')
            expect(output).toContain('production')
            expect(output).toContain('postgres')
        })

        it('should clean up subscriptions on stop', () => {

            const logger = new HeadlessLogger(false)
            logger.start()
            logger.stop()

            // Clear previous calls
            consoleSpy.mockClear()

            // This should not be logged
            observer.emit('build:start', {
                configName: 'test',
                schemaPath: './schema',
                fileCount: 5,
            })

            expect(consoleSpy).not.toHaveBeenCalled()
        })
    })

    describe('runHeadless', () => {

        let consoleSpy: ReturnType<typeof vi.spyOn>
        let consoleErrorSpy: ReturnType<typeof vi.spyOn>

        beforeEach(() => {

            consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
            consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        })

        afterEach(() => {

            consoleSpy.mockRestore()
            consoleErrorSpy.mockRestore()
        })

        it('should return 1 for unknown command', async () => {

            const flags = createFlags()
            const result = await runHeadless('home', {}, flags)

            expect(result).toBe(1)
            expect(consoleErrorSpy).toHaveBeenCalled()
        })

        it('should output JSON error for unknown command in json mode', async () => {

            const flags = createFlags({ json: true })
            const result = await runHeadless('home', {}, flags)

            expect(result).toBe(1)

            const output = consoleErrorSpy.mock.calls[0]?.[0] as string
            const parsed = JSON.parse(output)

            expect(parsed.error).toBe('unknown_command')
            expect(parsed.route).toBe('home')
        })

        it('should call registered handler', async () => {

            const handler = vi.fn().mockResolvedValue(0)
            registerHeadlessHandler('run/build', handler)

            const flags = createFlags()
            const params = { path: './schema' }

            const result = await runHeadless('run/build', params, flags)

            expect(result).toBe(0)
            expect(handler).toHaveBeenCalledWith(params, flags)
        })

        it('should return handler exit code', async () => {

            const handler = vi.fn().mockResolvedValue(42)
            registerHeadlessHandler('run/file', handler)

            const flags = createFlags()
            const result = await runHeadless('run/file', {}, flags)

            expect(result).toBe(42)
        })

        it('should handle handler errors', async () => {

            const handler = vi.fn().mockRejectedValue(new Error('Handler failed'))
            registerHeadlessHandler('run/dir', handler)

            const flags = createFlags()
            const result = await runHeadless('run/dir', {}, flags)

            expect(result).toBe(1)
            expect(consoleErrorSpy).toHaveBeenCalled()
        })

        it('should output JSON error on handler failure in json mode', async () => {

            const handler = vi.fn().mockRejectedValue(new Error('Handler failed'))
            registerHeadlessHandler('db/create', handler)

            const flags = createFlags({ json: true })
            const result = await runHeadless('db/create', {}, flags)

            expect(result).toBe(1)

            const output = consoleErrorSpy.mock.calls[0]?.[0] as string
            const parsed = JSON.parse(output)

            expect(parsed.error).toBe('execution_failed')
            expect(parsed.message).toBe('Handler failed')
        })
    })
})
