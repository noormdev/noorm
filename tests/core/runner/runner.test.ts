/**
 * Runner tests.
 *
 * Tests for file discovery, preview mode, and basic runner functionality.
 * Note: Tests requiring database are integration tests.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import path from 'node:path'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { preview } from '../../../src/core/runner/runner.js'
import type { RunContext } from '../../../src/core/runner/types.js'


const TMP_DIR = path.join(process.cwd(), 'tmp/runner-test')


// Mock context for preview (doesn't need real DB)
const mockContext: RunContext = {

    db: {} as RunContext['db'],
    configName: 'test',
    identity: { name: 'Test User', email: 'test@example.com', source: 'config' },
    projectRoot: TMP_DIR,
    config: { table: 'users' },
    secrets: { API_KEY: 'secret123' },
}


describe('runner: preview', () => {

    beforeAll(async () => {

        await mkdir(TMP_DIR, { recursive: true })
    })

    afterAll(async () => {

        await rm(TMP_DIR, { recursive: true, force: true })
    })

    it('should preview a raw SQL file', async () => {

        const filepath = path.join(TMP_DIR, 'raw.sql')
        await writeFile(filepath, 'SELECT * FROM users;')

        const results = await preview(mockContext, [filepath])

        expect(results).toHaveLength(1)
        expect(results[0].status).toBe('success')
        expect(results[0].renderedSql).toBe('SELECT * FROM users;')
        expect(results[0].filepath).toBe(filepath)
    })

    it('should preview a template file', async () => {

        const filepath = path.join(TMP_DIR, 'template.sql.tmpl')
        await writeFile(filepath, 'SELECT * FROM {%~ $.config.table %};')

        const results = await preview(mockContext, [filepath])

        expect(results).toHaveLength(1)
        expect(results[0].status).toBe('success')
        expect(results[0].renderedSql).toBe('SELECT * FROM users;')
    })

    it('should preview multiple files', async () => {

        const file1 = path.join(TMP_DIR, 'multi1.sql')
        const file2 = path.join(TMP_DIR, 'multi2.sql')
        await writeFile(file1, 'SELECT 1;')
        await writeFile(file2, 'SELECT 2;')

        const results = await preview(mockContext, [file1, file2])

        expect(results).toHaveLength(2)
        expect(results[0].renderedSql).toBe('SELECT 1;')
        expect(results[1].renderedSql).toBe('SELECT 2;')
    })

    it('should handle template with secrets', async () => {

        const filepath = path.join(TMP_DIR, 'secrets.sql.tmpl')
        await writeFile(filepath, "INSERT INTO keys (val) VALUES ('{%~ $.secrets.API_KEY %}');")

        const results = await preview(mockContext, [filepath])

        expect(results[0].status).toBe('success')
        expect(results[0].renderedSql).toContain('secret123')
    })

    it('should return error for non-existent file', async () => {

        const filepath = path.join(TMP_DIR, 'nonexistent.sql')

        const results = await preview(mockContext, [filepath])

        expect(results).toHaveLength(1)
        expect(results[0].status).toBe('failed')
        expect(results[0].error).toBeDefined()
    })

    it('should continue on error and process remaining files', async () => {

        const validFile = path.join(TMP_DIR, 'valid.sql')
        const invalidFile = path.join(TMP_DIR, 'invalid-does-not-exist.sql')
        await writeFile(validFile, 'SELECT 1;')

        const results = await preview(mockContext, [invalidFile, validFile])

        expect(results).toHaveLength(2)
        expect(results[0].status).toBe('failed')
        expect(results[1].status).toBe('success')
    })

    it('should write to output file when specified', async () => {

        const inputFile = path.join(TMP_DIR, 'input.sql')
        const outputFile = path.join(TMP_DIR, 'output.sql')
        await writeFile(inputFile, 'SELECT 1;')

        await preview(mockContext, [inputFile], outputFile)

        const { readFile } = await import('node:fs/promises')
        const content = await readFile(outputFile, 'utf-8')

        expect(content).toContain('SELECT 1;')
        expect(content).toContain('-- File:')
    })

    it('should compute checksums for previewed files', async () => {

        const filepath = path.join(TMP_DIR, 'checksum.sql')
        await writeFile(filepath, 'SELECT 1;')

        const results = await preview(mockContext, [filepath])

        expect(results[0].checksum).toMatch(/^[a-f0-9]{64}$/)
    })
})


describe('runner: file detection', () => {

    it('should identify SQL files', async () => {

        const { default: runnerModule } = await import('../../../src/core/runner/runner.js')

        // We can test file detection indirectly through the isTemplate function from template module
        const { isTemplate } = await import('../../../src/core/template/engine.js')

        expect(isTemplate('file.sql.tmpl')).toBe(true)
        expect(isTemplate('file.sql')).toBe(false)
        expect(isTemplate('file.ts')).toBe(false)
    })
})
