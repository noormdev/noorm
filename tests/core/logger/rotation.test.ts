import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFile, mkdir, rm, stat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
    parseSize,
    generateRotatedName,
    needsRotation,
    rotateFile,
    listRotatedFiles,
    cleanupRotatedFiles,
    checkAndRotate,
} from '../../../src/core/logger/rotation.js'


describe('logger: rotation', () => {

    let testDir: string

    beforeEach(async () => {

        testDir = join(tmpdir(), `noorm-test-rotation-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        await mkdir(testDir, { recursive: true })
    })

    afterEach(async () => {

        await rm(testDir, { recursive: true, force: true })
    })

    describe('parseSize', () => {

        it('should parse bytes', () => {

            expect(parseSize('100')).toBe(100)
            expect(parseSize('100b')).toBe(100)
            expect(parseSize('100B')).toBe(100)
        })

        it('should parse kilobytes', () => {

            expect(parseSize('1kb')).toBe(1024)
            expect(parseSize('2KB')).toBe(2048)
        })

        it('should parse megabytes', () => {

            expect(parseSize('1mb')).toBe(1024 * 1024)
            expect(parseSize('10MB')).toBe(10 * 1024 * 1024)
        })

        it('should parse gigabytes', () => {

            expect(parseSize('1gb')).toBe(1024 * 1024 * 1024)
        })

        it('should parse decimal values', () => {

            expect(parseSize('1.5mb')).toBe(Math.floor(1.5 * 1024 * 1024))
        })

        it('should throw on invalid format', () => {

            expect(() => parseSize('invalid')).toThrow('Invalid size format')
            expect(() => parseSize('')).toThrow('Invalid size format')
            expect(() => parseSize('abc')).toThrow('Invalid size format')
        })
    })

    describe('generateRotatedName', () => {

        beforeEach(() => {

            vi.useFakeTimers()
            vi.setSystemTime(new Date('2024-01-15T10:30:45.000Z'))
        })

        afterEach(() => {

            vi.useRealTimers()
        })

        it('should generate rotated filename with timestamp', () => {

            const rotated = generateRotatedName('/logs/app.log')

            expect(rotated).toBe('/logs/app.2024-01-15T10-30-45.log')
        })

        it('should preserve directory structure', () => {

            const rotated = generateRotatedName('/var/log/noorm/app.log')

            expect(rotated).toMatch(/^\/var\/log\/noorm\/app\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.log$/)
        })

        it('should handle files without extension', () => {

            const rotated = generateRotatedName('/logs/app')

            expect(rotated).toMatch(/^\/logs\/app\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/)
        })
    })

    describe('needsRotation', () => {

        it('should return false if file does not exist', async () => {

            const filepath = join(testDir, 'nonexistent.log')

            const needs = await needsRotation(filepath, 1024)

            expect(needs).toBe(false)
        })

        it('should return false if file is under maxSize', async () => {

            const filepath = join(testDir, 'small.log')
            await writeFile(filepath, 'x'.repeat(100))

            const needs = await needsRotation(filepath, 1024)

            expect(needs).toBe(false)
        })

        it('should return true if file equals maxSize', async () => {

            const filepath = join(testDir, 'exact.log')
            await writeFile(filepath, 'x'.repeat(1024))

            const needs = await needsRotation(filepath, 1024)

            expect(needs).toBe(true)
        })

        it('should return true if file exceeds maxSize', async () => {

            const filepath = join(testDir, 'large.log')
            await writeFile(filepath, 'x'.repeat(2000))

            const needs = await needsRotation(filepath, 1024)

            expect(needs).toBe(true)
        })
    })

    describe('rotateFile', () => {

        beforeEach(() => {

            vi.useFakeTimers()
            vi.setSystemTime(new Date('2024-01-15T10:30:45.000Z'))
        })

        afterEach(() => {

            vi.useRealTimers()
        })

        it('should rename file with timestamp', async () => {

            const filepath = join(testDir, 'app.log')
            await writeFile(filepath, 'log content')

            const newPath = await rotateFile(filepath)

            expect(newPath).toBe(join(testDir, 'app.2024-01-15T10-30-45.log'))

            // Original should not exist
            await expect(stat(filepath)).rejects.toThrow()

            // New file should exist
            const stats = await stat(newPath)

            expect(stats.isFile()).toBe(true)
        })
    })

    describe('listRotatedFiles', () => {

        it('should return empty array if no rotated files exist', async () => {

            const filepath = join(testDir, 'app.log')
            await writeFile(filepath, 'log content')

            const rotated = await listRotatedFiles(filepath)

            expect(rotated).toEqual([])
        })

        it('should list rotated files sorted newest first', async () => {

            const filepath = join(testDir, 'app.log')

            // Create rotated files
            await writeFile(join(testDir, 'app.2024-01-10T10-00-00.log'), '')
            await writeFile(join(testDir, 'app.2024-01-15T10-00-00.log'), '')
            await writeFile(join(testDir, 'app.2024-01-12T10-00-00.log'), '')

            const rotated = await listRotatedFiles(filepath)

            expect(rotated).toEqual([
                join(testDir, 'app.2024-01-15T10-00-00.log'),
                join(testDir, 'app.2024-01-12T10-00-00.log'),
                join(testDir, 'app.2024-01-10T10-00-00.log'),
            ])
        })

        it('should not include unrelated files', async () => {

            const filepath = join(testDir, 'app.log')

            await writeFile(join(testDir, 'app.2024-01-10T10-00-00.log'), '')
            await writeFile(join(testDir, 'other.2024-01-10T10-00-00.log'), '') // Different base
            await writeFile(join(testDir, 'app.log.bak'), '') // Different pattern

            const rotated = await listRotatedFiles(filepath)

            expect(rotated).toHaveLength(1)
            expect(rotated[0]).toContain('app.2024-01-10')
        })
    })

    describe('cleanupRotatedFiles', () => {

        it('should keep maxFiles and delete older ones', async () => {

            const filepath = join(testDir, 'app.log')

            // Create 5 rotated files
            await writeFile(join(testDir, 'app.2024-01-10T10-00-00.log'), '')
            await writeFile(join(testDir, 'app.2024-01-11T10-00-00.log'), '')
            await writeFile(join(testDir, 'app.2024-01-12T10-00-00.log'), '')
            await writeFile(join(testDir, 'app.2024-01-13T10-00-00.log'), '')
            await writeFile(join(testDir, 'app.2024-01-14T10-00-00.log'), '')

            // Keep only 2
            const deleted = await cleanupRotatedFiles(filepath, 2)

            expect(deleted).toHaveLength(3)

            // Should have kept newest 2
            const remaining = await listRotatedFiles(filepath)

            expect(remaining).toHaveLength(2)
            expect(remaining[0]).toContain('2024-01-14')
            expect(remaining[1]).toContain('2024-01-13')
        })

        it('should not delete anything if under maxFiles', async () => {

            const filepath = join(testDir, 'app.log')

            await writeFile(join(testDir, 'app.2024-01-10T10-00-00.log'), '')
            await writeFile(join(testDir, 'app.2024-01-11T10-00-00.log'), '')

            const deleted = await cleanupRotatedFiles(filepath, 5)

            expect(deleted).toHaveLength(0)

            const remaining = await listRotatedFiles(filepath)

            expect(remaining).toHaveLength(2)
        })
    })

    describe('checkAndRotate', () => {

        beforeEach(() => {

            vi.useFakeTimers()
            vi.setSystemTime(new Date('2024-01-15T10:30:45.000Z'))
        })

        afterEach(() => {

            vi.useRealTimers()
        })

        it('should return rotated=false if file does not need rotation', async () => {

            const filepath = join(testDir, 'app.log')
            await writeFile(filepath, 'small content')

            const result = await checkAndRotate(filepath, '10mb', 5)

            expect(result.rotated).toBe(false)
        })

        it('should rotate file and return result', async () => {

            const filepath = join(testDir, 'app.log')
            await writeFile(filepath, 'x'.repeat(2000))

            const result = await checkAndRotate(filepath, '1kb', 5)

            expect(result.rotated).toBe(true)
            expect(result.oldFile).toBe(filepath)
            expect(result.newFile).toBe(join(testDir, 'app.2024-01-15T10-30-45.log'))
        })

        it('should cleanup old files during rotation', async () => {

            const filepath = join(testDir, 'app.log')
            await writeFile(filepath, 'x'.repeat(2000))

            // Create existing rotated files
            await writeFile(join(testDir, 'app.2024-01-10T10-00-00.log'), '')
            await writeFile(join(testDir, 'app.2024-01-11T10-00-00.log'), '')
            await writeFile(join(testDir, 'app.2024-01-12T10-00-00.log'), '')

            // Keep only 2, plus the new one makes 3 total before cleanup
            const result = await checkAndRotate(filepath, '1kb', 2)

            expect(result.rotated).toBe(true)
            expect(result.deletedFiles).toBeDefined()
            expect(result.deletedFiles!.length).toBeGreaterThan(0)
        })
    })
})
