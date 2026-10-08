// A skipped file must leave no tracking row and cost no per-file query
// (docs/spec/prefetch-run-gate.md).
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, SqliteDialect, sql } from 'kysely';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { runBuild, runFile, runFiles, checkFilesStatus } from '../../../src/core/runner/runner.js';
import { observer } from '../../../src/core/observer.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { RunContext } from '../../../src/core/runner/types.js';

describe('runner: prefetch run gate', () => {

    let db: Kysely<NoormDatabase>;
    let tempDir: string;
    let sqlDir: string;
    let queries: string[];

    function context(): RunContext {

        return {
            db,
            configName: 'test',
            identity: { name: 'Test User', email: 'test@example.com', source: 'config' },
            projectRoot: tempDir,
            access: { user: 'admin', agent: 'admin' },
            channel: 'user',
            dialect: 'sqlite',
        };

    }

    async function rowCounts(): Promise<{ operations: number; executions: number }> {

        const ops = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM __noorm_change__`.execute(db);
        const execs = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM __noorm_executions__`.execute(db);

        return { operations: Number(ops.rows[0]!.n), executions: Number(execs.rows[0]!.n) };

    }

    async function executionRows(): Promise<Array<{ filepath: string; status: string }>> {

        const { rows } = await sql<{ filepath: string; status: string }>`
            SELECT filepath, status FROM __noorm_executions__ ORDER BY id
        `.execute(db);

        return rows;

    }

    function executionSelects(): number {

        return queries.filter((q) => /^\s*select/i.test(q) && q.includes('__noorm_executions__')).length;

    }

    async function writeTables(dir: string, count: number, prefix: string): Promise<string[]> {

        await mkdir(dir, { recursive: true });

        const paths: string[] = [];

        for (let i = 0; i < count; i++) {

            const filepath = join(dir, `${String(i).padStart(3, '0')}_t.sql`);
            await writeFile(filepath, `CREATE TABLE ${prefix}_${i} (id INTEGER PRIMARY KEY);\n`, 'utf-8');
            paths.push(filepath);

        }

        return paths;

    }

    beforeEach(async () => {

        queries = [];
        tempDir = await mkdtemp(join(tmpdir(), 'noorm-prefetch-gate-'));
        sqlDir = join(tempDir, 'sql');
        await mkdir(sqlDir, { recursive: true });

        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new BunSqliteDatabase(':memory:') as never,
            }),
            log: (event) => {

                if (event.level === 'query') queries.push(event.query.sql);

            },
        });

        await v1.up(db as Kysely<unknown>, 'sqlite');

    });

    afterEach(async () => {

        await db.destroy();
        await rm(tempDir, { recursive: true, force: true });

    });

    it('should write no tracking rows and no operation when every file is unchanged', async () => {

        await writeTables(sqlDir, 3, 'unchanged');
        await runBuild(context(), sqlDir);

        const before = await rowCounts();
        const skipped: string[] = [];
        const off = observer.on('file:skip', (data) => skipped.push(data.filepath));

        const second = await runBuild(context(), sqlDir);

        off();

        expect(second.status).toBe('success');
        expect(second.files.map((f) => f.status)).toEqual(['skipped', 'skipped', 'skipped']);
        expect(second.changeId).toBeUndefined();
        expect(skipped).toHaveLength(3);
        expect(await rowCounts()).toEqual(before);

    });

    it('should report success and write nothing when a cancelled run has only unchanged files', async () => {

        await writeTables(sqlDir, 2, 'cancelled_unchanged');
        await runBuild(context(), sqlDir);

        const before = await rowCounts();
        const controller = new AbortController();
        controller.abort();

        const second = await runBuild({ ...context(), signal: controller.signal }, sqlDir);

        expect(second.status).toBe('success');
        expect(second.files.map((f) => f.status)).toEqual(['skipped', 'skipped']);
        expect(await rowCounts()).toEqual(before);

    });

    it('should write no operation for an empty file list', async () => {

        const before = await rowCounts();
        const result = await runFiles(context(), []);

        expect(result.status).toBe('success');
        expect(result.changeId).toBeUndefined();
        expect(await rowCounts()).toEqual(before);

    });

    it('should record only the changed file in a mixed build', async () => {

        const [first] = await writeTables(sqlDir, 3, 'mixed');
        await runBuild(context(), sqlDir);

        await writeFile(first!, 'CREATE TABLE mixed_0b (id INTEGER PRIMARY KEY);\n', 'utf-8');

        const before = await rowCounts();
        const second = await runBuild(context(), sqlDir);

        expect(second.files.map((f) => f.status)).toEqual(['success', 'skipped', 'skipped']);
        expect(second.changeId).toBeDefined();
        expect(await rowCounts()).toEqual({
            operations: before.operations + 1,
            executions: before.executions + 1,
        });

        const rows = await executionRows();

        expect(rows.at(-1)).toEqual({ filepath: 'sql/000_t.sql', status: 'success' });

    });

    it('should rerun a previously failed file whose content did not change', async () => {

        await writeFile(join(sqlDir, '001_ok.sql'), 'CREATE TABLE ok_t (id INTEGER PRIMARY KEY);\n', 'utf-8');
        await writeFile(join(sqlDir, '002_needs.sql'), 'INSERT INTO later_t (id) VALUES (1);\n', 'utf-8');

        const first = await runBuild(context(), sqlDir);

        expect(first.files.map((f) => f.status)).toEqual(['success', 'failed']);

        await sql`CREATE TABLE later_t (id INTEGER PRIMARY KEY)`.execute(db);

        const second = await runBuild(context(), sqlDir);

        expect(second.files.map((f) => f.status)).toEqual(['skipped', 'success']);

    });

    it('should rerun an unchanged file whose parent operation went stale', async () => {

        await writeTables(sqlDir, 2, 'stale');
        const first = await runBuild(context(), sqlDir);

        await sql`UPDATE __noorm_change__ SET status = 'stale' WHERE id = ${first.changeId}`.execute(db);
        await sql`DROP TABLE stale_0`.execute(db);
        await sql`DROP TABLE stale_1`.execute(db);

        const second = await runBuild(context(), sqlDir);

        expect(second.files.map((f) => f.status)).toEqual(['success', 'success']);

    });

    it('should fail a file that cannot render at its turn and cascade-skip the files after it', async () => {

        await writeFile(join(sqlDir, '001_ok.sql'), 'CREATE TABLE load_ok (id INTEGER PRIMARY KEY);\n', 'utf-8');
        await writeFile(join(sqlDir, '002_bad.sql.tmpl'), "SELECT '{%~ $.secrets.MISSING_KEY %}';\n", 'utf-8');
        await writeFile(join(sqlDir, '003_later.sql'), 'CREATE TABLE load_later (id INTEGER PRIMARY KEY);\n', 'utf-8');

        const result = await runBuild(context(), sqlDir);

        expect(result.files.map((f) => f.status)).toEqual(['success', 'failed']);
        expect(result.files[1]!.error).toContain('MISSING_KEY');
        expect((await rowCounts()).operations).toBe(1);
        expect(await executionRows()).toEqual([
            { filepath: 'sql/001_ok.sql', status: 'success' },
            { filepath: 'sql/002_bad.sql.tmpl', status: 'failed' },
            { filepath: 'sql/003_later.sql', status: 'skipped' },
        ]);

    });

    it('should not add executions SELECTs going from 3 files to 30', async () => {

        async function selectsForMixedRebuild(dir: string, count: number): Promise<number> {

            const [first] = await writeTables(dir, count, `q${count}`);
            await runBuild(context(), dir);
            await writeFile(first!, `CREATE TABLE q${count}_0b (id INTEGER PRIMARY KEY);\n`, 'utf-8');

            queries = [];
            await runBuild(context(), dir);

            return executionSelects();

        }

        const small = await selectsForMixedRebuild(join(tempDir, 'sql3'), 3);
        const large = await selectsForMixedRebuild(join(tempDir, 'sql30'), 30);

        expect(large).toBe(small);

    });

    it('should write nothing when runFile is given an unchanged file', async () => {

        const [filepath] = await writeTables(sqlDir, 1, 'single');

        expect((await runFile(context(), filepath!)).status).toBe('success');

        const before = await rowCounts();
        const second = await runFile(context(), filepath!);

        expect(second.status).toBe('skipped');
        expect(second.skipReason).toBe('unchanged');
        expect(await rowCounts()).toEqual(before);

    });

    it('should write one operation and one execution when runFile runs a changed file', async () => {

        const [filepath] = await writeTables(sqlDir, 1, 'single_changed');
        await runFile(context(), filepath!);
        await writeFile(filepath!, 'CREATE TABLE single_changed_b (id INTEGER PRIMARY KEY);\n', 'utf-8');

        const before = await rowCounts();
        const second = await runFile(context(), filepath!);

        expect(second.status).toBe('success');
        expect(await rowCounts()).toEqual({
            operations: before.operations + 1,
            executions: before.executions + 1,
        });

    });

    it('should neither execute nor record a file when runFile is given preview', async () => {

        const [filepath] = await writeTables(sqlDir, 1, 'previewed');

        await runFile(context(), filepath!, { preview: true });

        const { rows } = await sql<{ n: number }>`
            SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'previewed_0'
        `.execute(db);

        expect(Number(rows[0]!.n)).toBe(0);
        expect(await rowCounts()).toEqual({ operations: 0, executions: 0 });

    });

    it('should categorize files with a single executions SELECT', async () => {

        const [unchanged, changed] = await writeTables(sqlDir, 2, 'status');
        await runBuild(context(), sqlDir);
        await writeFile(changed!, 'CREATE TABLE status_1b (id INTEGER PRIMARY KEY);\n', 'utf-8');
        const [fresh] = await writeTables(join(tempDir, 'extra'), 1, 'status_new');

        queries = [];
        const status = await checkFilesStatus(context(), [unchanged!, changed!, fresh!]);

        expect(executionSelects()).toBe(1);
        expect(status.previouslyRunFiles).toEqual([unchanged!]);
        expect(status.changedFiles).toEqual([changed!]);
        expect(status.newFiles).toEqual([fresh!]);
        expect(status.wouldSkipCount).toBe(1);

    });

});
