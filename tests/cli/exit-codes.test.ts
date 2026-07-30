/**
 * cli: the exit-code contract, and the no-op-reported-as-success class.
 *
 * WHY: `2` used to mean partial failure on `run build`, total failure on
 * `run dir does-not-exist` (which returned `filesRun: 0` and exit 2), and
 * "there was no lock to release" on `lock force`. A pipeline could not tell
 * "retry this" from "a human has to look at the half-written database", so
 * in practice everyone collapsed to `!= 0` and threw the distinction away.
 *
 * `src/cli/_exit.ts` now fixes the meanings: 0 success, 1 total failure,
 * 2 the invocation named something that isn't there, 3 partial.
 *
 * The second half of this file covers the defect class the audit found nine
 * times over: a command handed a nonexistent target, or an empty match set,
 * building a success payload without ever checking whether it did anything.
 * `run inspect sql/nope.sql.tmpl` returned a fully-populated context object
 * and exit 0 for a file that was never on disk.
 *
 * Driven as subprocesses against the compiled CLI — these commands call
 * `process.exit`, and the exit code is the thing under test.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
    TMP_BASE,
    cleanupProject,
    extractJsonObject,
    runCli,
    setupProject,
    type TestProject,
} from './run/_setup.js';

/** Exit codes, restated here so a change to `_exit.ts` has to be deliberate. */
const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const EXIT_PARTIAL = 3;

interface Payload {
    success?: unknown;
    status?: unknown;
    error?: unknown;
    filesRun?: number;
    [key: string]: unknown;
}

function payloadOf(stdout: string): Payload {

    const json = extractJsonObject(stdout);

    expect(json).not.toBeNull();

    return JSON.parse(json!) as Payload;

}

describe('cli: exit-code contract', () => {

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

    it('should exit PARTIAL when some files ran and some failed', async () => {

        await mkdir(join(project.dir, 'sql', 'mixed'), { recursive: true });
        await writeFile(join(project.dir, 'sql', 'mixed', '01_ok.sql'), 'CREATE TABLE mixed_ok (id INTEGER PRIMARY KEY);\n', 'utf-8');
        await writeFile(join(project.dir, 'sql', 'mixed', '02_bad.sql'), 'SELECT * FROM no_such_table_xyz;\n', 'utf-8');

        const result = runCli(project, ['run', 'dir', 'sql/mixed', '--json']);
        const payload = payloadOf(result.stdout);

        // The distinction the old single code destroyed: one statement was
        // committed, so this is not a clean failure a pipeline can retry.
        expect(payload.status).toBe('partial');
        expect(result.status).toBe(EXIT_PARTIAL);
        expect(payload.success).toBe(false);

    });

    it('should exit FAILURE, not PARTIAL, when every file failed', async () => {

        await mkdir(join(project.dir, 'sql', 'allbad'), { recursive: true });
        await writeFile(join(project.dir, 'sql', 'allbad', '01_bad.sql'), 'SELECT * FROM no_such_table_xyz;\n', 'utf-8');

        const result = runCli(project, ['run', 'dir', 'sql/allbad', '--json']);
        const payload = payloadOf(result.stdout);

        expect(payload.status).toBe('failed');
        expect(result.status).toBe(EXIT_FAILURE);

    });

    it('should exit SUCCESS when every file ran', async () => {

        await mkdir(join(project.dir, 'sql', 'allgood'), { recursive: true });
        await writeFile(join(project.dir, 'sql', 'allgood', '01_ok.sql'), 'CREATE TABLE allgood_t (id INTEGER PRIMARY KEY);\n', 'utf-8');

        const result = runCli(project, ['run', 'dir', 'sql/allgood', '--json']);
        const payload = payloadOf(result.stdout);

        expect(result.status).toBe(EXIT_SUCCESS);
        expect(payload.success).toBe(true);

    });

    it('should exit USAGE for a flag combination the command cannot honour', () => {

        const result = runCli(project, ['db', 'transfer', '--to', 'a', '--export', 'b.dt']);

        expect(result.status).toBe(EXIT_USAGE);
        expect(result.stdout + result.stderr).toContain('mutually exclusive');

    });

});

describe('cli: no-op reported as success', () => {

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

    it('should refuse to inspect a template that does not exist', () => {

        const result = runCli(project, ['run', 'inspect', 'sql/nope.sql.tmpl', '--json']);
        const payload = payloadOf(result.stdout);

        // `buildContext` only reads the template's *directory*, so a missing
        // file produced a complete, plausible context report and exit 0.
        expect(result.status).toBe(EXIT_USAGE);
        expect(payload.success).toBe(false);
        expect(String(payload.error)).toContain('not found');

    });

    it('should refuse to preview a template that does not exist', () => {

        const result = runCli(project, ['run', 'preview', 'sql/nope.sql.tmpl', '--json']);
        const payload = payloadOf(result.stdout);

        expect(result.status).toBe(EXIT_USAGE);
        expect(payload.success).toBe(false);

    });

    it('should keep stack traces and absolute paths out of the --json error field', () => {

        const result = runCli(project, ['run', 'preview', 'sql/nope.sql.tmpl', '--json']);
        const payload = payloadOf(result.stdout);

        expect(payload.success).toBe(false);

        // This exact invocation used to emit the raw ENOENT stack —
        // `at async open (node:internal/fs/promises…)` plus absolute
        // node_modules paths — into the machine-readable error field that CI
        // logs and surfaces publicly.
        expect(String(payload.error)).not.toContain('node_modules');
        expect(String(payload.error)).not.toContain(project.dir);
        expect(String(payload.error)).not.toMatch(/\n\s+at /);

    });

    it('should refuse to run a directory that does not exist', () => {

        const result = runCli(project, ['run', 'dir', 'sql/no-such-dir', '--json']);
        const payload = payloadOf(result.stdout);

        expect(result.status).toBe(EXIT_USAGE);
        expect(payload.success).toBe(false);
        expect(String(payload.error)).toContain('not found');

    });

    it('should refuse to report success for a directory containing no SQL files', async () => {

        await mkdir(join(project.dir, 'sql', 'empty'), { recursive: true });

        const result = runCli(project, ['run', 'dir', 'sql/empty', '--json']);
        const payload = payloadOf(result.stdout);

        // Core reports a zero-file batch as `status: 'success'`. Passing that
        // straight through is how a mistyped path silently passes a pipeline.
        expect(result.status).toBe(EXIT_USAGE);
        expect(payload.success).toBe(false);
        expect(payload.filesRun).toBe(0);

    });

    it('should refuse to report success for a glob that matched nothing', () => {

        const result = runCli(project, ['run', 'exec', 'sql/zzz/*.sql', '--json']);
        const payload = payloadOf(result.stdout);

        expect(result.status).toBe(EXIT_USAGE);
        expect(payload.success).toBe(false);

    });

    it('should expand a glob and execute the matched files without the Bun global', async () => {

        await mkdir(join(project.dir, 'sql', 'globbed'), { recursive: true });
        await writeFile(join(project.dir, 'sql', 'globbed', '01.sql'), 'CREATE TABLE globbed_t (id INTEGER PRIMARY KEY);\n', 'utf-8');

        // runCli spawns `node`, not `bun`: before the fallback, `run exec`
        // died with "Bun is not defined" before touching the database, which
        // is also why this command had no test coverage at all.
        const result = runCli(project, ['run', 'exec', 'sql/globbed/*.sql', '--json']);
        const payload = payloadOf(result.stdout);

        expect(result.status).toBe(EXIT_SUCCESS);
        expect(payload.success).toBe(true);
        expect(payload.filesRun).toBe(1);

    });

});
