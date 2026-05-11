/**
 * cli: noorm run dir — per-file error and skip surfacing.
 *
 * `run dir <path>` executes every SQL file under <path>. The CLI
 * used to print only the aggregate `filesRun/filesSkipped/filesFailed`
 * counts. These tests pin down the new per-file lines and the JSON
 * shape so callers can diagnose failures without sifting stdout.
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

describe('cli: noorm run dir — per-file error and skip surfacing', () => {

    let project: TestProject;

    beforeAll(async () => {

        await mkdir(TMP_BASE, { recursive: true });

    });

    beforeEach(async () => {

        project = await setupProject();
        await mkdir(join(project.dir, 'sql', 'migrations'), { recursive: true });

    });

    afterEach(async () => {

        await cleanupProject(project);

    });

    it('should print failing file path and SQL error in human output', async () => {

        await writeFile(
            join(project.dir, 'sql', 'migrations', '001_ok.sql'),
            'CREATE TABLE noorm_dir_t1 (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );
        await writeFile(
            join(project.dir, 'sql', 'migrations', '002_bad.sql'),
            'SELECT * FROM nonexistent_table_xyz;\n',
            'utf-8',
        );

        const result = runCli(project, ['run', 'dir', 'sql/migrations']);
        const out = result.stdout + result.stderr;

        expect(out).toContain('002_bad.sql');
        expect(out).toContain('failed');
        expect(out.toLowerCase()).toContain('nonexistent_table_xyz');
        expect(result.status).not.toBe(0);

    });

    it('should include error per failed file in --json output', async () => {

        await writeFile(
            join(project.dir, 'sql', 'migrations', '001_bad.sql'),
            'SELECT * FROM nonexistent_table_xyz;\n',
            'utf-8',
        );

        const result = runCli(project, ['run', 'dir', 'sql/migrations', '--json']);
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
    // notes). The display logic for skip reasons in `run dir` mirrors
    // `run build`, and the runFile flow's skip path is covered by
    // tests/cli/run/file.test.ts.

});
