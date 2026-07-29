/**
 * cli: noorm db teardown --dry-run (issue #49).
 *
 * `db teardown` had the same omission as `run build`: `sharedArgs.dryRun`
 * was never spread into the command's args, and `ctx.noorm.db.teardown()`
 * took no options at all — so `--dry-run` was a silent no-op and the
 * command dropped every object regardless of the flag.
 *
 * Reuses the `run/_setup.ts` SQLite harness — an env-only project needs no
 * identity setup, and the default access role (admin/admin) clears the
 * `db:reset` confirm gate without `--yes`.
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
} from '../run/_setup.js';

interface TeardownJson {
    dropped: { tables: string[] };
    count: number;
    dryRun?: boolean;
}

async function tableExists(project: TestProject, tableName: string): Promise<boolean> {

    const conn = await createConnection({ dialect: 'sqlite', database: project.dbPath }, '__test__');

    const result = await sql<{ name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${tableName}
    `.execute(conn.db);

    await conn.destroy();

    return result.rows.length > 0;

}

describe('cli: noorm db teardown --dry-run', () => {

    let project: TestProject;

    beforeAll(async () => {

        await mkdir(TMP_BASE, { recursive: true });

    });

    beforeEach(async () => {

        project = await setupProject();

        await writeFile(
            join(project.dir, 'sql', '001_seed.sql'),
            'CREATE TABLE noorm_teardown_dryrun (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );

        const build = runCli(project, ['run', 'build']);
        expect(build.status).toBe(0);
        expect(await tableExists(project, 'noorm_teardown_dryrun')).toBe(true);

    });

    afterEach(async () => {

        await cleanupProject(project);

    });

    it('should leave every object intact', async () => {

        const result = runCli(project, ['db', 'teardown', '--dry-run']);

        expect(result.status).toBe(0);
        expect(await tableExists(project, 'noorm_teardown_dryrun')).toBe(true);

    });

    it('should list the table it would drop in the JSON payload, marked dryRun: true', async () => {

        const result = runCli(project, ['db', 'teardown', '--dry-run', '--json']);
        const jsonStr = extractJsonObject(result.stdout);

        expect(jsonStr).not.toBeNull();

        const parsed: TeardownJson = JSON.parse(jsonStr!);

        expect(parsed.dryRun).toBe(true);
        expect(parsed.dropped.tables).toContain('noorm_teardown_dryrun');
        expect(await tableExists(project, 'noorm_teardown_dryrun')).toBe(true);

    });

    it('should say so in human output', async () => {

        const result = runCli(project, ['db', 'teardown', '--dry-run']);
        const out = (result.stdout + result.stderr).toLowerCase();

        // The "would drop" verb alone conveys dry-run-ness — a separate
        // "Dry run: no objects will be dropped" line was redundant with it
        // and has been removed (v1/49-54 finding 3).
        expect(out).toContain('would drop');
        expect(out).not.toContain('dry run:');

    });

    it('should actually drop the table on a sibling non-dry-run teardown', async () => {

        // --yes is required now that `db:teardown` is a confirm cell for
        // admin; the dry runs above deliberately need no such confirmation.
        const result = runCli(project, ['db', 'teardown', '--yes']);

        expect(result.status).toBe(0);
        expect(await tableExists(project, 'noorm_teardown_dryrun')).toBe(false);

    });

});
