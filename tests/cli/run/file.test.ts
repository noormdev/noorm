/**
 * cli: noorm run file — failure and skip reason surfacing.
 *
 * Verifies that when a SQL file fails or is skipped, the error
 * message and skip reason flow through to both human and JSON
 * output. Uses SQLite via env-only mode so no external DB
 * containers are required.
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

describe('cli: noorm run file — error and skip surfacing', () => {

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

    it('should surface SQL error message in human output on failure', async () => {

        const sqlPath = join(project.dir, 'sql', 'broken.sql');
        await writeFile(sqlPath, 'SELECT * FROM nonexistent_table_xyz;\n', 'utf-8');

        const result = runCli(project, ['run', 'file', 'sql/broken.sql']);

        const out = result.stdout + result.stderr;
        expect(out).toContain('broken.sql');
        expect(out).toContain('failed');
        // The underlying SQL error mentions the missing table name
        expect(out.toLowerCase()).toContain('nonexistent_table_xyz');
        expect(result.status).not.toBe(0);

    });

    it('should populate error field in --json output on failure', async () => {

        const sqlPath = join(project.dir, 'sql', 'broken.sql');
        await writeFile(sqlPath, 'SELECT * FROM nonexistent_table_xyz;\n', 'utf-8');

        const result = runCli(project, ['run', 'file', 'sql/broken.sql', '--json']);
        const jsonStr = extractJsonObject(result.stdout);

        expect(jsonStr).not.toBeNull();

        const parsed = JSON.parse(jsonStr!);

        expect(parsed.status).toBe('failed');
        expect(parsed.error).toBeDefined();
        expect(String(parsed.error).toLowerCase()).toContain('nonexistent_table_xyz');

    });

    it('should surface skip reason in human output on second run', async () => {

        const sqlPath = join(project.dir, 'sql', 'ok.sql');
        await writeFile(sqlPath, 'CREATE TABLE noorm_test_t1 (id INTEGER PRIMARY KEY);\n', 'utf-8');

        const first = runCli(project, ['run', 'file', 'sql/ok.sql']);
        expect(first.status).toBe(0);

        const second = runCli(project, ['run', 'file', 'sql/ok.sql']);
        const out = second.stdout + second.stderr;

        expect(second.status).toBe(0);
        expect(out).toContain('skipped');
        expect(out).toContain('unchanged');

    });

    it('should populate skipReason field in --json output on skip', async () => {

        const sqlPath = join(project.dir, 'sql', 'ok.sql');
        await writeFile(sqlPath, 'CREATE TABLE noorm_test_t2 (id INTEGER PRIMARY KEY);\n', 'utf-8');

        const first = runCli(project, ['run', 'file', 'sql/ok.sql']);
        expect(first.status).toBe(0);

        const second = runCli(project, ['run', 'file', 'sql/ok.sql', '--json']);
        const jsonStr = extractJsonObject(second.stdout);

        expect(jsonStr).not.toBeNull();

        const parsed = JSON.parse(jsonStr!);

        expect(parsed.status).toBe('skipped');
        expect(parsed.skipReason).toBe('unchanged');

    });

});
