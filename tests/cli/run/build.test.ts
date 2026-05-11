/**
 * cli: noorm run build — per-file error and skip surfacing in batch summaries.
 *
 * `run build` executes every file under `paths.sql/`. When any file
 * fails or is skipped, the summary alone is not enough — users need
 * to know *which* file and *why*. These tests verify that information
 * appears in both human output and the JSON `files[]` array.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
    cleanupProject,
    extractJsonObject,
    runCli,
    setupProject,
    TMP_BASE,
    type TestProject,
} from './_setup.js';

interface FileResult {
    filepath: string;
    status: string;
    error?: string;
    skipReason?: string;
}

interface BatchResult {
    status: string;
    files: FileResult[];
    filesRun: number;
    filesSkipped: number;
    filesFailed: number;
}

describe('cli: noorm run build — per-file error and skip surfacing', () => {

    let project: TestProject;

    beforeAll(async () => {

        await mkdir(TMP_BASE, { recursive: true });

    });

    beforeEach(async () => {

        project = await setupProject();

    });

    afterEach(async () => {

        await cleanupProject(project);

    });

    it('should print which file failed and the SQL error in human output', async () => {

        // Two files — one good, one broken — so we can verify the bad one
        // is surfaced individually rather than buried in the aggregate.
        await writeFile(
            join(project.dir, 'sql', '001_ok.sql'),
            'CREATE TABLE noorm_build_t1 (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );
        await writeFile(
            join(project.dir, 'sql', '002_bad.sql'),
            'SELECT * FROM nonexistent_table_xyz;\n',
            'utf-8',
        );

        const result = runCli(project, ['run', 'build']);
        const out = result.stdout + result.stderr;

        expect(out).toContain('002_bad.sql');
        expect(out).toContain('failed');
        expect(out.toLowerCase()).toContain('nonexistent_table_xyz');
        // Per the spec, the summary line shouldn't claim success on failure.
        expect(out).not.toContain('completed successfully');
        expect(result.status).not.toBe(0);

    });

    it('should include error per failed file in --json output', async () => {

        await writeFile(
            join(project.dir, 'sql', '001_ok.sql'),
            'CREATE TABLE noorm_build_t2 (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );
        await writeFile(
            join(project.dir, 'sql', '002_bad.sql'),
            'SELECT * FROM nonexistent_table_xyz;\n',
            'utf-8',
        );

        const result = runCli(project, ['run', 'build', '--json']);
        const jsonStr = extractJsonObject(result.stdout);

        expect(jsonStr).not.toBeNull();

        const parsed: BatchResult = JSON.parse(jsonStr!);

        expect(parsed.status).not.toBe('success');
        expect(parsed.filesFailed).toBeGreaterThanOrEqual(1);

        const failed = parsed.files.find((f) => f.status === 'failed');
        expect(failed).toBeDefined();
        expect(failed!.error).toBeDefined();
        expect(String(failed!.error).toLowerCase()).toContain('nonexistent_table_xyz');

    });

    // Note: skip-on-re-run is not testable for build/dir/files because the
    // runner's `executeFiles` flow creates an upfront 'pending' execution
    // record before calling needsRun, which then finds the pending row
    // (newest by id) and re-runs the file. This is a latent runner bug
    // independent of the observability work in this slice — see handoff
    // notes. The skip-reason display logic is exercised end-to-end by
    // tests/cli/run/file.test.ts, which uses the runFile flow that
    // bypasses createFileRecords.

});
