/**
 * Change history tests.
 *
 * Pins Date hydration at the history-adapter boundary (`hydrateDate`) and
 * verifies the real in-memory SQLite driver returns hydrated `Date`
 * instances end to end, mirroring the executor test harness (see
 * tests/core/change/executor.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, SqliteDialect } from 'kysely';
import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';

import { ChangeHistory, hydrateDate } from '../../../src/core/change/history.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import { resetLockManager } from '../../../src/core/lock/index.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';

describe('change: history — hydrateDate', () => {

    // Pin a non-UTC zone for this block: on a UTC-TZ host (e.g. CI runners,
    // which default to TZ=UTC), a naive `new Date(rawString)` regression
    // would produce the SAME output as the correct UTC-aware parse, since
    // there is no offset to shift by -- so the UTC-correctness assertion
    // below would pass even with the bug reintroduced. Forcing a non-UTC
    // offset makes the test fail deterministically on any host.
    let originalTz: string | undefined;

    beforeAll(() => {

        originalTz = process.env.TZ;
        process.env.TZ = 'America/New_York';

    });

    afterAll(() => {

        if (originalTz === undefined) {

            delete process.env.TZ;

        }
        else {

            process.env.TZ = originalTz;

        }

    });

    it('should parse a SQLite raw string as UTC, not local time', () => {

        // The regression this test must catch: a naive new Date(rawString)
        // parses SQLite offset-less CURRENT_TIMESTAMP text as local time,
        // silently shifting the result by the host UTC offset. Empirically
        // verified pair from the spec (host TZ America/New_York, -240min).
        const hydrated = hydrateDate('2026-07-12 09:02:59');

        expect(hydrated).toBeInstanceOf(Date);
        expect(hydrated?.toISOString()).toBe('2026-07-12T09:02:59.000Z');

    });

    it('should pass a Date through unchanged (pg/mysql/mssql shape)', () => {

        const original = new Date('2026-07-12T09:02:59.000Z');
        const hydrated = hydrateDate(original);

        expect(hydrated).toBe(original);

    });

    it('should return null for null input', () => {

        expect(hydrateDate(null)).toBeNull();

    });

    it('should return null for undefined input', () => {

        expect(hydrateDate(undefined)).toBeNull();

    });

});

describe('change: history — real SQLite driver hydration', () => {

    let db: Kysely<NoormDatabase>;
    let tempDir: string;

    beforeEach(async () => {

        resetLockManager();

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-history-test-'));

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

    /**
     * Run and finalize a single successful operation against the real
     * in-memory bun:sqlite driver.
     */
    async function recordOperation(history: ChangeHistory, name: string): Promise<void> {

        const operationId = await history.createOperation({
            name,
            direction: 'change',
            executedBy: 'test@example.com',
        });

        const err = await history.finalizeOperation(operationId, 'success', 'checksum', 1);

        expect(err).toBeNull();

    }

    it('should return Date instances from getStatus, getAllStatuses, getHistory, and getUnifiedHistory', async () => {

        const history = new ChangeHistory(db, 'test', 'sqlite');

        await recordOperation(history, 'change-one');
        await recordOperation(history, 'change-two');

        const status = await history.getStatus('change-one');

        expect(status?.appliedAt).toBeInstanceOf(Date);

        const allStatuses = await history.getAllStatuses();

        expect(allStatuses.get('change-one')?.appliedAt).toBeInstanceOf(Date);
        expect(allStatuses.get('change-two')?.appliedAt).toBeInstanceOf(Date);

        const records = await history.getHistory();

        expect(records.length).toBeGreaterThan(0);

        for (const record of records) {

            expect(record.executedAt).toBeInstanceOf(Date);

        }

        const unified = await history.getUnifiedHistory();

        expect(unified.length).toBeGreaterThan(0);

        for (const record of unified) {

            expect(record.executedAt).toBeInstanceOf(Date);

        }

    });

});
