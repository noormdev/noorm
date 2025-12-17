/**
 * Checksum utility tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import {
    computeChecksum,
    computeChecksumFromContent,
    computeCombinedChecksum,
} from '../../../src/core/runner/checksum.js'


const TMP_DIR = path.join(process.cwd(), 'tmp/runner-checksum-test')


describe('runner: checksum', () => {

    beforeAll(async () => {

        await mkdir(TMP_DIR, { recursive: true })
    })

    afterAll(async () => {

        await rm(TMP_DIR, { recursive: true, force: true })
    })

    describe('computeChecksum', () => {

        it('should compute SHA-256 hash of a file', async () => {

            const filepath = path.join(TMP_DIR, 'test.sql')
            await writeFile(filepath, 'SELECT 1;')

            const hash = await computeChecksum(filepath)

            expect(hash).toMatch(/^[a-f0-9]{64}$/)
        })

        it('should produce consistent hashes for same content', async () => {

            const filepath1 = path.join(TMP_DIR, 'test1.sql')
            const filepath2 = path.join(TMP_DIR, 'test2.sql')
            await writeFile(filepath1, 'SELECT 1;')
            await writeFile(filepath2, 'SELECT 1;')

            const hash1 = await computeChecksum(filepath1)
            const hash2 = await computeChecksum(filepath2)

            expect(hash1).toBe(hash2)
        })

        it('should produce different hashes for different content', async () => {

            const filepath1 = path.join(TMP_DIR, 'diff1.sql')
            const filepath2 = path.join(TMP_DIR, 'diff2.sql')
            await writeFile(filepath1, 'SELECT 1;')
            await writeFile(filepath2, 'SELECT 2;')

            const hash1 = await computeChecksum(filepath1)
            const hash2 = await computeChecksum(filepath2)

            expect(hash1).not.toBe(hash2)
        })

        it('should throw for non-existent file', async () => {

            const filepath = path.join(TMP_DIR, 'nonexistent.sql')

            await expect(computeChecksum(filepath)).rejects.toThrow('Failed to read file')
        })
    })

    describe('computeChecksumFromContent', () => {

        it('should compute SHA-256 hash of string content', () => {

            const hash = computeChecksumFromContent('SELECT 1;')

            expect(hash).toMatch(/^[a-f0-9]{64}$/)
        })

        it('should match file checksum for same content', async () => {

            const content = 'CREATE TABLE users (id INT);'
            const filepath = path.join(TMP_DIR, 'match.sql')
            await writeFile(filepath, content)

            const hashFromContent = computeChecksumFromContent(content)
            const hashFromFile = await computeChecksum(filepath)

            expect(hashFromContent).toBe(hashFromFile)
        })

        it('should handle empty string', () => {

            const hash = computeChecksumFromContent('')

            expect(hash).toMatch(/^[a-f0-9]{64}$/)
        })
    })

    describe('computeCombinedChecksum', () => {

        it('should compute combined hash from array of checksums', () => {

            const checksums = [
                'abc123',
                'def456',
            ]

            const combined = computeCombinedChecksum(checksums)

            expect(combined).toMatch(/^[a-f0-9]{64}$/)
        })

        it('should produce same hash regardless of input order', () => {

            const checksums1 = ['abc', 'def', 'ghi']
            const checksums2 = ['ghi', 'abc', 'def']

            const hash1 = computeCombinedChecksum(checksums1)
            const hash2 = computeCombinedChecksum(checksums2)

            expect(hash1).toBe(hash2)
        })

        it('should produce different hash for different checksums', () => {

            const checksums1 = ['abc', 'def']
            const checksums2 = ['abc', 'xyz']

            const hash1 = computeCombinedChecksum(checksums1)
            const hash2 = computeCombinedChecksum(checksums2)

            expect(hash1).not.toBe(hash2)
        })

        it('should handle empty array', () => {

            const hash = computeCombinedChecksum([])

            expect(hash).toMatch(/^[a-f0-9]{64}$/)
        })

        it('should handle single checksum', () => {

            const hash = computeCombinedChecksum(['single'])

            expect(hash).toMatch(/^[a-f0-9]{64}$/)
        })
    })
})
