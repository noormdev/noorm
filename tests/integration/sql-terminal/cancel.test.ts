/**
 * Cancellation integration tests against live databases.
 *
 * The claim under test is the one that cannot be made with a fake clock: that
 * on postgres and mysql an abort actually stops the query on the server, and
 * that on mssql it does not — only the client stops listening. Each dialect is
 * asked the same question twice: did the caller get control back, and is the
 * query still burning a session a second later.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import { executeRawSqlUnchecked } from '../../../src/core/sql-terminal/executor.js';
import { createTestConnection, skipIfNoContainer } from '../../utils/db.js';

/** A sleep long enough that it can only end by being cancelled. */
const SLEEP_SECONDS = 20;

/** How long the caller may wait for control back after pressing the hatch. */
const RETURN_BUDGET_MS = 3_000;

/**
 * Poll `probe` until it reports zero, or the deadline passes.
 *
 * A cancel is asynchronous on every server here — the backend notices at its
 * next interrupt check — so a single read right after the abort would be
 * racing the database rather than testing it.
 */
async function waitForNoSessions(probe: () => Promise<number>, timeoutMs = 10_000): Promise<number> {

    const deadline = Date.now() + timeoutMs;

    let running = await probe();

    while (running > 0 && Date.now() < deadline) {

        await new Promise((r) => setTimeout(r, 100));
        running = await probe();

    }

    return running;

}

describe('integration: postgres query cancellation', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        const conn = await createTestConnection('postgres');
        db = conn.db;
        destroy = conn.destroy;

    });

    afterAll(async () => {

        if (destroy) await destroy();

    });

    const runningSleeps = async () => {

        const result = await sql<{ n: number | string }>`
            select count(*) as n from pg_stat_activity
            where query like ${`%pg_sleep(${SLEEP_SECONDS})%`}
              and query not like '%pg_stat_activity%'
              and state = 'active'
        `.execute(db);

        return Number(result.rows[0]?.n ?? 0);

    };

    it('should hand control back promptly and stop the query on the server', async () => {

        const controller = new AbortController();
        const started = Date.now();

        const pending = executeRawSqlUnchecked(db, `select pg_sleep(${SLEEP_SECONDS})`, 'test', {
            signal: controller.signal,
            dialect: 'postgres',
        });

        // Long enough that the query is genuinely running, short enough that a
        // result arriving on its own would mean the sleep never happened.
        await new Promise((r) => setTimeout(r, 750));

        expect(await runningSleeps()).toBe(1);

        controller.abort();

        const result = await pending;
        const elapsed = Date.now() - started;

        expect(result.success).toBe(false);
        expect(result.aborted).toBe('server-cancel-requested');
        expect(elapsed).toBeLessThan(RETURN_BUDGET_MS);

        expect(await waitForNoSessions(runningSleeps)).toBe(0);

    }, 40_000);

    it('should leave the pool usable once a query has been cancelled', async () => {

        const controller = new AbortController();

        const pending = executeRawSqlUnchecked(db, `select pg_sleep(${SLEEP_SECONDS})`, 'test', {
            signal: controller.signal,
            dialect: 'postgres',
        });

        await new Promise((r) => setTimeout(r, 500));
        controller.abort();
        await pending;

        await waitForNoSessions(runningSleeps);

        const after = await executeRawSqlUnchecked(db, 'select 1 as n', 'test');

        expect(after.success).toBe(true);
        expect(after.rows).toEqual([{ n: 1 }]);

    }, 40_000);

});

describe('integration: mysql query cancellation', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('mysql');

        const conn = await createTestConnection('mysql');
        db = conn.db;
        destroy = conn.destroy;

    });

    afterAll(async () => {

        if (destroy) await destroy();

    });

    const runningSleeps = async () => {

        const result = await sql<{ n: number | string }>`
            select count(*) as n from information_schema.processlist
            where info like ${`%sleep(${SLEEP_SECONDS})%`}
              and info not like '%information_schema.processlist%'
        `.execute(db);

        return Number(result.rows[0]?.n ?? 0);

    };

    it('should hand control back promptly and kill the query on the server', async () => {

        const controller = new AbortController();
        const started = Date.now();

        const pending = executeRawSqlUnchecked(db, `select sleep(${SLEEP_SECONDS})`, 'test', {
            signal: controller.signal,
            dialect: 'mysql',
        });

        await new Promise((r) => setTimeout(r, 750));

        expect(await runningSleeps()).toBe(1);

        controller.abort();

        const result = await pending;
        const elapsed = Date.now() - started;

        expect(result.success).toBe(false);
        expect(result.aborted).toBe('server-cancel-requested');
        expect(elapsed).toBeLessThan(RETURN_BUDGET_MS);

        expect(await waitForNoSessions(runningSleeps)).toBe(0);

    }, 40_000);

});

describe('integration: mssql query cancellation', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    // Short on purpose. An abandoned mssql batch keeps its pool connection to
    // itself until it finishes, and `db.destroy()` waits for it — so a long
    // delay here would hang the suite's own teardown, which is exactly the
    // hazard `discardConnection`'s timeout exists to bound in production.
    const DELAY = "'00:00:04'";

    const runningWaits = async () => {

        const result = await sql<{ n: number | string }>`
            select count(*) as n
            from sys.dm_exec_requests r
            cross apply sys.dm_exec_sql_text(r.sql_handle) t
            where t.text like '%waitfor delay%'
              and t.text not like '%dm_exec_requests%'
        `.execute(db);

        return Number(result.rows[0]?.n ?? 0);

    };

    beforeAll(async () => {

        await skipIfNoContainer('mssql');

        const conn = await createTestConnection('mssql');
        db = conn.db;
        destroy = conn.destroy;

    });

    afterAll(async () => {

        if (destroy) await destroy();

    });

    it('should hand control back but say so honestly, because nothing reaches the server', async () => {

        const controller = new AbortController();
        const started = Date.now();

        const pending = executeRawSqlUnchecked(db, `waitfor delay ${DELAY}`, 'test', {
            signal: controller.signal,
            dialect: 'mssql',
        });

        await new Promise((r) => setTimeout(r, 750));

        controller.abort();

        const result = await pending;
        const elapsed = Date.now() - started;

        expect(result.success).toBe(false);
        expect(result.aborted).toBe('stopped-waiting');
        expect(result.errorMessage).toContain('may still be running');
        expect(elapsed).toBeLessThan(RETURN_BUDGET_MS);

        await waitForNoSessions(runningWaits);

    }, 40_000);

    it('should still be running the abandoned batch on the server, which is what stopped-waiting means', async () => {

        const controller = new AbortController();

        const pending = executeRawSqlUnchecked(db, `waitfor delay ${DELAY}`, 'test', {
            signal: controller.signal,
            dialect: 'mssql',
        });

        await new Promise((r) => setTimeout(r, 750));
        controller.abort();
        await pending;

        // A second after the caller gave up, the server has not been told
        // anything. This is the assertion that keeps the UI wording honest.
        await new Promise((r) => setTimeout(r, 1_000));

        expect(await runningWaits()).toBeGreaterThan(0);

        await waitForNoSessions(runningWaits);

    }, 40_000);

});
