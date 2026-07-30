/**
 * Lock timezone tests.
 *
 * The lock table's `locked_at`/`expires_at` are naive datetime columns
 * (`src/core/version/schema/migrations/v1.ts`) — they carry no offset. Expiry
 * is therefore only correct if the value written and the value read are in the
 * same frame of reference, and that frame must not be the client's local
 * timezone.
 *
 * WHY these tests exist: the rest of the lock suite runs exclusively on
 * in-memory SQLite, the one dialect where this cannot happen (dates go in as
 * ISO-8601 UTC strings). On postgres and mysql a read-only `status()` from a
 * timezone ahead of the holder's silently *deleted* a live lock, because
 * `#cleanupExpired` compared two values that were never in the same frame.
 *
 * These assert intent — "a lock that is live is reported live, and is still
 * there afterwards, no matter what timezone the reader sits in" — not the
 * serialization mechanism, so they stay honest if the storage format changes.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { attempt } from '@logosdx/utils';
import { Kysely, SqliteDialect } from 'kysely';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { createConnection } from '../../../src/core/connection/factory.js';
import type { Dialect } from '../../../src/core/connection/types.js';
import { getLockManager, resetLockManager } from '../../../src/core/lock/index.js';
import { getNoormTables, noormDb, type NoormDatabase } from '../../../src/core/shared/index.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import { v2 } from '../../../src/core/version/schema/migrations/v2.js';
import { skipIfNoContainer, TEST_CONNECTIONS } from '../../utils/db.js';

/** Five minutes, the production default lock TTL. */
const TTL = 5 * 60 * 1000;

/**
 * Timezones chosen so the offset error is unmistakable: Tokyo is +9 ahead of
 * UTC, far larger than any plausible TTL, so a frame-of-reference bug can
 * never be mistaken for clock skew.
 */
const AHEAD = 'Asia/Tokyo';
const BEHIND = 'UTC';

/**
 * Restoring TZ must assign, never `delete`.
 *
 * Bun caches the resolved zone, and `delete process.env.TZ` leaves that cache
 * pinned to the last value — every later assignment in the process is then
 * silently ignored. Deleting here made the second dialect's suite read Tokyo
 * dates while believing it had set UTC, which masked a real failure.
 */
const SYSTEM_TZ = process.env['TZ'] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

let configCounter = 0;

/**
 * Unique config name per test so rows never collide with other suites
 * sharing the same tracking tables.
 */
function nextConfigName(): string {

    configCounter += 1;

    return `tz_test_${process.pid}_${Date.now()}_${configCounter}`;

}

/**
 * Ensure the noorm lock table exists without disturbing tables other suites
 * may already rely on. Probes first, migrates only when absent.
 */
async function ensureLockTable(db: Kysely<NoormDatabase>, dialect: Dialect): Promise<void> {

    const tables = getNoormTables(dialect);
    const ndb = noormDb(db, dialect);

    const [, missing] = await attempt(() =>
        ndb.selectFrom(tables.lock).select('id').limit(1).executeTakeFirst(),
    );

    if (!missing) return;

    await attempt(() => v1.up(db as Kysely<unknown>, dialect));
    await attempt(() => v2.up(db as Kysely<unknown>, dialect));

    const [, stillMissing] = await attempt(() =>
        ndb.selectFrom(tables.lock).select('id').limit(1).executeTakeFirst(),
    );

    if (stillMissing) {

        throw new Error(`Could not create the ${dialect} lock table: ${stillMissing.message}`);

    }

}

/**
 * Count physical lock rows for a config.
 *
 * Asserting on the row — not just on what `status()` returns — is the point:
 * the defect was a *read* path issuing a DELETE.
 */
async function countRows(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    configName: string,
): Promise<number> {

    const tables = getNoormTables(dialect);
    const ndb = noormDb(db, dialect);

    const rows = await ndb
        .selectFrom(tables.lock)
        .select('config_name')
        .where('config_name', '=', configName)
        .execute();

    return rows.length;

}

/**
 * Every dialect noorm supports. SQLite and MSSQL already stored UTC; they are
 * here as regression guards so a future "normalise everything" change cannot
 * silently break the two that were correct.
 */
const DIALECTS: Dialect[] = ['postgres', 'mysql', 'mssql', 'sqlite'];

for (const dialect of DIALECTS) {

    describe(`lock: timezone (${dialect})`, () => {

        let db: Kysely<NoormDatabase>;
        let destroy: (() => Promise<void>) | null = null;

        beforeAll(async () => {

            if (dialect === 'sqlite') {

                db = new Kysely<NoormDatabase>({
                    dialect: new SqliteDialect({
                        database: new BunSqliteDatabase(':memory:') as never,
                    }),
                });

                await v1.up(db as Kysely<unknown>, 'sqlite');

                return;

            }

            // The real connection is the authority on availability:
            // `skipIfNoContainer`'s probe uses a short timeout that a cold
            // MSSQL/tedious handshake loses, so consulting it first produces
            // false "container not running" failures. Fall back to it only to
            // render the standard message when the connection genuinely fails.
            const [conn, connErr] = await attempt(() =>
                createConnection(TEST_CONNECTIONS[dialect], `__tz_${dialect}__`),
            );

            if (connErr) {

                await skipIfNoContainer(dialect);

                throw connErr;

            }

            db = conn.db as Kysely<NoormDatabase>;
            destroy = conn.destroy;

            await ensureLockTable(db, dialect);

            // 60s: a cold MSSQL handshake (master preflight, then target)
            // routinely exceeds bun's default 5s hook budget.

        }, 60_000);

        afterEach(() => {

            // A leaked TZ would silently corrupt every later test in the process.
            process.env['TZ'] = SYSTEM_TZ;

            resetLockManager();

        });

        afterAll(async () => {

            if (destroy) await destroy();
            else if (db) await db.destroy();

        });

        it('should keep a live lock when status is read from a timezone ahead of the holder', async () => {

            const manager = getLockManager();
            const configName = nextConfigName();

            process.env['TZ'] = BEHIND;
            await manager.acquire(db, configName, 'alice', { dialect, timeout: TTL });

            expect(await countRows(db, dialect, configName)).toBe(1);

            process.env['TZ'] = AHEAD;
            const status = await manager.status(db, configName, dialect);

            expect(status.isLocked).toBe(true);
            expect(status.lock?.lockedBy).toBe('alice');

            // The read must not have destroyed the lock it was asked to report on.
            expect(await countRows(db, dialect, configName)).toBe(1);

            process.env['TZ'] = BEHIND;
            await manager.forceRelease(db, configName, dialect);

        });

        it('should not inflate the TTL when the holder acquired from a timezone ahead', async () => {

            const manager = getLockManager();
            const configName = nextConfigName();

            process.env['TZ'] = AHEAD;
            await manager.acquire(db, configName, 'bob', { dialect, timeout: TTL });

            process.env['TZ'] = BEHIND;
            const status = await manager.status(db, configName, dialect);

            expect(status.isLocked).toBe(true);

            // A 5-minute lock must read as ~5 minutes, not 5 minutes + the offset.
            // Slack covers mysql's second-granularity `timestamp` column.
            const remaining = status.lock!.expiresAt.getTime() - Date.now();

            expect(remaining).toBeGreaterThan(0);
            expect(remaining).toBeLessThanOrEqual(TTL + 5_000);

            await manager.forceRelease(db, configName, dialect);

        });

        it('should let a holder in another timezone still be blocked by the lock', async () => {

            const manager = getLockManager();
            const configName = nextConfigName();

            process.env['TZ'] = BEHIND;
            await manager.acquire(db, configName, 'alice', { dialect, timeout: TTL });

            process.env['TZ'] = AHEAD;
            const [, err] = await attempt(() =>
                manager.acquire(db, configName, 'bob', { dialect, timeout: TTL }),
            );

            expect(err).toBeInstanceOf(Error);
            expect(err?.name).toBe('LockAcquireError');

            process.env['TZ'] = BEHIND;
            await manager.forceRelease(db, configName, dialect);

        });

        it('should still expire a genuinely expired lock read from another timezone', async () => {

            const manager = getLockManager();
            const configName = nextConfigName();

            // Negative TTL — already expired the moment it is written.
            process.env['TZ'] = BEHIND;
            await manager.acquire(db, configName, 'alice', { dialect, timeout: -60_000 });

            process.env['TZ'] = AHEAD;
            const status = await manager.status(db, configName, dialect);

            // Fixing the read frame must not turn expiry into a no-op.
            expect(status.isLocked).toBe(false);
            expect(await countRows(db, dialect, configName)).toBe(0);

        });

    });

}
