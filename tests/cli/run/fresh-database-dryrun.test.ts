/** A dry run must leave a database noorm has never touched without tracking tables. */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';

import { createConnection } from '../../../src/core/connection/factory.js';
import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { CURRENT_VERSIONS } from '../../../src/core/version/types.js';
import {
    cleanupProject,
    extractJsonObject,
    runCli,
    setupProject,
    TMP_BASE,
    type TestProject,
} from './_setup.js';

const CHANGE = '2026-01-01-add-gadget';

async function tables(project: TestProject): Promise<string[]> {

    const conn = await createConnection({ dialect: 'sqlite', database: project.dbPath }, '__test__');
    const found = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table'`.execute(conn.db);

    await conn.destroy();

    return found.rows.map((row) => row.name);

}

describe('cli: --dry-run on a database with no tracking tables', () => {

    let project: TestProject;

    beforeAll(async () => {

        await mkdir(TMP_BASE, { recursive: true });

    });

    beforeEach(async () => {

        project = await setupProject();
        // A throwaway HOME, so the CLI never reads the identity of whoever runs the suite.
        project.env = {
            ...project.env,
            HOME: join(project.dir, 'home'),
            NOORM_IDENTITY_PRIVATE_KEY: generateKeyPair().privateKey,
            NOORM_IDENTITY_NAME: 'CI Bot',
            NOORM_IDENTITY_EMAIL: 'ci@example.com',
        };
        await mkdir(project.env['HOME'], { recursive: true });
        // setupProject bootstraps the tracking tables; these tests need a database without them.
        await rm(project.dbPath);

        await writeFile(join(project.dir, 'sql', 'widget.sql'), 'CREATE TABLE widget (id INTEGER PRIMARY KEY);');

        const change = join(project.dir, 'changes', CHANGE);
        await mkdir(join(change, 'change'), { recursive: true });
        await mkdir(join(change, 'revert'), { recursive: true });
        await writeFile(join(change, 'change', '001_gadget.sql'), 'CREATE TABLE gadget (id INTEGER PRIMARY KEY);');
        await writeFile(join(change, 'revert', '001_gadget.sql'), 'DROP TABLE gadget;');

        const pipeline = join(project.dir, 'db', 'pipelines', 'refresh');
        await mkdir(pipeline, { recursive: true });
        await writeFile(join(pipeline, 'pipeline.yml'), JSON.stringify({ steps: [{ id: 'widget', sql: 'widget.sql' }] }));
        await writeFile(join(pipeline, 'widget.sql'), 'CREATE TABLE piped (id INTEGER PRIMARY KEY);');

    });

    afterEach(async () => {

        await cleanupProject(project);

    });

    it('should report the build it would run and create no tables', async () => {

        const result = runCli(project, ['run', 'build', '--dry-run', '--json']);
        const payload = JSON.parse(extractJsonObject(result.stdout) ?? '{}');

        expect(result.status).toBe(0);
        expect(payload).toMatchObject({ success: true, dryRun: true });
        expect(JSON.stringify(payload.files)).toContain('widget.sql');
        expect(await tables(project)).toEqual([]);

    });

    it('should treat every change as pending on change ff and create no tables', async () => {

        const result = runCli(project, ['change', 'ff', '--dry-run', '--json']);
        const payload = JSON.parse(extractJsonObject(result.stdout) ?? '{}');

        expect(result.status).toBe(0);
        expect(payload).toMatchObject({ success: true, dryRun: true });
        expect(payload.changes.map((change: { name: string }) => change.name)).toEqual([CHANGE]);
        expect(await tables(project)).toEqual([]);

    });

    it.each([
        ['run file', ['run', 'file', 'sql/widget.sql']],
        ['run files', ['run', 'files', '--paths', 'sql/widget.sql']],
        ['run dir', ['run', 'dir', 'sql']],
        ['change run', ['change', 'run', CHANGE]],
        ['change next', ['change', 'next']],
        ['change rewind', ['change', 'rewind', '1']],
        ['pipeline run', ['pipeline', 'run', 'refresh']],
        ['db teardown', ['db', 'teardown', '--yes']],
        ['db truncate', ['db', 'truncate', '--yes']],
    ])('should create no tables on %s --dry-run', async (_command, args) => {

        const result = runCli(project, [...args, '--dry-run']);

        expect(result.stdout + result.stderr).not.toContain('no such table');
        expect(result.status).toBe(0);
        expect(await tables(project)).toEqual([]);

    });

    async function builtAtTrackingVersion(version: number): Promise<void> {

        expect(runCli(project, ['run', 'build']).status).toBe(0);

        const conn = await createConnection({ dialect: 'sqlite', database: project.dbPath }, '__test__');
        await sql`UPDATE __noorm_version__ SET noorm_version = ${version}`.execute(conn.db);
        await conn.destroy();

    }

    async function trackingVersions(): Promise<number[]> {

        const conn = await createConnection({ dialect: 'sqlite', database: project.dbPath }, '__test__');
        const versions = await sql<{ noorm_version: number }>`SELECT noorm_version FROM __noorm_version__`.execute(conn.db);
        await conn.destroy();

        return versions.rows.map((row) => row.noorm_version);

    }

    it('should refuse a dry run against a tracking schema newer than this version', async () => {

        await builtAtTrackingVersion(999);

        const result = runCli(project, ['run', 'build', '--dry-run']);

        expect(result.status).not.toBe(0);
        expect(result.stdout + result.stderr).toContain('schema version 999 is newer than CLI supports');

    });

    // Migrating is a write, and reading tables an older version laid out differently fails with raw SQL errors.
    it('should refuse a dry run that would first have to migrate the tracking tables', async () => {

        await builtAtTrackingVersion(1);

        const result = runCli(project, ['db', 'teardown', '--dry-run', '--yes']);

        expect(result.status).not.toBe(0);
        expect(result.stdout + result.stderr).toContain(
            `tracking tables are at schema version 1 and this version needs ${CURRENT_VERSIONS.schema}. `
            + 'A dry run does not migrate them: run a command without --dry-run first, such as "noorm change history".',
        );
        expect(await trackingVersions()).toEqual([1]);

    });

    it('should migrate the tracking tables on the command the dry-run refusal names', async () => {

        await builtAtTrackingVersion(1);

        const result = runCli(project, ['change', 'history']);

        expect(result.status).toBe(0);
        expect(await trackingVersions()).toContain(CURRENT_VERSIONS.schema);
        expect(runCli(project, ['change', 'ff', '--dry-run']).status).toBe(0);

    });

});
