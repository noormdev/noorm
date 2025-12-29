/**
 * Runner tests.
 *
 * Uses permanent fixture files in ./fixtures/ for testing.
 * Note: Tests requiring database are integration tests.
 */
import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { preview } from '../../../src/core/runner/runner.js';
import type { RunContext } from '../../../src/core/runner/types.js';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');
const TMP_DIR = path.join(process.cwd(), 'tmp/runner-test');

// Mock context for preview (doesn't need real DB)
const mockContext: RunContext = {
    db: {} as RunContext['db'],
    configName: 'test',
    identity: { name: 'Test User', email: 'test@example.com', source: 'config' },
    projectRoot: FIXTURES_DIR,
    config: { table: 'users' },
    secrets: { API_KEY: 'secret123' },
};

describe('runner: preview', () => {

    afterAll(async () => {

        // Clean up any output files created during tests
        await rm(TMP_DIR, { recursive: true, force: true });

    });

    it('should preview a raw SQL file', async () => {

        const filepath = path.join(FIXTURES_DIR, 'raw.sql');

        const results = await preview(mockContext, [filepath]);

        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('success');
        expect(results[0].renderedSql).toBe('SELECT * FROM users;');
        expect(results[0].filepath).toBe(filepath);

    });

    it('should preview a template file', async () => {

        const filepath = path.join(FIXTURES_DIR, 'template.sql.tmpl');

        const results = await preview(mockContext, [filepath]);

        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('success');
        expect(results[0].renderedSql).toBe('SELECT * FROM users;');

    });

    it('should preview multiple files', async () => {

        const file1 = path.join(FIXTURES_DIR, 'select-1.sql');
        const file2 = path.join(FIXTURES_DIR, 'select-2.sql');

        const results = await preview(mockContext, [file1, file2]);

        expect(results).toHaveLength(2);
        expect(results[0].renderedSql).toBe('SELECT 1;');
        expect(results[1].renderedSql).toBe('SELECT 2;');

    });

    it('should handle template with secrets', async () => {

        const filepath = path.join(FIXTURES_DIR, 'secrets.sql.tmpl');

        const results = await preview(mockContext, [filepath]);

        expect(results[0].status).toBe('success');
        expect(results[0].renderedSql).toContain('secret123');

    });

    it('should return error for non-existent file', async () => {

        const filepath = path.join(FIXTURES_DIR, 'nonexistent.sql');

        const results = await preview(mockContext, [filepath]);

        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('failed');
        expect(results[0].error).toBeDefined();

    });

    it('should continue on error and process remaining files', async () => {

        const validFile = path.join(FIXTURES_DIR, 'select-1.sql');
        const invalidFile = path.join(FIXTURES_DIR, 'invalid-does-not-exist.sql');

        const results = await preview(mockContext, [invalidFile, validFile]);

        expect(results).toHaveLength(2);
        expect(results[0].status).toBe('failed');
        expect(results[1].status).toBe('success');

    });

    it('should write to output file when specified', async () => {

        const inputFile = path.join(FIXTURES_DIR, 'select-1.sql');
        const { mkdir } = await import('node:fs/promises');
        await mkdir(TMP_DIR, { recursive: true });
        const outputFile = path.join(TMP_DIR, 'output.sql');

        await preview(mockContext, [inputFile], outputFile);

        const { readFile } = await import('node:fs/promises');
        const content = await readFile(outputFile, 'utf-8');

        expect(content).toContain('SELECT 1;');
        expect(content).toContain('-- File:');

    });

    it('should compute checksums for previewed files', async () => {

        const filepath = path.join(FIXTURES_DIR, 'select-1.sql');

        const results = await preview(mockContext, [filepath]);

        expect(results[0].checksum).toMatch(/^[a-f0-9]{64}$/);

    });

});

describe('runner: file detection', () => {

    it('should identify SQL files', async () => {

        // We can test file detection indirectly through the isTemplate function from template module
        const { isTemplate } = await import('../../../src/core/template/engine.js');

        expect(isTemplate('file.sql.tmpl')).toBe(true);
        expect(isTemplate('file.sql')).toBe(false);
        expect(isTemplate('file.ts')).toBe(false);

    });

});
