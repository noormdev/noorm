// A skipped change file must leave no execution row and cost no per-file
// query (docs/spec/prefetch-run-gate.md).
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, SqliteDialect, sql } from 'kysely';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { executeChange, revertChange } from '../../../src/core/change/executor.js';
import { decideNeedsRunFile } from '../../../src/core/change/history.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import { resetLockManager } from '../../../src/core/lock/index.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { Change, ChangeContext, ChangeFile, FileExecutionRecord } from '../../../src/core/change/types.js';

describe('change: decideNeedsRunFile', () => {

    const success: FileExecutionRecord = { checksum: 'abc', exec_status: 'success' };

    it('should run with reason force when forced, whatever the history', () => {

        expect(decideNeedsRunFile(success, 'abc', true)).toEqual({ needsRun: true, reason: 'force' });

    });

    it('should run with reason new when the lookup failed', () => {

        expect(decideNeedsRunFile(new Error('boom'), 'abc', false)).toEqual({ needsRun: true, reason: 'new' });

    });

    it('should run with reason new when the file never ran', () => {

        expect(decideNeedsRunFile(undefined, 'abc', false)).toEqual({ needsRun: true, reason: 'new' });

    });

    it('should retry a file whose last attempt failed, even with a matching checksum', () => {

        const failed: FileExecutionRecord = { checksum: 'abc', exec_status: 'failed' };

        expect(decideNeedsRunFile(failed, 'abc', false)).toEqual({
            needsRun: true,
            reason: 'failed',
            previousChecksum: 'abc',
        });

    });

    it('should run a file whose checksum changed since its last success', () => {

        expect(decideNeedsRunFile(success, 'def', false)).toEqual({
            needsRun: true,
            reason: 'changed',
            previousChecksum: 'abc',
        });

    });

    it('should skip a file whose last success has a matching checksum', () => {

        expect(decideNeedsRunFile(success, 'abc', false)).toEqual({
            needsRun: false,
            skipReason: 'already applied',
            previousChecksum: 'abc',
        });

    });

});

describe('change: prefetch run gate', () => {

    let db: Kysely<NoormDatabase>;
    let tempDir: string;
    let changesDir: string;
    let queries: string[];

    function context(): ChangeContext {

        return {
            db,
            configName: 'test',
            identity: { name: 'Test User', email: 'test@example.com', source: 'config' },
            projectRoot: tempDir,
            changesDir,
            sqlDir: join(tempDir, 'sql'),
            access: { user: 'admin', agent: 'admin' },
            channel: 'user',
            dialect: 'sqlite',
        };

    }

    async function writeFiles(
        dir: string,
        files: Array<{ name: string; content: string }>,
    ): Promise<ChangeFile[]> {

        await mkdir(dir, { recursive: true });

        const written: ChangeFile[] = [];

        for (const file of files) {

            const filepath = join(dir, file.name);
            await writeFile(filepath, file.content, 'utf-8');
            written.push({ filename: file.name, path: filepath, type: 'sql' });

        }

        return written;

    }

    async function createChange(
        name: string,
        files: Array<{ name: string; content: string }>,
        revert: Array<{ name: string; content: string }> = [],
    ): Promise<Change> {

        const changePath = join(changesDir, name);

        return {
            name,
            path: changePath,
            date: null,
            description: name,
            changeFiles: await writeFiles(join(changePath, 'change'), files),
            revertFiles: await writeFiles(join(changePath, 'revert'), revert),
            hasChangelog: false,
        };

    }

    function tables(prefix: string, count: number): Array<{ name: string; content: string }> {

        return Array.from({ length: count }, (_, i) => ({
            name: `${String(i).padStart(3, '0')}_t.sql`,
            content: `CREATE TABLE ${prefix}_${i} (id INTEGER PRIMARY KEY)`,
        }));

    }

    async function executionRows(operationId: number): Promise<Array<{ filepath: string; status: string }>> {

        const { rows } = await sql<{ filepath: string; status: string }>`
            SELECT filepath, status FROM __noorm_executions__ WHERE change_id = ${operationId} ORDER BY id
        `.execute(db);

        return rows;

    }

    async function operationStatus(operationId: number): Promise<string | undefined> {

        const { rows } = await sql<{ status: string }>`
            SELECT status FROM __noorm_change__ WHERE id = ${operationId}
        `.execute(db);

        return rows[0]?.status;

    }

    function executionSelects(): number {

        return queries.filter((q) => /^\s*select/i.test(q) && q.includes('__noorm_executions__')).length;

    }

    beforeEach(async () => {

        resetLockManager();

        queries = [];
        tempDir = await mkdtemp(join(tmpdir(), 'noorm-change-prefetch-gate-'));
        changesDir = join(tempDir, 'changes');

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

        resetLockManager();
        await db.destroy();
        await rm(tempDir, { recursive: true, force: true });

    });

    it('should write an execution row only for the file that changed on re-apply', async () => {

        const change = await createChange('reapply-one', [
            { name: '001_a.sql', content: 'CREATE TABLE reapply_a (id INTEGER PRIMARY KEY)' },
            { name: '002_b.sql', content: 'CREATE TABLE reapply_b (id INTEGER PRIMARY KEY)' },
            { name: '003_c.sql', content: 'CREATE TABLE reapply_c (id INTEGER PRIMARY KEY)' },
        ]);

        await executeChange(context(), change);
        await writeFile(change.changeFiles[1]!.path, 'CREATE TABLE IF NOT EXISTS reapply_b (id INTEGER PRIMARY KEY)');

        const second = await executeChange(context(), change);

        expect(second.status).toBe('success');
        expect(second.files.map((f) => f.status)).toEqual(['skipped', 'success', 'skipped']);
        expect(await executionRows(second.operationId!)).toEqual([
            { filepath: 'changes/reapply-one/change/002_b.sql', status: 'success' },
        ]);

    });

    it('should record the operation but no execution rows when every file skips', async () => {

        const change = await createChange('all-skip', [
            { name: '001_a.sql', content: 'CREATE TABLE all_skip_a (id INTEGER PRIMARY KEY)' },
            { name: '002_b.sql', content: 'CREATE TABLE all_skip_b (id INTEGER PRIMARY KEY)' },
        ]);

        await executeChange(context(), change);

        // Adding a file then dropping it from the change changes the change checksum twice, so the
        // change-level check lets the third apply through while A and B are unchanged.
        const [extra] = await writeFiles(join(change.path, 'change'), [
            { name: '003_c.sql', content: 'CREATE TABLE all_skip_c (id INTEGER PRIMARY KEY)' },
        ]);

        await executeChange(context(), { ...change, changeFiles: [...change.changeFiles, extra!] });

        const third = await executeChange(context(), change);

        expect(third.status).toBe('success');
        expect(third.files.map((f) => f.status)).toEqual(['skipped', 'skipped']);
        expect(third.operationId).toBeDefined();
        expect(await operationStatus(third.operationId!)).toBe('success');
        expect(await executionRows(third.operationId!)).toEqual([]);

    });

    it('should not add execution-history SELECTs as a change grows from 3 files to 30', async () => {

        const small = await createChange('three-files', tables('small', 3));
        const large = await createChange('thirty-files', tables('large', 30));

        queries = [];
        await executeChange(context(), small);
        const smallSelects = executionSelects();

        queries = [];
        await executeChange(context(), large);
        const largeSelects = executionSelects();

        expect(largeSelects).toBe(smallSelects);

    });

    it('should run a file listed by two manifests once in the same apply', async () => {

        const sqlDir = join(tempDir, 'sql');
        await mkdir(sqlDir, { recursive: true });
        await writeFile(join(sqlDir, 'dup.sql'), 'CREATE TABLE dup_t (id INTEGER PRIMARY KEY)');

        const changePath = join(changesDir, 'dup-manifest');
        const manifests = await writeFiles(join(changePath, 'change'), [
            { name: '001_first.txt', content: 'dup.sql' },
            { name: '002_second.txt', content: 'dup.sql' },
        ]);

        const result = await executeChange(context(), {
            name: 'dup-manifest',
            path: changePath,
            date: null,
            description: 'dup-manifest',
            changeFiles: manifests.map((m) => ({ ...m, type: 'txt' })),
            revertFiles: [],
            hasChangelog: false,
        });

        expect(result.status).toBe('success');
        expect(result.files.map((f) => [f.status, f.skipReason])).toEqual([
            ['success', undefined],
            ['skipped', 'already applied'],
        ]);
        expect(await executionRows(result.operationId!)).toEqual([
            { filepath: 'sql/dup.sql', status: 'success' },
        ]);

    });

    it('should re-run every file on apply after a revert', async () => {

        const change = await createChange(
            'apply-revert-apply',
            tables('cycle', 2),
            [
                { name: '001_drop.sql', content: 'DROP TABLE cycle_0' },
                { name: '002_drop.sql', content: 'DROP TABLE cycle_1' },
            ],
        );

        const applied = await executeChange(context(), change);
        const reverted = await revertChange(context(), change);
        const reapplied = await executeChange(context(), change);

        expect(applied.files.map((f) => f.status)).toEqual(['success', 'success']);
        expect(reverted.files.map((f) => f.status)).toEqual(['success', 'success']);
        expect(reapplied.status).toBe('success');
        expect(reapplied.files.map((f) => f.status)).toEqual(['success', 'success']);
        expect((await executionRows(reapplied.operationId!)).map((r) => r.status)).toEqual(['success', 'success']);

    });

});
