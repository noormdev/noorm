/**
 * Change tracker tests.
 *
 * Pins `ChangeTracker.canRevert`/`markAsReverted` state-machine rules
 * against a real in-memory SQLite database. No dependency on `rewind()`'s
 * sort, so unlike some `manager.test.ts` cases these are unaffected by
 * ticket 34.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Kysely, SqliteDialect } from 'kysely';
import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';

import { ChangeTracker } from '../../../src/core/change/tracker.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import type { NoormDatabase, OperationStatus, Direction } from '../../../src/core/shared/index.js';

describe('change: tracker', () => {

    let db: Kysely<NoormDatabase>;
    let tracker: ChangeTracker;

    /**
     * Insert a `__noorm_change__` row directly, bypassing `ChangeHistory`,
     * so each test can pin an exact status without running a real change.
     */
    async function seedChangeRecord(record: {
        name: string;
        status: OperationStatus;
        direction?: Direction;
        configName?: string;
    }): Promise<void> {

        await db
            .insertInto('__noorm_change__')
            .values({
                name: record.name,
                change_type: 'change',
                direction: record.direction ?? 'change',
                status: record.status,
                config_name: record.configName ?? 'test',
                executed_by: 'test@example.com',
            })
            .execute();

    }

    beforeEach(async () => {

        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new BunSqliteDatabase(':memory:') as never,
            }),
        });

        await v1.up(db as Kysely<unknown>, 'sqlite');

        tracker = new ChangeTracker(db, 'test', 'sqlite');

    });

    afterEach(async () => {

        await db.destroy();

    });

    describe('canRevert', () => {

        it('should return not-applied when no change-direction record exists', async () => {

            const result = await tracker.canRevert('never-applied', false);

            expect(result).toEqual({ canRevert: false, reason: 'not applied' });

        });

        it('should allow revert for a success record', async () => {

            await seedChangeRecord({ name: 'change-success', status: 'success' });

            const result = await tracker.canRevert('change-success', false);

            expect(result).toEqual({ canRevert: true, status: 'success' });

        });

        it('should allow revert for a failed record (partial applies are still revertable)', async () => {

            await seedChangeRecord({ name: 'change-failed', status: 'failed' });

            const result = await tracker.canRevert('change-failed', false);

            expect(result).toEqual({ canRevert: true, status: 'failed' });

        });

        it('should deny revert for a pending record', async () => {

            await seedChangeRecord({ name: 'change-pending', status: 'pending' });

            const result = await tracker.canRevert('change-pending', false);

            expect(result).toEqual({ canRevert: false, reason: 'not applied yet', status: 'pending' });

        });

        it('should deny revert for an already-reverted record', async () => {

            await seedChangeRecord({ name: 'change-reverted', status: 'reverted' });

            const result = await tracker.canRevert('change-reverted', false);

            expect(result).toEqual({ canRevert: false, reason: 'already reverted', status: 'reverted' });

        });

        it('should deny revert for a stale record (schema was torn down)', async () => {

            await seedChangeRecord({ name: 'change-stale', status: 'stale' });

            const result = await tracker.canRevert('change-stale', false);

            expect(result).toEqual({ canRevert: false, reason: 'schema was torn down', status: 'stale' });

        });

        it('should bypass status checks when force is true, but not manufacture a missing record', async () => {

            await seedChangeRecord({ name: 'change-pending-forced', status: 'pending' });

            const forced = await tracker.canRevert('change-pending-forced', true);

            expect(forced).toEqual({ canRevert: true, status: 'pending' });

            const forcedMissing = await tracker.canRevert('never-applied-forced', true);

            expect(forcedMissing).toEqual({ canRevert: false, reason: 'not applied' });

        });

    });

    describe('markAsReverted', () => {

        it('should flip only the most recent change-direction record to reverted', async () => {

            // Earlier row simulates a first attempt that failed; later row simulates a
            // retry that succeeded. The earlier row is seeded with a status other than
            // 'reverted' (the value markAsReverted writes) on purpose -- if a future
            // refactor broadens the update to match by name instead of by id, the earlier
            // row would incorrectly flip to 'reverted' too, and this assertion catches it.
            // Seeding it as already-'reverted' would not: the post-call value would look
            // identical whether the row was left untouched or rewritten to the same value.
            await seedChangeRecord({ name: 'reapplied-change', status: 'failed' });
            await seedChangeRecord({ name: 'reapplied-change', status: 'success' });

            await tracker.markAsReverted('reapplied-change');

            const rows = await db
                .selectFrom('__noorm_change__')
                .select(['id', 'status'])
                .where('name', '=', 'reapplied-change')
                .where('direction', '=', 'change')
                .orderBy('id', 'asc')
                .execute();

            expect(rows).toHaveLength(2);
            expect(rows[0]?.status).toBe('failed');
            expect(rows[1]?.status).toBe('reverted');

        });

        it('should be a silent no-op when no change-direction record exists', async () => {

            await expect(tracker.markAsReverted('never-applied')).resolves.toBeUndefined();

        });

    });

});
