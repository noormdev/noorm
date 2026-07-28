/**
 * cli: noorm run build — per-file error and skip surfacing in batch summaries,
 * and --dry-run honoring (issue #49).
 *
 * `run build` executes every file under `paths.sql/`. When any file
 * fails or is skipped, the summary alone is not enough — users need
 * to know *which* file and *why*. These tests verify that information
 * appears in both human output and the JSON `files[]` array.
 *
 * The --dry-run tests guard against #49's regression: the flag was declared
 * in `sharedArgs` but never spread into `build`'s citty `args`, so
 * `args.dryRun` was always `undefined` and a "preview" build silently
 * applied every file to the target database.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';

import { createConnection } from '../../../src/core/connection/factory.js';
import {
    cleanupProject,
    extractJsonObject,
    runCli,
    setupProject,
    TMP_BASE,
    type TestProject,
} from './_setup.js';

/**
 * Whether a table exists in the project's SQLite database — the ground
 * truth for "did the build actually execute", independent of anything
 * the CLI printed.
 */
async function tableExists(project: TestProject, tableName: string): Promise<boolean> {

    const conn = await createConnection({ dialect: 'sqlite', database: project.dbPath }, '__test__');

    const result = await sql<{ name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${tableName}
    `.execute(conn.db);

    await conn.destroy();

    return result.rows.length > 0;

}

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
    dryRun?: boolean;
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

});

describe('cli: noorm run build — skip-on-rerun (CP10, v1/49-54)', () => {

    // Previously untestable: `executeFiles` creates an upfront 'pending'
    // execution record for every file before `needsRun` ever runs, and
    // `needsRun` picked the newest row by id -- always that same pending
    // record -- so it always read as 'new'. Checksum-based skipping was
    // structurally unreachable for build/dir/files. Fixed by excluding the
    // running operation's own rows from the `needsRun` lookup.

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

    it('should skip an unchanged file on a second build', async () => {

        await writeFile(
            join(project.dir, 'sql', '001_skip.sql'),
            'CREATE TABLE noorm_build_skip_a (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );

        const first = runCli(project, ['run', 'build']);
        expect(first.status).toBe(0);

        const second = runCli(project, ['run', 'build', '--json']);
        expect(second.status).toBe(0);

        const jsonStr = extractJsonObject(second.stdout);
        expect(jsonStr).not.toBeNull();

        const parsed: BatchResult = JSON.parse(jsonStr!);

        expect(parsed.filesSkipped).toBe(1);
        expect(parsed.filesRun).toBe(0);
        expect(parsed.files[0]!.status).toBe('skipped');
        expect(parsed.files[0]!.skipReason).toBe('unchanged');

    });

    it('should say so in human output on the second build', async () => {

        await writeFile(
            join(project.dir, 'sql', '001_skip.sql'),
            'CREATE TABLE noorm_build_skip_b (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );

        const first = runCli(project, ['run', 'build']);
        expect(first.status).toBe(0);

        const second = runCli(project, ['run', 'build']);
        const out = second.stdout + second.stderr;

        expect(second.status).toBe(0);
        expect(out).toContain('skipped');
        expect(out).toContain('unchanged');

    });

    it('should re-run an unchanged file when --force is passed', async () => {

        await writeFile(
            join(project.dir, 'sql', '001_force.sql'),
            'CREATE TABLE IF NOT EXISTS noorm_build_force (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );

        const first = runCli(project, ['run', 'build']);
        expect(first.status).toBe(0);

        // Unforced: the unchanged file is skipped.
        const second = runCli(project, ['run', 'build', '--json']);
        const secondParsed: BatchResult = JSON.parse(extractJsonObject(second.stdout)!);
        expect(secondParsed.filesSkipped).toBe(1);
        expect(secondParsed.filesRun).toBe(0);

        // Forced: the same unchanged file re-runs instead of skipping.
        const third = runCli(project, ['run', 'build', '--force', '--json']);
        const thirdParsed: BatchResult = JSON.parse(extractJsonObject(third.stdout)!);
        expect(thirdParsed.filesRun).toBe(1);
        expect(thirdParsed.filesSkipped).toBe(0);

    });

    it('should re-run a file whose content changed since the last build', async () => {

        const filePath = join(project.dir, 'sql', '001_changed.sql');
        await writeFile(
            filePath,
            'CREATE TABLE noorm_build_changed_a (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );

        const first = runCli(project, ['run', 'build']);
        expect(first.status).toBe(0);

        // A content change is a different checksum, distinct from the
        // upfront-pending-row bug CP10 fixes.
        await writeFile(
            filePath,
            'CREATE TABLE noorm_build_changed_b (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );

        const second = runCli(project, ['run', 'build', '--json']);
        expect(second.status).toBe(0);

        const parsed: BatchResult = JSON.parse(extractJsonObject(second.stdout)!);

        expect(parsed.filesRun).toBe(1);
        expect(parsed.filesSkipped).toBe(0);
        expect(await tableExists(project, 'noorm_build_changed_b')).toBe(true);

    });

});

describe('cli: noorm run build --dry-run', () => {

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

    it('should create zero database objects', async () => {

        await writeFile(
            join(project.dir, 'sql', '001_dryrun.sql'),
            'CREATE TABLE noorm_build_dryrun_a (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );

        const result = runCli(project, ['run', 'build', '--dry-run']);

        expect(result.status).toBe(0);
        expect(await tableExists(project, 'noorm_build_dryrun_a')).toBe(false);

    });

    it('should create the table on a sibling non-dry-run build', async () => {

        await writeFile(
            join(project.dir, 'sql', '001_live.sql'),
            'CREATE TABLE noorm_build_dryrun_b (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );

        const result = runCli(project, ['run', 'build']);

        expect(result.status).toBe(0);
        expect(await tableExists(project, 'noorm_build_dryrun_b')).toBe(true);

    });

    it('should mark the JSON payload with dryRun: true', async () => {

        await writeFile(
            join(project.dir, 'sql', '001_dryrun.sql'),
            'CREATE TABLE noorm_build_dryrun_c (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );

        const result = runCli(project, ['run', 'build', '--dry-run', '--json']);
        const jsonStr = extractJsonObject(result.stdout);

        expect(jsonStr).not.toBeNull();

        const parsed: BatchResult = JSON.parse(jsonStr!);

        expect(parsed.dryRun).toBe(true);
        expect(parsed.status).toBe('success');
        expect(await tableExists(project, 'noorm_build_dryrun_c')).toBe(false);

    });

    it('should say so in human output', async () => {

        await writeFile(
            join(project.dir, 'sql', '001_dryrun.sql'),
            'CREATE TABLE noorm_build_dryrun_d (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );

        const result = runCli(project, ['run', 'build', '--dry-run']);
        const out = (result.stdout + result.stderr).toLowerCase();

        expect(out).toContain('dry');

    });

});
