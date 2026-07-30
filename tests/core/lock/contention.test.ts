/**
 * Lock contention tests.
 *
 * WHY these tests exist: the lock suite had 53 `it()` blocks and not one of
 * them put two callers in contention, so `acquire()` shipped as an
 * unserialised SELECT-then-INSERT. The `config_name` UNIQUE constraint — not
 * the code — was what actually prevented a second lock row, which meant the
 * loser received a raw driver error instead of `LockAcquireError`, and
 * `wait: true` threw in milliseconds instead of polling to `waitTimeout`.
 *
 * These assert the contract callers are promised: exactly one winner, a
 * domain error naming the holder for everyone else, and a `wait` that
 * actually waits.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { attempt } from '@logosdx/utils';
import type { Kysely } from 'kysely';

import { createConnection } from '../../../src/core/connection/factory.js';
import type { Dialect } from '../../../src/core/connection/types.js';
import { getLockManager } from '../../../src/core/lock/index.js';
import { getNoormTables, noormDb, type NoormDatabase } from '../../../src/core/shared/index.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import { v2 } from '../../../src/core/version/schema/migrations/v2.js';
import { skipIfNoContainer, TEST_CONNECTIONS } from '../../utils/db.js';

const DIALECT: Dialect = 'postgres';
const WORKER = new URL('./race-worker.ts', import.meta.url).pathname;

/** Outcome shape emitted by race-worker.ts. */
interface RaceResult {
    identity: string;
    outcome: 'ACQUIRED' | 'THREW';
    elapsed: number;
    lockedBy: string | null;
    errorName: string | null;
    errorMessage: string | null;
    holder: string | null;
    driverCode: string | number | null;
}

let configCounter = 0;

function nextConfigName(): string {

    configCounter += 1;

    return `race_test_${process.pid}_${Date.now()}_${configCounter}`;

}

/**
 * Run N separate processes that all try to acquire the same lock at once.
 *
 * @param lead - milliseconds of head start, so every worker is connected and
 * parked on the barrier before any of them attempts the acquire
 */
async function race(
    configName: string,
    identities: string[],
    opts: { lead?: number; timeoutMs?: number; waitTimeoutMs?: number } = {},
): Promise<RaceResult[]> {

    const start = Date.now() + (opts.lead ?? 2_000);

    const procs = identities.map((identity) => {

        const argv = [
            'bun', WORKER, configName, identity, String(start), DIALECT,
            String(opts.timeoutMs ?? 60_000),
        ];

        if (opts.waitTimeoutMs !== undefined) argv.push(String(opts.waitTimeoutMs));

        return Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' });

    });

    const outputs = await Promise.all(
        procs.map(async (p) => {

            const [out, errOut] = await Promise.all([
                new Response(p.stdout).text(),
                new Response(p.stderr).text(),
            ]);

            await p.exited;

            const line = out.trim().split('\n').filter(Boolean).pop();

            if (!line) {

                throw new Error(`Worker produced no result. stderr:\n${errOut}`);

            }

            return JSON.parse(line) as RaceResult;

        }),
    );

    return outputs;

}

/**
 * Fail loudly, with the raw worker output, when a race produced no winner for
 * a reason that is not contention.
 *
 * Postgres is shared, and a saturated server makes every worker throw a
 * connection error — which would otherwise surface as a bare "expected length
 * 1, got 0" and read like a lock regression. Contention always leaves either a
 * winner or a LockAcquireError, so anything else is infrastructure.
 */
function assertRaceHealthy(results: RaceResult[]): void {

    const acquired = results.some((r) => r.outcome === 'ACQUIRED');
    const contended = results.some((r) => r.errorName === 'LockAcquireError');

    if (acquired || contended) return;

    throw new Error(
        'No worker acquired the lock and none reported contention — the database is ' +
        `probably unreachable or saturated, not the lock:\n${JSON.stringify(results, null, 2)}`,
    );

}

describe('lock: contention', () => {

    let db: Kysely<NoormDatabase>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer(DIALECT);

        const conn = await createConnection(TEST_CONNECTIONS[DIALECT], '__contention__');
        db = conn.db as Kysely<NoormDatabase>;
        destroy = conn.destroy;

        const tables = getNoormTables(DIALECT);
        const ndb = noormDb(db, DIALECT);

        const [, missing] = await attempt(() =>
            ndb.selectFrom(tables.lock).select('id').limit(1).executeTakeFirst(),
        );

        if (missing) {

            await attempt(() => v1.up(db as Kysely<unknown>, DIALECT));
            await attempt(() => v2.up(db as Kysely<unknown>, DIALECT));

        }

    });

    afterEach(() => {

        getLockManager();

    });

    afterAll(async () => {

        await destroy();

    });

    it('should let exactly one of three competing processes acquire the lock', async () => {

        const configName = nextConfigName();

        const results = await race(configName, ['alice', 'bob', 'carol']);

        assertRaceHealthy(results);

        const winners = results.filter((r) => r.outcome === 'ACQUIRED');
        const losers = results.filter((r) => r.outcome === 'THREW');

        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(2);

        await getLockManager().forceRelease(db, configName, DIALECT);

    }, 30_000);

    it('should report contention as LockAcquireError naming the holder, not a driver error', async () => {

        const configName = nextConfigName();

        const results = await race(configName, ['alice', 'bob', 'carol']);

        assertRaceHealthy(results);

        const winner = results.find((r) => r.outcome === 'ACQUIRED')!;
        const losers = results.filter((r) => r.outcome === 'THREW');

        expect(winner).toBeDefined();

        for (const loser of losers) {

            // The contract callers branch on (e.g. LockAcquireScreen.tsx).
            expect(loser.errorName).toBe('LockAcquireError');

            // A leaked driver error is the specific regression: postgres 23505.
            expect(loser.driverCode).toBeNull();
            expect(loser.errorMessage).not.toContain('duplicate key');
            expect(loser.errorMessage).not.toContain('23505');

            // The error must be able to tell the user who is holding it.
            expect(loser.holder).toBe(winner.identity);

        }

        await getLockManager().forceRelease(db, configName, DIALECT);

    }, 30_000);

    it('should poll for the whole waitTimeout before giving up when wait is true', async () => {

        const configName = nextConfigName();

        // Winner holds for 60s; the waiter cannot possibly succeed, so it must
        // spend its full 3s budget polling rather than failing immediately.
        const results = await race(configName, ['alice', 'bob'], {
            timeoutMs: 60_000,
            waitTimeoutMs: 3_000,
        });

        assertRaceHealthy(results);

        const loser = results.find((r) => r.outcome === 'THREW')!;

        expect(loser).toBeDefined();
        expect(loser.errorName).toBe('LockAcquireError');

        // The defect: this returned in single-digit milliseconds.
        expect(loser.elapsed).toBeGreaterThanOrEqual(2_500);

        await getLockManager().forceRelease(db, configName, DIALECT);

    }, 30_000);

    it('should hand the lock to a waiting process once the holder expires', async () => {

        const configName = nextConfigName();

        // Winner's lock expires after 2s; the waiter has a 15s budget, so the
        // queueing contract means it should end up holding the lock.
        const results = await race(configName, ['alice', 'bob'], {
            timeoutMs: 2_000,
            waitTimeoutMs: 15_000,
        });

        assertRaceHealthy(results);

        const acquired = results.filter((r) => r.outcome === 'ACQUIRED');

        expect(acquired).toHaveLength(2);

        const second = acquired.find((r) => r.elapsed > 1_000);

        expect(second).toBeDefined();

        await getLockManager().forceRelease(db, configName, DIALECT);

    }, 40_000);

});
