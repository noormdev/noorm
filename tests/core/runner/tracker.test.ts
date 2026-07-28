/**
 * Runner tracker tests (v1/49-54 CP9/CP10).
 *
 * Uses a real in-memory SQLite database, not a mock -- the CP10 defect
 * lives in `needsRun`'s `ORDER BY id DESC` picking up a row that a mocked
 * tracker would never reproduce.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';

import { Tracker } from '../../../src/core/runner/tracker.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { CreateOperationData } from '../../../src/core/runner/types.js';

describe('runner: tracker', () => {

    let db: Kysely<NoormDatabase>;
    let tracker: Tracker;

    const baseOp: Omit<CreateOperationData, 'name'> = {
        changeType: 'build',
        configName: 'test',
        executedBy: 'test@example.com',
    };

    beforeEach(async () => {

        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new BunSqliteDatabase(':memory:') as never,
            }),
        });

        await v1.up(db as Kysely<unknown>, 'sqlite');

        tracker = new Tracker(db, 'test', 'sqlite');

    });

    afterEach(async () => {

        await db.destroy();

    });

    describe('needsRun — excludeOperationId (CP10)', () => {

        it('should not treat the current operation\'s own upfront pending row as the newest record', async () => {

            // A prior, completed build ran this file successfully.
            const priorOpId = await tracker.createOperation({ ...baseOp, name: 'build:prior' });
            await tracker.createFileRecords(priorOpId, [
                { filepath: 'sql/001.sql', fileType: 'sql', checksum: 'abc123' },
            ]);
            await tracker.updateFileExecution(priorOpId, 'sql/001.sql', 'success', 10);

            // A second build's `executeFiles` inserts a pending row for
            // every file upfront (createFileRecords), before needsRun runs.
            const currentOpId = await tracker.createOperation({ ...baseOp, name: 'build:current' });
            await tracker.createFileRecords(currentOpId, [
                { filepath: 'sql/001.sql', fileType: 'sql', checksum: 'abc123' },
            ]);

            // Reproduces the defect: without exclusion, the newest row by id
            // is this run's own pending record, and 'pending' always reads
            // as 'new' -- checksum-based skipping is unreachable.
            const withoutExclusion = await tracker.needsRun('sql/001.sql', 'abc123', false);
            expect(withoutExclusion).toEqual({ needsRun: true, reason: 'new' });

            // With exclusion, the lookup skips this operation's own pending
            // row and finds the prior success -- the file is unchanged.
            const result = await tracker.needsRun('sql/001.sql', 'abc123', false, currentOpId);

            expect(result.needsRun).toBe(false);
            expect(result.skipReason).toBe('unchanged');

        });

        it('should still report a changed file as needing to run when excluding the current operation', async () => {

            const priorOpId = await tracker.createOperation({ ...baseOp, name: 'build:prior' });
            await tracker.createFileRecords(priorOpId, [
                { filepath: 'sql/001.sql', fileType: 'sql', checksum: 'old-checksum' },
            ]);
            await tracker.updateFileExecution(priorOpId, 'sql/001.sql', 'success', 10);

            const currentOpId = await tracker.createOperation({ ...baseOp, name: 'build:current' });
            await tracker.createFileRecords(currentOpId, [
                { filepath: 'sql/001.sql', fileType: 'sql', checksum: 'new-checksum' },
            ]);

            const result = await tracker.needsRun('sql/001.sql', 'new-checksum', false, currentOpId);

            expect(result).toEqual({
                needsRun: true,
                reason: 'changed',
                previousChecksum: 'old-checksum',
            });

        });

        it('should force re-run regardless of exclusion', async () => {

            const priorOpId = await tracker.createOperation({ ...baseOp, name: 'build:prior' });
            await tracker.createFileRecords(priorOpId, [
                { filepath: 'sql/001.sql', fileType: 'sql', checksum: 'abc123' },
            ]);
            await tracker.updateFileExecution(priorOpId, 'sql/001.sql', 'success', 10);

            const result = await tracker.needsRun('sql/001.sql', 'abc123', true, priorOpId);

            expect(result).toEqual({ needsRun: true, reason: 'force' });

        });

    });

    describe('needsRun — DB error path (CP9.3)', () => {

        it('should distinguish a failed read from a genuinely new file', async () => {

            // Drop the table out from under the lookup so the SELECT itself
            // fails -- distinct from "no matching row".
            await sql`DROP TABLE __noorm_executions__`.execute(db);

            const result = await tracker.needsRun('sql/001.sql', 'abc123', false);

            expect(result.needsRun).toBe(true);
            expect(result.reason).toBe('error');
            expect(result.reason).not.toBe('new');

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
