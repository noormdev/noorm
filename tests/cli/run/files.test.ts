/**
 * cli: noorm run files / noorm run exec — per-file error and skip surfacing.
 *
 * These commands iterate over an explicit list of paths (or a glob).
 * Each file lands on its own line in human output; failures and skips
 * should annotate that line so the user does not have to cross-reference
 * the aggregate counts with stdout to find what went wrong.
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
}

describe('cli: noorm run files — per-file error and skip surfacing', () => {

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

    it('should annotate the failed file with its error message', async () => {

        await writeFile(
            join(project.dir, 'sql', 'a.sql'),
            'CREATE TABLE noorm_files_t1 (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );
        await writeFile(
            join(project.dir, 'sql', 'b.sql'),
            'SELECT * FROM nonexistent_table_xyz;\n',
            'utf-8',
        );

        const result = runCli(project, ['run', 'files', '--paths', 'sql/a.sql,sql/b.sql']);
        const out = result.stdout + result.stderr;

        expect(out).toContain('b.sql');
        expect(out).toContain('failed');
        expect(out.toLowerCase()).toContain('nonexistent_table_xyz');
        expect(result.status).not.toBe(0);

    });

    it('should populate error per failed file in --json output', async () => {

        await writeFile(
            join(project.dir, 'sql', 'a.sql'),
            'CREATE TABLE noorm_files_t2 (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );
        await writeFile(
            join(project.dir, 'sql', 'b.sql'),
            'SELECT * FROM nonexistent_table_xyz;\n',
            'utf-8',
        );

        const result = runCli(project, ['run', 'files', '--paths', 'sql/a.sql,sql/b.sql', '--json']);
        const jsonStr = extractJsonObject(result.stdout);

        expect(jsonStr).not.toBeNull();

        const parsed: BatchResult = JSON.parse(jsonStr!);
        const failed = parsed.files.find((f) => f.status === 'failed');

        expect(failed).toBeDefined();
        expect(failed!.error).toBeDefined();
        expect(String(failed!.error).toLowerCase()).toContain('nonexistent_table_xyz');

    });

    // Note: skip-on-re-run is not testable here for the same reason as
    // build (latent runner bug — see build.test.ts comment and handoff
    // notes). The display logic for skip reasons in `run files` mirrors
    // `run build`, and the runFile flow's skip path is covered by
    // tests/cli/run/file.test.ts.

});

describe('cli: noorm run exec — per-file error and skip surfacing', () => {

    let project: TestProject;

    beforeAll(async () => {

        await mkdir(TMP_BASE, { recursive: true });

    });

    beforeEach(async () => {

        project = await setupProject();
        await mkdir(join(project.dir, 'sql', 'batch'), { recursive: true });

    });

    afterEach(async () => {

        await cleanupProject(project);

    });

    it('should annotate the failed file with its error message', async () => {

        await writeFile(
            join(project.dir, 'sql', 'batch', '001_ok.sql'),
            'CREATE TABLE noorm_exec_t1 (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );
        await writeFile(
            join(project.dir, 'sql', 'batch', '002_bad.sql'),
            'SELECT * FROM nonexistent_table_xyz;\n',
            'utf-8',
        );

        const result = runCli(project, ['run', 'exec', 'sql/batch']);
        const out = result.stdout + result.stderr;

        expect(out).toContain('002_bad.sql');
        expect(out).toContain('failed');
        expect(out.toLowerCase()).toContain('nonexistent_table_xyz');
        expect(result.status).not.toBe(0);

    });

    it('should populate error per failed file in --json output', async () => {

        await writeFile(
            join(project.dir, 'sql', 'batch', '001_bad.sql'),
            'SELECT * FROM nonexistent_table_xyz;\n',
            'utf-8',
        );

        const result = runCli(project, ['run', 'exec', 'sql/batch', '--json']);
        const jsonStr = extractJsonObject(result.stdout);

        expect(jsonStr).not.toBeNull();

        const parsed: BatchResult = JSON.parse(jsonStr!);
        const failed = parsed.files.find((f) => f.status === 'failed');

        expect(failed).toBeDefined();
        expect(failed!.error).toBeDefined();
        expect(String(failed!.error).toLowerCase()).toContain('nonexistent_table_xyz');

    });

});
