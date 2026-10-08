/**
 * Runner tracker tests.
 *
 * Uses a real in-memory SQLite database, not a mock -- `decideNeedsRun`
 * decides from whichever row `latestExecutions` picks as newest, which a mock
 * can't reproduce.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';

import { Tracker, decideNeedsRun } from '../../../src/core/runner/tracker.js';
import { observer } from '../../../src/core/observer.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { CreateOperationData, NeedsRunResult } from '../../../src/core/runner/types.js';

describe('runner: tracker', () => {

    let db: Kysely<NoormDatabase>;
    let tracker: Tracker;
    let queries: string[];

    const baseOp: Omit<CreateOperationData, 'name'> = {
        changeType: 'build',
        configName: 'test',
        executedBy: 'test@example.com',
    };

    beforeEach(async () => {

        queries = [];

        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new BunSqliteDatabase(':memory:') as never,
            }),
            log: (event) => {

                if (event.level === 'query') queries.push(event.query.sql);

            },
        });

        await v1.up(db as Kysely<unknown>, 'sqlite');

        tracker = new Tracker(db, 'test', 'sqlite');

    });

    afterEach(async () => {

        await db.destroy();

    });

    const decide = async (filepath: string, checksum: string, force: boolean): Promise<NeedsRunResult> => {

        const [latest, err] = await tracker.latestExecutions();

        return decideNeedsRun(err ?? latest.get(filepath), checksum, force);

    };

    describe('latestExecutions + decideNeedsRun — skipped means two different things', () => {

        const filepath = 'sql/001.sql';

        /**
         * Seeds the history an older build left: build 1 executes the file,
         * build 2 skips it and records an `unchanged` skip row. Current builds
         * write no row for a skip, but these rows remain in existing databases.
         */
        const seedSuccessThenUnchangedSkip = async (checksum: string) => {

            const firstOpId = await tracker.createOperation({ ...baseOp, name: 'build:1' });
            await tracker.createFileRecords(firstOpId, [
                { filepath, fileType: 'sql', checksum },
            ]);
            await tracker.updateFileExecution(firstOpId, filepath, 'success', 10);

            const secondOpId = await tracker.createOperation({ ...baseOp, name: 'build:2' });
            await tracker.createFileRecords(secondOpId, [
                { filepath, fileType: 'sql', checksum },
            ]);
            await tracker.updateFileExecution(secondOpId, filepath, 'skipped', 0, undefined, 'unchanged');

            return { firstOpId, secondOpId };

        };

        it('should not re-run a file whose newest record is an unchanged skip', async () => {

            await seedSuccessThenUnchangedSkip('abc123');

            // Reading build 2's skip as 'new' re-executes the file on every
            // third build -- fatal for any DDL that isn't idempotent.
            const result = await decide(filepath, 'abc123', false);

            expect(result).toEqual({
                needsRun: false,
                skipReason: 'unchanged',
                previousChecksum: 'abc123',
            });

        });

        it('should re-run a file skipped because an earlier file in the batch failed', async () => {

            const opId = await tracker.createOperation({ ...baseOp, name: 'build:aborted' });
            await tracker.createFileRecords(opId, [
                { filepath, fileType: 'sql', checksum: 'abc123' },
            ]);

            // The batch stopped before reaching this file, so its pending
            // row becomes a skip carrying a cascade reason. Unlike an
            // 'unchanged' skip, nothing ever ran -- the file still owes a run.
            await tracker.skipRemainingFiles(opId, 'Skipped: failure in 000_first.sql');

            const result = await decide(filepath, 'abc123', false);

            expect(result).toEqual({ needsRun: true, reason: 'new' });

        });

        it('should re-run a file whose only record is a pending placeholder', async () => {

            const opId = await tracker.createOperation({ ...baseOp, name: 'build:crashed' });
            await tracker.createFileRecords(opId, [
                { filepath, fileType: 'sql', checksum: 'abc123' },
            ]);

            const result = await decide(filepath, 'abc123', false);

            expect(result).toEqual({ needsRun: true, reason: 'new' });

        });

        it('should re-run when the file changed after an unchanged skip was recorded', async () => {

            await seedSuccessThenUnchangedSkip('abc123');

            // Proves the unchanged skip falls through to the checksum
            // comparison rather than short-circuiting into a blanket skip.
            const result = await decide(filepath, 'def456', false);

            expect(result).toEqual({
                needsRun: true,
                reason: 'changed',
                previousChecksum: 'abc123',
            });

        });

        it('should re-run when the change behind an unchanged skip went stale', async () => {

            const { secondOpId } = await seedSuccessThenUnchangedSkip('abc123');

            // A teardown marks the operation stale: its objects are gone, so
            // the recorded skip no longer implies the database is current.
            await db
                .updateTable('__noorm_change__')
                .set({ status: 'stale' })
                .where('id', '=', secondOpId)
                .execute();

            const result = await decide(filepath, 'abc123', false);

            expect(result).toEqual({
                needsRun: true,
                reason: 'stale',
                previousChecksum: 'abc123',
            });

        });

        it('should force re-run even when the newest record is an unchanged skip', async () => {

            await seedSuccessThenUnchangedSkip('abc123');

            const result = await decide(filepath, 'abc123', true);

            expect(result).toEqual({ needsRun: true, reason: 'force' });

        });

    });

    describe('latestExecutions + decideNeedsRun — DB error path', () => {

        it('should distinguish a failed read from a genuinely new file', async () => {

            // Drop the table out from under the lookup so the SELECT itself
            // fails -- distinct from "no matching row".
            await sql`DROP TABLE __noorm_executions__`.execute(db);

            const result = await decide('sql/001.sql', 'abc123', false);

            expect(result.needsRun).toBe(true);
            expect(result.reason).toBe('error');
            expect(result.reason).not.toBe('new');

        });

    });

    describe('latestExecutions', () => {

        const seedRun = async (configName: string, filepath: string, checksum: string) => {

            const opId = await tracker.createOperation({ ...baseOp, configName, name: `build:${checksum}` });
            await tracker.createFileRecords(opId, [{ filepath, fileType: 'sql', checksum }]);
            await tracker.updateFileExecution(opId, filepath, 'success', 1);

            return opId;

        };

        it('should return the newest row per filepath for the config', async () => {

            await seedRun('test', 'sql/001.sql', 'old');
            await seedRun('test', 'sql/001.sql', 'new');
            await seedRun('test', 'sql/002.sql', 'only');

            const [latest, err] = await tracker.latestExecutions();

            expect(err).toBeNull();
            expect(latest?.size).toBe(2);
            expect(latest?.get('sql/001.sql')?.checksum).toBe('new');
            expect(latest?.get('sql/002.sql')?.checksum).toBe('only');

        });

        it('should exclude rows recorded under another config', async () => {

            await seedRun('test', 'sql/001.sql', 'mine');
            await seedRun('other', 'sql/001.sql', 'theirs');
            await seedRun('other', 'sql/002.sql', 'theirs');

            const [latest] = await tracker.latestExecutions();

            expect(latest?.size).toBe(1);
            expect(latest?.get('sql/001.sql')?.checksum).toBe('mine');

        });

        it('should carry the parent change status so stale rows rerun', async () => {

            const opId = await seedRun('test', 'sql/001.sql', 'abc');

            await db
                .updateTable('__noorm_change__')
                .set({ status: 'stale' })
                .where('id', '=', opId)
                .execute();

            const [latest] = await tracker.latestExecutions();

            expect(latest?.get('sql/001.sql')).toEqual({
                checksum: 'abc',
                exec_status: 'success',
                skip_reason: '',
                change_status: 'stale',
            });

        });

        it('should issue exactly one query regardless of file count', async () => {

            for (let i = 0; i < 5; i++) {

                await seedRun('test', `sql/00${i}.sql`, `c${i}`);

            }

            queries = [];

            const [latest] = await tracker.latestExecutions();

            expect(latest?.size).toBe(5);
            expect(queries).toHaveLength(1);

        });

        it('should emit and return the error when the lookup fails', async () => {

            const events: unknown[] = [];
            const unsub = observer.on('error', (data) => events.push(data));

            await sql`DROP TABLE __noorm_executions__`.execute(db);

            const [latest, err] = await tracker.latestExecutions();

            unsub();

            expect(latest).toBeNull();
            expect(err).toBeInstanceOf(Error);
            expect(events).toHaveLength(1);

        });

    });

    describe('updateFileExecution — row count enforcement (CP9.2)', () => {

        it('should fail when no row matches', async () => {

            const opId = await tracker.createOperation({ ...baseOp, name: 'build:x' });

            const err = await tracker.updateFileExecution(opId, 'sql/missing.sql', 'success', 1);

            expect(err).not.toBeNull();
            expect(err).toContain('sql/missing.sql');

        });

        it('should fail when more than one row matches, instead of reporting success', async () => {

            const opId = await tracker.createOperation({ ...baseOp, name: 'build:dup' });

            // Two pending rows for the same (change_id, filepath) simulate
            // the upstream defect this check exists to catch: a duplicate
            // in the discovered file list. Before this fix, updateFileExecution
            // tolerated any nonzero row count and reported this as a clean
            // update -- masking the duplicate entirely.
            await tracker.createFileRecords(opId, [
                { filepath: 'sql/dup.sql', fileType: 'sql', checksum: 'abc' },
                { filepath: 'sql/dup.sql', fileType: 'sql', checksum: 'abc' },
            ]);

            const err = await tracker.updateFileExecution(opId, 'sql/dup.sql', 'success', 1);

            expect(err).not.toBeNull();
            expect(err).toContain('sql/dup.sql');
            expect(err).toContain('2');

        });

        it('should succeed when exactly one row matches', async () => {

            const opId = await tracker.createOperation({ ...baseOp, name: 'build:ok' });
            await tracker.createFileRecords(opId, [
                { filepath: 'sql/001.sql', fileType: 'sql', checksum: 'abc' },
            ]);

            const err = await tracker.updateFileExecution(opId, 'sql/001.sql', 'success', 1);

            expect(err).toBeNull();

        });

    });

    describe('priorSuccessfulExecutions (CP9.4)', () => {

        it('should return prior successful executions, most recent first', async () => {

            const opId1 = await tracker.createOperation({ ...baseOp, name: 'build:2026-01-01' });
            await tracker.createFileRecords(opId1, [
                { filepath: 'sql/001.sql', fileType: 'sql', checksum: 'abc' },
            ]);
            await tracker.updateFileExecution(opId1, 'sql/001.sql', 'success', 1);

            const opId2 = await tracker.createOperation({ ...baseOp, name: 'build:2026-01-02' });
            await tracker.createFileRecords(opId2, [
                { filepath: 'sql/001.sql', fileType: 'sql', checksum: 'abc' },
            ]);
            await tracker.updateFileExecution(opId2, 'sql/001.sql', 'success', 1);

            const prior = await tracker.priorSuccessfulExecutions('sql/001.sql');

            expect(prior).toEqual([
                { operationName: 'build:2026-01-02', operationId: opId2 },
                { operationName: 'build:2026-01-01', operationId: opId1 },
            ]);

        });

        it('should exclude the current operation when asked', async () => {

            const opId1 = await tracker.createOperation({ ...baseOp, name: 'build:2026-01-01' });
            await tracker.createFileRecords(opId1, [
                { filepath: 'sql/001.sql', fileType: 'sql', checksum: 'abc' },
            ]);
            await tracker.updateFileExecution(opId1, 'sql/001.sql', 'success', 1);

            const prior = await tracker.priorSuccessfulExecutions('sql/001.sql', opId1);

            expect(prior).toHaveLength(0);

        });

        it('should not count failed or skipped executions as prior successes', async () => {

            const opId = await tracker.createOperation({ ...baseOp, name: 'build:failed-only' });
            await tracker.createFileRecords(opId, [
                { filepath: 'sql/001.sql', fileType: 'sql', checksum: 'abc' },
            ]);
            await tracker.updateFileExecution(opId, 'sql/001.sql', 'failed', 1, 'boom');

            const prior = await tracker.priorSuccessfulExecutions('sql/001.sql');

            expect(prior).toEqual([]);

        });

        it('should return an empty array for a file that never ran', async () => {

            const prior = await tracker.priorSuccessfulExecutions('sql/never.sql');

            expect(prior).toEqual([]);

        });

    });

});
