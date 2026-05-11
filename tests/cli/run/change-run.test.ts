/**
 * cli: noorm change run — failure surfacing for a single change.
 *
 * `change run <name>` applies a single named change. On failure the
 * CLI now emits the failing file path and the underlying SQL error
 * instead of just `(failed)`.
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

async function makeChange(project: TestProject, name: string, sql: string): Promise<void> {

    const changeDir = join(project.dir, 'changes', name, 'change');
    await mkdir(changeDir, { recursive: true });
    await writeFile(join(changeDir, '001.sql'), sql, 'utf-8');

}

describe('cli: noorm change run — failure surfacing', () => {

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

    it('should print the SQL error in human output when the change fails', async () => {

        await makeChange(
            project,
            '2025-01-01-bad',
            'SELECT * FROM nonexistent_table_xyz;\n',
        );

        const result = runCli(project, ['change', 'run', '2025-01-01-bad']);
        const out = result.stdout + result.stderr;

        expect(out).toContain('2025-01-01-bad');
        expect(out).toContain('failed');
        expect(out.toLowerCase()).toContain('nonexistent_table_xyz');
        expect(result.status).not.toBe(0);

    });

    it('should populate error fields in --json output on failure', async () => {

        await makeChange(
            project,
            '2025-01-01-bad',
            'SELECT * FROM nonexistent_table_xyz;\n',
        );

        const result = runCli(project, ['change', 'run', '2025-01-01-bad', '--json']);
        const jsonStr = extractJsonObject(result.stdout);

        expect(jsonStr).not.toBeNull();

        const parsed: ChangeResult = JSON.parse(jsonStr!);

        expect(parsed.status).not.toBe('success');

        const hasErrorOnChange = parsed.error
            && String(parsed.error).toLowerCase().includes('nonexistent_table_xyz');
        const hasErrorOnFile = parsed.files.some(
            (f) => f.status === 'failed'
                && f.error
                && String(f.error).toLowerCase().includes('nonexistent_table_xyz'),
        );

        expect(hasErrorOnChange || hasErrorOnFile).toBe(true);

    });

});
