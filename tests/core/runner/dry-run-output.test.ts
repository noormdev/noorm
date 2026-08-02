/**
 * Dry-run output files.
 *
 * `--dry-run` renders templates to `tmp/` — fully resolved, which means any
 * secret the template reads is written to disk in plaintext. The docs
 * recommend the production variant of this command for pre-deploy review,
 * `noorm init` does not gitignore `tmp/`, and the files were written 0644.
 *
 * The destination was also invisible outside human output, so a CI run had
 * no machine-readable way to know a file had been written, let alone where.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, SqliteDialect } from 'kysely';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { runBuild, runFile } from '../../../src/core/runner/runner.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { RunContext } from '../../../src/core/runner/types.js';

describe('runner: dry-run output', () => {

    let db: Kysely<NoormDatabase>;
    let tempDir: string;
    let sqlDir: string;

    function context(): RunContext {

        return {
            db,
            configName: 'test',
            identity: { name: 'Test User', email: 'test@example.com', source: 'config' },
            projectRoot: tempDir,
            access: { user: 'admin', agent: 'admin' },
            channel: 'user',
            dialect: 'sqlite',
            secrets: { API_TOKEN: 'sk-live-not-a-real-token' },
        };

    }

    beforeEach(async () => {

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-dryrun-'));
        sqlDir = join(tempDir, 'sql');
        await mkdir(sqlDir, { recursive: true });

        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new BunSqliteDatabase(':memory:') as never,
            }),
        });

        await v1.up(db as Kysely<unknown>, 'sqlite');

        await writeFile(
            join(sqlDir, '001_secret.sql.tmpl'),
            'INSERT INTO t (token) VALUES ({%~ $.quote($.secrets.API_TOKEN) %});',
            'utf-8',
        );

    });

    afterEach(async () => {

        await db.destroy();
        await rm(tempDir, { recursive: true, force: true });

    });

    it('should write rendered output owner-readable only', async () => {

        const result = await runBuild(context(), sqlDir, { dryRun: true });

        expect(result.status).toBe('success');

        const outputPath = join(tempDir, 'tmp', 'sql', '001_secret.sql');
        const fileStats = await stat(outputPath);
        const dirStats = await stat(join(tempDir, 'tmp'));

        // The file holds a resolved secret in plaintext; group and other
        // have no business reading it, nor listing the directory it sits in.
        expect(fileStats.mode & 0o777).toBe(0o600);
        expect(dirStats.mode & 0o077).toBe(0);

    });

    it('should report where each file was written', async () => {

        const result = await runBuild(context(), sqlDir, { dryRun: true });

        // Without this a `--json` consumer cannot tell that plaintext was
        // written at all, let alone clean it up afterwards.
        expect(result.files[0]?.outputPath).toBe(join(tempDir, 'tmp', 'sql', '001_secret.sql'));

    });

    it('should not execute the statement when runFile is given dryRun', async () => {

        const filepath = join(sqlDir, '002_canary.sql');

        await writeFile(filepath, 'CREATE TABLE dry_run_canary (id integer);', 'utf-8');

        const result = await runFile(context(), filepath, { dryRun: true });

        expect(result.status).toBe('success');

        // The entire contract of --dry-run. `run build`/`run dir` honour it;
        // `run file` accepted the flag and executed anyway, so a destructive
        // file reviewed with --dry-run ran against the database.
        const tables = await db.introspection.getTables();

        expect(tables.map((t) => t.name)).not.toContain('dry_run_canary');

    });

    it('should write no tracking rows when runFile is given dryRun', async () => {

        const filepath = join(sqlDir, '003_canary.sql');

        await writeFile(filepath, 'CREATE TABLE tracked_canary (id integer);', 'utf-8');

        await runFile(context(), filepath, { dryRun: true });

        // executeFiles returns before it creates an operation; runFile must
        // match, or a dry run leaves history claiming the file was applied.
        const operations = await db.selectFrom('__noorm_change__').selectAll().execute();

        expect(operations).toHaveLength(0);

    });

});
