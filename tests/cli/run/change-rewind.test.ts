/**
 * cli: noorm change rewind — exit code on partial failure.
 *
 * `change rewind` reverts applied changes most-recent-first, aborting on
 * the first failed revert (`abortOnError` defaults to true). When some
 * reverts succeed and at least one fails, `ChangeManager.rewind()` returns
 * `status: 'partial'` — the schema is left in a mixed state. Every sibling
 * batch command (`run`/`revert`/`ff`/`next`) maps `status === 'success' ? 0
 * : 2`; these tests guard `rewind` against the same contract.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
    cleanupProject,
    runCli,
    setupProject,
    TMP_BASE,
    type TestProject,
} from './_setup.js';

async function makeChange(
    project: TestProject,
    name: string,
    changeSql: string,
    revertSql: string,
): Promise<void> {

    const changeDir = join(project.dir, 'changes', name, 'change');
    const revertDir = join(project.dir, 'changes', name, 'revert');

    await mkdir(changeDir, { recursive: true });
    await mkdir(revertDir, { recursive: true });
    await writeFile(join(changeDir, '001.sql'), changeSql, 'utf-8');
    await writeFile(join(revertDir, '001.sql'), revertSql, 'utf-8');

}

describe('cli: noorm change rewind — exit code on partial failure', () => {

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

    it('should exit 2 and log the failure when a rewind partially fails', async () => {

        // Later-applied change reverts cleanly; earlier-applied change's
        // revert SQL errors. Rewind reverts most-recent-first, so the good
        // revert runs (executed++) before the bad one aborts (failed++),
        // yielding status 'partial'.
        await makeChange(
            project,
            '2025-01-01-first',
            'CREATE TABLE t1 (id INTEGER PRIMARY KEY);\n',
            'SELECT * FROM nonexistent_table_xyz;\n',
        );
        await makeChange(
            project,
            '2025-01-02-second',
            'CREATE TABLE t2 (id INTEGER PRIMARY KEY);\n',
            'DROP TABLE t2;\n',
        );

        expect(runCli(project, ['change', 'run', '2025-01-01-first']).status).toBe(0);
        expect(runCli(project, ['change', 'run', '2025-01-02-second']).status).toBe(0);

        const result = runCli(project, ['change', 'rewind', '2025-01-01-first']);
        const out = result.stdout + result.stderr;

        expect(result.status).toBe(2);
        expect(out.toLowerCase()).toContain('failed');

    });

    it('should exit 0 when a rewind fully succeeds', async () => {

        await makeChange(
            project,
            '2025-01-01-only',
            'CREATE TABLE t3 (id INTEGER PRIMARY KEY);\n',
            'DROP TABLE t3;\n',
        );

        expect(runCli(project, ['change', 'run', '2025-01-01-only']).status).toBe(0);

        const result = runCli(project, ['change', 'rewind', '2025-01-01-only']);

        expect(result.status).toBe(0);

    });

});
