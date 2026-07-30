/**
 * Runner tests.
 *
 * Uses permanent fixture files in ./fixtures/ for testing.
 * Note: Tests requiring database are integration tests.
 */
import { describe, it, expect, afterAll } from 'bun:test';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { attempt } from '@logosdx/utils';
import { preview, runBuild, runFile, runDir, runFiles, checkFilesStatus } from '../../../src/core/runner/runner.js';
import type { RunContext } from '../../../src/core/runner/types.js';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');
const TMP_DIR = path.join(process.cwd(), 'tmp/runner-test');

// Mock context for preview (doesn't need real DB)
const mockContext: RunContext = {
    db: {} as RunContext['db'],
    configName: 'test',
    identity: { name: 'Test User', email: 'test@example.com', source: 'config' },
    projectRoot: FIXTURES_DIR,
    access: { user: 'admin', agent: 'admin' },
    channel: 'user',
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
        expect(results[0]!.status).toBe('success');
        expect(results[0]!.renderedSql).toBe('SELECT * FROM users;');
        expect(results[0]!.filepath).toBe(filepath);

    });

    it('should preview a template file', async () => {

        const filepath = path.join(FIXTURES_DIR, 'template.sql.tmpl');

        const results = await preview(mockContext, [filepath]);

        expect(results).toHaveLength(1);
        expect(results[0]!.status).toBe('success');
        expect(results[0]!.renderedSql).toBe('SELECT * FROM users;');

    });

    it('should preview multiple files', async () => {

        const file1 = path.join(FIXTURES_DIR, 'select-1.sql');
        const file2 = path.join(FIXTURES_DIR, 'select-2.sql');

        const results = await preview(mockContext, [file1, file2]);

        expect(results).toHaveLength(2);
        expect(results[0]!.renderedSql).toBe('SELECT 1;');
        expect(results[1]!.renderedSql).toBe('SELECT 2;');

    });

    it('should handle template with secrets', async () => {

        const filepath = path.join(FIXTURES_DIR, 'secrets.sql.tmpl');

        const results = await preview(mockContext, [filepath]);

        expect(results[0]!.status).toBe('success');
        expect(results[0]!.renderedSql).toContain('secret123');

    });

    it('should return error for non-existent file', async () => {

        const filepath = path.join(FIXTURES_DIR, 'nonexistent.sql');

        const results = await preview(mockContext, [filepath]);

        expect(results).toHaveLength(1);
        expect(results[0]!.status).toBe('failed');
        expect(results[0]!.error).toBeDefined();

    });

    it('should continue on error and process remaining files', async () => {

        const validFile = path.join(FIXTURES_DIR, 'select-1.sql');
        const invalidFile = path.join(FIXTURES_DIR, 'invalid-does-not-exist.sql');

        const results = await preview(mockContext, [invalidFile, validFile]);

        expect(results).toHaveLength(2);
        expect(results[0]!.status).toBe('failed');
        expect(results[1]!.status).toBe('success');

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

        expect(results[0]!.checksum).toMatch(/^[a-f0-9]{64}$/);

    });

});

describe('runner: policy gate', () => {

    // Viewer denies run:build/run:file/run:dir outright (matrix cell:
    // deny) — the gate is the first thing each entrypoint does, so this
    // proves it fires before any file I/O or DB access is attempted.
    const viewerContext: RunContext = {
        ...mockContext,
        access: { user: 'viewer', agent: false },
    };

    it('should deny runBuild for a viewer role', async () => {

        await expect(runBuild(viewerContext, FIXTURES_DIR)).rejects.toThrow(/run:build/);

    });

    it('should deny runFile for a viewer role', async () => {

        const filepath = path.join(FIXTURES_DIR, 'raw.sql');

        await expect(runFile(viewerContext, filepath)).rejects.toThrow(/run:file/);

    });

    it('should deny runDir for a viewer role', async () => {

        await expect(runDir(viewerContext, FIXTURES_DIR)).rejects.toThrow(/run:dir/);

    });

    it('should deny runFiles for a viewer role', async () => {

        const filepath = path.join(FIXTURES_DIR, 'raw.sql');

        await expect(runFiles(viewerContext, [filepath])).rejects.toThrow(/run:dir/);

    });

    it('should carry the config name in the denial reason', async () => {

        const filepath = path.join(FIXTURES_DIR, 'raw.sql');

        await expect(runFile(viewerContext, filepath)).rejects.toThrow(/"test"/);

    });

    // `preview` and `checkFilesStatus` render templates: they resolve every
    // secret tier by design and they execute referenced `$helpers`/side-car
    // scripts. Leaving them ungated meant the one role denied every `run:*`
    // permission could still dump plaintext secrets and run code.
    it('should deny preview for a viewer role', async () => {

        const filepath = path.join(FIXTURES_DIR, 'template.sql.tmpl');

        await expect(preview(viewerContext, [filepath])).rejects.toThrow(/run:file/);

    });

    it('should deny checkFilesStatus for a viewer role', async () => {

        const filepath = path.join(FIXTURES_DIR, 'raw.sql');

        await expect(checkFilesStatus(viewerContext, [filepath])).rejects.toThrow(/run:file/);

    });

    it('should not render anything before denying preview', async () => {

        const filepath = path.join(FIXTURES_DIR, 'template.sql.tmpl');

        const [results, err] = await attempt(() => preview(viewerContext, [filepath]));

        // A per-file failure result would mean the loop was entered and the
        // template was reached; the gate has to reject the whole call.
        expect(Array.isArray(results)).toBe(false);
        expect(err).toBeInstanceOf(Error);

    });

    it('should still allow preview for an operator role', async () => {

        const filepath = path.join(FIXTURES_DIR, 'template.sql.tmpl');

        const results = await preview(
            { ...mockContext, access: { user: 'operator', agent: 'operator' } },
            [filepath],
        );

        expect(results[0]!.status).toBe('success');

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
