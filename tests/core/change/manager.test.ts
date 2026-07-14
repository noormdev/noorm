/**
 * Change manager tests.
 *
 * Pins `ChangeManager`'s public API directly against a real in-memory
 * SQLite database, matching `tests/core/change/executor.test.ts`'s harness
 * pattern. Covers revert, rewind, next, and remove — the highest-risk
 * batch/mutation surface per QL-test-04's "at minimum" framing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';

import { ChangeManager } from '../../../src/core/change/manager.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import { resetLockManager } from '../../../src/core/lock/index.js';
import { ChangeNotAppliedError } from '../../../src/core/change/types.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { ChangeContext } from '../../../src/core/change/types.js';

describe('change: manager', () => {

    let db: Kysely<NoormDatabase>;
    let tempDir: string;
    let changesDir: string;
    let sqlDir: string;

    const testIdentity = { name: 'Test User', email: 'test@example.com', source: 'config' as const };

    /**
     * Create a test change on disk with both change/ and revert/ folders,
     * so `manager.run`/`manager.revert` can load it by name via parseChange.
     */
    async function createTestChange(
        name: string,
        changeFiles: Array<{ name: string; content: string }>,
        revertFiles: Array<{ name: string; content: string }> = [],
    ): Promise<void> {

        const changePath = join(changesDir, name);
        const changeFilesDir = join(changePath, 'change');
        const revertFilesDir = join(changePath, 'revert');

        await mkdir(changeFilesDir, { recursive: true });
        await mkdir(revertFilesDir, { recursive: true });

        for (const file of changeFiles) {

            await writeFile(join(changeFilesDir, file.name), file.content);

        }

        for (const file of revertFiles) {

            await writeFile(join(revertFilesDir, file.name), file.content);

        }

    }

    /**
     * Build a test context.
     */
    function buildContext(): ChangeContext {

        return {
            db,
            configName: 'test',
            identity: testIdentity,
            projectRoot: tempDir,
            changesDir,
            sqlDir,
            access: { user: 'admin', mcp: 'admin' },
            channel: 'user',
            dialect: 'sqlite',
        };

    }

    beforeEach(async () => {

        resetLockManager();

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-manager-test-'));
        changesDir = join(tempDir, 'changes');
        sqlDir = join(tempDir, 'sql');

        await mkdir(changesDir, { recursive: true });
        await mkdir(sqlDir, { recursive: true });

        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new BunSqliteDatabase(':memory:') as never,
            }),
        });

        await v1.up(db as Kysely<unknown>, 'sqlite');

    });

    afterEach(async () => {

        resetLockManager();

        await db.destroy();

        await rm(tempDir, { recursive: true, force: true });

    });

    describe('revert', () => {

        it('should execute the revert SQL against the DB and flip history to reverted', async () => {

            await createTestChange(
                'revert-drops-table',
                [{ name: '001_create.sql', content: 'CREATE TABLE revert_target (id INTEGER PRIMARY KEY)' }],
                [{ name: '001_drop.sql', content: 'DROP TABLE revert_target' }],
            );

            const manager = new ChangeManager(buildContext());

            const runResult = await manager.run('revert-drops-table');
            expect(runResult.status).toBe('success');

            const revertResult = await manager.revert('revert-drops-table');

            expect(revertResult.status).toBe('success');
            expect(revertResult.files.length).toBeGreaterThan(0);

            // The revert SQL actually ran, not just recorded as successful.
            const tableRows = await sql<{ name: string }>`
                SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'revert_target'
            `.execute(db);

            expect(tableRows.rows).toHaveLength(0);

            const history = await manager.getHistory('revert-drops-table');
            const changeRecord = history.find((h) => h.direction === 'change');
            const revertRecord = history.find((h) => h.direction === 'revert');

            expect(changeRecord?.status).toBe('reverted');
            expect(revertRecord?.status).toBe('success');

        });

        it('should skip (not error) when reverting an already-reverted change', async () => {

            await createTestChange(
                'double-revert',
                [{ name: '001_create.sql', content: 'CREATE TABLE double_revert_target (id INTEGER PRIMARY KEY)' }],
                [{ name: '001_drop.sql', content: 'DROP TABLE double_revert_target' }],
            );

            const manager = new ChangeManager(buildContext());

            await manager.run('double-revert');

            const first = await manager.revert('double-revert');
            expect(first.status).toBe('success');

            const second = await manager.revert('double-revert');

            expect(second).toMatchObject({ status: 'success', files: [] });

        });

        it('should throw ChangeNotAppliedError when reverting a change that was never applied', async () => {

            await createTestChange(
                'never-applied',
                [{ name: '001_create.sql', content: 'CREATE TABLE never_applied_target (id INTEGER PRIMARY KEY)' }],
                [{ name: '001_drop.sql', content: 'DROP TABLE never_applied_target' }],
            );

            const manager = new ChangeManager(buildContext());

            await expect(manager.revert('never-applied')).rejects.toThrow(ChangeNotAppliedError);

        });

    });

    describe('rewind', () => {

        it('should revert the single applied change with rewind(1)', async () => {

            await createTestChange(
                'rewind-one',
                [{ name: '001_create.sql', content: 'CREATE TABLE rewind_one_target (id INTEGER PRIMARY KEY)' }],
                [{ name: '001_drop.sql', content: 'DROP TABLE rewind_one_target' }],
            );

            const manager = new ChangeManager(buildContext());
            await manager.run('rewind-one');

            const result = await manager.rewind(1);

            expect(result.status).toBe('success');
            expect(result.executed).toBe(1);

        });

        it('should revert the single applied change with rewind(name)', async () => {

            await createTestChange(
                'rewind-by-name',
                [{ name: '001_create.sql', content: 'CREATE TABLE rewind_name_target (id INTEGER PRIMARY KEY)' }],
                [{ name: '001_drop.sql', content: 'DROP TABLE rewind_name_target' }],
            );

            const manager = new ChangeManager(buildContext());
            await manager.run('rewind-by-name');

            const result = await manager.rewind('rewind-by-name');

            expect(result.status).toBe('success');
            expect(result.executed).toBe(1);

        });

        it('should return the not-found failure when rewind(name) matches no applied change', async () => {

            await createTestChange('applied-change', [
                { name: '001.sql', content: 'CREATE TABLE not_found_target (id INTEGER PRIMARY KEY)' },
            ]);

            const manager = new ChangeManager(buildContext());
            await manager.run('applied-change');

            const result = await manager.rewind('does-not-exist');

            expect(result).toMatchObject({ status: 'failed', failed: 1, changes: [] });

        });

        it('should be a no-op when there are 0 applied changes', async () => {

            const manager = new ChangeManager(buildContext());

            const result = await manager.rewind(1);

            expect(result).toMatchObject({ status: 'success', executed: 0, changes: [] });

        });

        it('should revert until and including the older of two applied changes with rewind(name)', async () => {

            await createTestChange(
                '2025-01-01-first',
                [{ name: '001.sql', content: 'CREATE TABLE rewind_older_first (id INTEGER PRIMARY KEY)' }],
                [{ name: '001.sql', content: 'DROP TABLE rewind_older_first' }],
            );
            await createTestChange(
                '2025-01-02-second',
                [{ name: '001.sql', content: 'CREATE TABLE rewind_older_second (id INTEGER PRIMARY KEY)' }],
                [{ name: '001.sql', content: 'DROP TABLE rewind_older_second' }],
            );

            const manager = new ChangeManager(buildContext());

            await manager.run('2025-01-01-first');
            await manager.run('2025-01-02-second');

            const result = await manager.rewind('2025-01-01-first');

            expect(result.status).toBe('success');
            expect(result.executed).toBe(2);

            const list = await manager.list();
            const byName = new Map(list.map((cs) => [cs.name, cs.status]));

            expect(byName.get('2025-01-01-first')).toBe('reverted');
            expect(byName.get('2025-01-02-second')).toBe('reverted');

        });

        // Two changes applied back-to-back land the same second-precision
        // `executed_at` (SQLite CURRENT_TIMESTAMP default) — a routine tie,
        // not an edge case (e.g. `change ff` applying several pending changes
        // in one process tick). Only the history table's autoincrement id
        // records true apply order, so rewind's sort must break ties on it
        // descending (highest id = most recently applied = reverted first).
        // Applying in name order makes list()'s name-sorted array equal the
        // chronological apply order forward, while the correct revert order
        // is that array reversed -- exactly what a missing tiebreak gets
        // wrong (stable sort keeps forward/name order on a tie).
        it('should revert tied appliedAt changes in id-descending apply order with rewind(2)', async () => {

            await createTestChange(
                '2025-02-01-first',
                [{ name: '001.sql', content: 'CREATE TABLE rewind_tie_first (id INTEGER PRIMARY KEY)' }],
                [{ name: '001.sql', content: 'DROP TABLE rewind_tie_first' }],
            );
            await createTestChange(
                '2025-02-02-second',
                [{ name: '001.sql', content: 'CREATE TABLE rewind_tie_second (id INTEGER PRIMARY KEY)' }],
                [{ name: '001.sql', content: 'DROP TABLE rewind_tie_second' }],
            );

            const manager = new ChangeManager(buildContext());

            await manager.run('2025-02-01-first');
            await manager.run('2025-02-02-second');

            const result = await manager.rewind(2);

            expect(result.status).toBe('success');
            expect(result.executed).toBe(2);
            expect(result.changes[0].name).toBe('2025-02-02-second');
            expect(result.changes[1].name).toBe('2025-02-01-first');

        });

    });

    describe('next', () => {

        it('should apply exactly `count` pending changes in order, leaving the rest pending', async () => {

            await createTestChange('2025-01-01-first', [
                { name: '001.sql', content: 'CREATE TABLE next_first (id INTEGER PRIMARY KEY)' },
            ]);
            await createTestChange('2025-01-02-second', [
                { name: '001.sql', content: 'CREATE TABLE next_second (id INTEGER PRIMARY KEY)' },
            ]);
            await createTestChange('2025-01-03-third', [
                { name: '001.sql', content: 'CREATE TABLE next_third (id INTEGER PRIMARY KEY)' },
            ]);

            const manager = new ChangeManager(buildContext());

            const result = await manager.next(2);

            expect(result.status).toBe('success');
            expect(result.executed).toBe(2);

            const list = await manager.list();
            const byName = new Map(list.map((cs) => [cs.name, cs.status]));

            expect(byName.get('2025-01-01-first')).toBe('success');
            expect(byName.get('2025-01-02-second')).toBe('success');
            expect(byName.get('2025-01-03-third')).toBe('pending');

        });

    });

    describe('remove', () => {

        it('should delete both disk and db records when remove({disk: true, db: true})', async () => {

            await createTestChange('remove-both', [
                { name: '001.sql', content: 'CREATE TABLE remove_both_target (id INTEGER PRIMARY KEY)' },
            ]);

            const manager = new ChangeManager(buildContext());
            await manager.run('remove-both');

            await manager.remove('remove-both', { disk: true, db: true });

            expect(existsSync(join(changesDir, 'remove-both'))).toBe(false);
            expect(await manager.getHistory('remove-both')).toEqual([]);

        });

        it('should delete only db records when remove({db: true}), leaving disk untouched', async () => {

            await createTestChange('remove-db-only', [
                { name: '001.sql', content: 'CREATE TABLE remove_db_only_target (id INTEGER PRIMARY KEY)' },
            ]);

            const manager = new ChangeManager(buildContext());
            await manager.run('remove-db-only');

            await manager.remove('remove-db-only', { db: true });

            expect(existsSync(join(changesDir, 'remove-db-only'))).toBe(true);
            expect(await manager.getHistory('remove-db-only')).toEqual([]);

        });

    });

});
