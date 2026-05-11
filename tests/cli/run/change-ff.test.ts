/**
 * cli: noorm change ff — failure surfacing for batch change application.
 *
 * `change ff` walks pending changes and applies each one. When a change
 * fails, the CLI used to print only the aggregate counts and the change
 * name + `(failed)`, leaving operators to hunt for the cause. These
 * tests verify the underlying SQL error and the failing file are now
 * surfaced inline.
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

interface ChangeFileResult {
    filepath: string;
    status: string;
    error?: string;
}

interface ChangeResult {
    name: string;
    status: string;
    error?: string;
    files: ChangeFileResult[];
}

interface BatchChangeResult {
    status: string;
    changes: ChangeResult[];
}

async function makeChange(project: TestProject, name: string, sql: string): Promise<void> {

    const changeDir = join(project.dir, 'changes', name, 'change');
    await mkdir(changeDir, { recursive: true });
    await writeFile(join(changeDir, '001.sql'), sql, 'utf-8');

}

describe('cli: noorm change ff — failure surfacing', () => {

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

    it('should print the failing change and its SQL error in human output', async () => {

        await makeChange(
            project,
            '2025-01-01-ok',
            'CREATE TABLE noorm_ff_t1 (id INTEGER PRIMARY KEY);\n',
        );
        await makeChange(
            project,
            '2025-01-02-bad',
            'SELECT * FROM nonexistent_table_xyz;\n',
        );

        const result = runCli(project, ['change', 'ff']);
        const out = result.stdout + result.stderr;

        expect(out).toContain('2025-01-02-bad');
        expect(out).toContain('failed');
        // The underlying SQL error message should be in the output.
        expect(out.toLowerCase()).toContain('nonexistent_table_xyz');
        expect(result.status).not.toBe(0);

    });

    it('should populate per-change error in --json output', async () => {

        await makeChange(
            project,
            '2025-01-01-bad',
            'SELECT * FROM nonexistent_table_xyz;\n',
        );

        const result = runCli(project, ['change', 'ff', '--json']);
        const jsonStr = extractJsonObject(result.stdout);

        expect(jsonStr).not.toBeNull();

        const parsed: BatchChangeResult = JSON.parse(jsonStr!);
        const failed = parsed.changes.find((c) => c.status === 'failed');

        expect(failed).toBeDefined();
        // Each failed change either carries its own `error` field or has at
        // least one failed file with the SQL error attached.
        const hasErrorOnChange = failed!.error
            && String(failed!.error).toLowerCase().includes('nonexistent_table_xyz');
        const hasErrorOnFile = failed!.files.some(
            (f) => f.status === 'failed'
                && f.error
                && String(f.error).toLowerCase().includes('nonexistent_table_xyz'),
        );

        expect(hasErrorOnChange || hasErrorOnFile).toBe(true);

    });

});
