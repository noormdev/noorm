/**
 * cli: noorm change ff --dry-run.
 *
 * Verifies that the dry-run flag is honored end-to-end:
 *
 * - The CLI threads it into the SDK and into the change manager.
 * - The change executor's dry-run branch writes to tmp/ without
 *   touching `__noorm_change__`.
 * - Human and `--json` output advertise the dry-run state so
 *   operators (and CI pipelines) can tell the result is non-binding.
 *
 * Regression target: prior to slice 2, the CLI accepted `--dry-run`
 * but discarded it, so changes were applied to the database anyway.
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
    executed: number;
    skipped: number;
    failed: number;
    dryRun?: boolean;
}

async function makeChange(project: TestProject, name: string, sql: string): Promise<void> {

    const changeDir = join(project.dir, 'changes', name, 'change');
    await mkdir(changeDir, { recursive: true });
    await writeFile(join(changeDir, '001.sql'), sql, 'utf-8');

}

/**
 * Count rows in `__noorm_change__` for the given change names.
 *
 * The dry-run branch never writes to this table, so a non-zero count
 * after `change ff --dry-run` indicates the flag was ignored.
 *
 * Uses kysely-via-factory rather than `better-sqlite3` directly to
 * avoid native module version mismatches in CI.
 */
async function countTrackedChanges(project: TestProject, names: string[]): Promise<number> {

    const conn = await createConnection(
        { dialect: 'sqlite', database: project.dbPath },
        '__test__',
    );

    const result = await sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM __noorm_change__ WHERE name IN (${sql.join(names)})
    `.execute(conn.db);

    await conn.destroy();

    return Number(result.rows[0]?.n ?? 0);

}

describe('cli: noorm change ff --dry-run', () => {

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

    it('should render pending changes without writing to the database', async () => {

        await makeChange(
            project,
            '2025-01-01-first',
            'CREATE TABLE noorm_dry_a (id INTEGER PRIMARY KEY);\n',
        );
        await makeChange(
            project,
            '2025-01-02-second',
            'CREATE TABLE noorm_dry_b (id INTEGER PRIMARY KEY);\n',
        );

        const result = runCli(project, ['change', 'ff', '--dry-run']);
        const out = result.stdout + result.stderr;

        expect(result.status).toBe(0);
        // Names of both pending changes appear in the human output.
        expect(out).toContain('2025-01-01-first');
        expect(out).toContain('2025-01-02-second');
        // Output makes the dry-run state obvious.
        expect(out.toLowerCase()).toContain('dry');

        // Verify the executor never wrote to the tracking table — the
        // primary guarantee a dry-run is supposed to provide.
        const tracked = await countTrackedChanges(project, [
            '2025-01-01-first',
            '2025-01-02-second',
        ]);
        expect(tracked).toBe(0);

    });

    it('should emit a parseable JSON payload with a dry-run indicator', async () => {

        await makeChange(
            project,
            '2025-02-01-a',
            'CREATE TABLE noorm_dry_json_a (id INTEGER PRIMARY KEY);\n',
        );
        await makeChange(
            project,
            '2025-02-02-b',
            'CREATE TABLE noorm_dry_json_b (id INTEGER PRIMARY KEY);\n',
        );

        const result = runCli(project, ['change', 'ff', '--dry-run', '--json']);
        const jsonStr = extractJsonObject(result.stdout);

        expect(jsonStr).not.toBeNull();

        const parsed: BatchChangeResult = JSON.parse(jsonStr!);

        expect(result.status).toBe(0);
        expect(parsed.dryRun).toBe(true);
        expect(parsed.status).toBe('success');
        expect(parsed.changes.length).toBe(2);

        // Sanity-check no DB writes happened.
        const tracked = await countTrackedChanges(project, [
            '2025-02-01-a',
            '2025-02-02-b',
        ]);
        expect(tracked).toBe(0);

    });

    it('should exit 0 with an up-to-date summary when no changes are pending', async () => {

        // Apply a single change first so it moves out of "pending".
        await makeChange(
            project,
            '2025-03-01-only',
            'CREATE TABLE noorm_dry_applied (id INTEGER PRIMARY KEY);\n',
        );

        const apply = runCli(project, ['change', 'ff']);
        expect(apply.status).toBe(0);

        // Now there are no pending changes — a dry-run should still exit 0.
        const dry = runCli(project, ['change', 'ff', '--dry-run']);

        expect(dry.status).toBe(0);
        // No further changes were "rendered".
        const out = (dry.stdout + dry.stderr).toLowerCase();
        expect(out).toContain('dry');

    });

});
