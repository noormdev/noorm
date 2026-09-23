/**
 * Statement watcher against live servers.
 *
 * The claims only a real server can check: the report names the session a
 * blocked file is waiting on, it carries the progress the server publishes for
 * the running command, and aborting the run's signal stops the statement on
 * the server rather than only on the client.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import { observer } from '../../../src/core/observer.js';
import { StatementWatcher } from '../../../src/core/runner/statement-watcher.js';
import { createConnection } from '../../../src/core/connection/factory.js';
import { TEST_CONNECTIONS, assertTestDatabase, createTestConnection, skipIfNoContainer } from '../../utils/db.js';
import type { NoormEvents } from '../../../src/core/observer.js';

type Report = NoormEvents['file:progress'];

const WATCH = { delayMs: 100, intervalMs: 150 };

/** Resolve with the first report matching `predicate`, or null after `timeoutMs`. */
async function waitForReport(reports: Report[], predicate: (r: Report) => boolean, timeoutMs = 8_000): Promise<Report | null> {

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {

        const match = reports.find(predicate);

        if (match) return match;

        await new Promise((r) => setTimeout(r, 50));

    }

    return null;

}

/**
 * Hold `setup` open on its own connection until the returned release is called.
 */
function holdSession(db: Kysely<unknown>, setup: (conn: Kysely<unknown>) => Promise<void>) {

    let release!: () => void;
    const released = new Promise<void>((r) => {

        release = r;

    });

    let ready!: (pid: number) => void;
    const pid = new Promise<number>((r) => {

        ready = r;

    });

    const done = db.connection().execute(async (conn) => {

        const result = await sql<{ id: number }>`select pg_backend_pid() as id`.execute(conn);
        await setup(conn);
        ready(Number(result.rows[0]!.id));
        await released;
        await sql`rollback`.execute(conn);

    });

    return { pid, release, done };

}

describe('integration: postgres statement watcher', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;
    let reports: Report[];
    let stopListening: () => void;

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        const conn = await createTestConnection('postgres');
        db = conn.db;
        destroy = conn.destroy;

        await sql`drop table if exists watcher_items`.execute(db);
        await sql`create table watcher_items (id int)`.execute(db);

    });

    afterAll(async () => {

        if (!db) return;

        await sql`drop table if exists watcher_items`.execute(db);
        await destroy();

    });

    beforeEach(() => {

        reports = [];
        stopListening = observer.on('file:progress', (data) => {

            reports.push(data);

        });

    });

    afterEach(() => stopListening());

    it('should name the session a blocked file is waiting on', async () => {

        const holder = holdSession(db, async (conn) => {

            await sql`begin`.execute(conn);
            await sql`lock table watcher_items in access exclusive mode`.execute(conn);

        });
        const holderPid = await holder.pid;

        const watcher = new StatementWatcher(db, { dialect: 'postgres', ...WATCH });
        const pending = watcher.run('blocked.sql', db, (conn) => sql`select count(*) from watcher_items`.execute(conn));

        const report = await waitForReport(reports, (r) => (r.status?.blockedBy.length ?? 0) > 0);

        holder.release();
        await holder.done;
        await pending;
        await watcher.close();

        expect(report).not.toBeNull();
        expect(report!.sessionId).not.toBeNull();
        expect(report!.status!.blockedBy.map((b) => b.pid)).toContain(holderPid);
        expect(report!.status!.waitEvent).toContain('Lock');

    }, 20_000);

    it('should carry the progress postgres reports for CREATE INDEX', async () => {

        // CONCURRENTLY waits for open writers inside its own progress phase,
        // which holds the build still long enough to observe.
        const holder = holdSession(db, async (conn) => {

            await sql`begin`.execute(conn);
            await sql`insert into watcher_items values (1)`.execute(conn);

        });
        await holder.pid;

        const watcher = new StatementWatcher(db, { dialect: 'postgres', ...WATCH });
        const pending = watcher.run('index.sql', db, (conn) =>
            sql.raw('create index concurrently watcher_items_id on watcher_items (id)').execute(conn));

        const report = await waitForReport(reports, (r) => r.status?.progress !== null && r.status?.progress !== undefined);

        holder.release();
        await holder.done;
        await pending;
        await watcher.close();
        await sql`drop index if exists watcher_items_id`.execute(db);

        expect(report).not.toBeNull();
        expect(report!.status!.progress!.operation).toBe('CREATE INDEX CONCURRENTLY');
        expect(report!.status!.progress!.relation).toBe('watcher_items');
        expect(report!.status!.progress!.phase).toContain('waiting');

    }, 20_000);

    it('should leave a single-connection pool usable after a slow file', async () => {

        const config = { ...TEST_CONNECTIONS.postgres, pool: { max: 1 } };
        assertTestDatabase(config);
        const single = await createConnection(config, '__test_postgres_max1__');

        const watcher = new StatementWatcher(single.db, { dialect: 'postgres', ...WATCH });

        // Longer than the side-connection wait, so the watcher gives up on a
        // checkout that can only be served once the file releases the pool.
        await watcher.run('slow.sql', single.db, (conn) => sql`select pg_sleep(6)`.execute(conn));

        const started = Date.now();
        const followUp = await sql<{ n: number }>`select 1 as n`.execute(single.db);
        const waitedMs = Date.now() - started;

        await watcher.close();
        await single.destroy();

        expect(followUp.rows[0]?.n).toBe(1);
        expect(waitedMs).toBeLessThan(2_000);

    }, 30_000);

    it('should hand a single-connection pool back when the file ends inside the checkout wait', async () => {

        const config = { ...TEST_CONNECTIONS.postgres, pool: { max: 1 } };
        assertTestDatabase(config);
        const single = await createConnection(config, '__test_postgres_max1_short__');

        const watcher = new StatementWatcher(single.db, { dialect: 'postgres', ...WATCH });

        // The side checkout queues behind this file and is served the moment
        // the file releases the pool, well inside the 5s wait.
        await watcher.run('short.sql', single.db, (conn) => sql`select pg_sleep(2)`.execute(conn));

        const started = Date.now();
        const followUp = await sql<{ n: number }>`select 1 as n`.execute(single.db);
        const waitedMs = Date.now() - started;

        await watcher.close();
        await single.destroy();

        expect(followUp.rows[0]?.n).toBe(1);
        expect(waitedMs).toBeLessThan(2_000);

    }, 30_000);

    it('should not hold a single-connection pool waiting for a cancel that cannot be sent', async () => {

        const config = { ...TEST_CONNECTIONS.postgres, pool: { max: 1 } };
        assertTestDatabase(config);
        const single = await createConnection(config, '__test_postgres_max1_cancel__');

        const controller = new AbortController();
        const watcher = new StatementWatcher(single.db, { dialect: 'postgres', signal: controller.signal, ...WATCH });
        const started = Date.now();

        const pending = watcher.run('short.sql', single.db, (conn) => sql`select pg_sleep(1)`.execute(conn));

        await new Promise((r) => setTimeout(r, 500));
        controller.abort();

        await pending;
        const elapsed = Date.now() - started;

        await watcher.close();
        await single.destroy();

        // The side checkout can only be served by this file's own connection,
        // so the cancel is never sent and the file must not wait out the 5s.
        expect(elapsed).toBeLessThan(2_500);

    }, 30_000);

    it('should stop the running statement on the server when the signal aborts', async () => {

        const controller = new AbortController();
        const watcher = new StatementWatcher(db, { dialect: 'postgres', signal: controller.signal, ...WATCH });
        const started = Date.now();

        const pending = watcher.run('sleep.sql', db, (conn) => sql`select pg_sleep(20)`.execute(conn));

        await new Promise((r) => setTimeout(r, 500));
        controller.abort();

        const outcome = await pending.then(() => null, (err: Error) => err);
        await watcher.close();

        expect(outcome?.message).toContain('canceling statement due to user request');
        expect(Date.now() - started).toBeLessThan(5_000);

    }, 30_000);

});

describe('integration: mysql statement watcher', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;
    let reports: Report[];
    let stopListening: () => void;

    beforeAll(async () => {

        await skipIfNoContainer('mysql');

        const conn = await createTestConnection('mysql');
        db = conn.db;
        destroy = conn.destroy;

    });

    afterAll(async () => {

        if (destroy) await destroy();

    });

    beforeEach(() => {

        reports = [];
        stopListening = observer.on('file:progress', (data) => {

            reports.push(data);

        });

    });

    afterEach(() => stopListening());

    it('should report on and then kill a running query', async () => {

        const controller = new AbortController();
        const watcher = new StatementWatcher(db, { dialect: 'mysql', signal: controller.signal, ...WATCH });
        const started = Date.now();

        const pending = watcher.run('sleep.sql', db, (conn) => sql`select sleep(20)`.execute(conn));

        const report = await waitForReport(reports, (r) => r.status !== null);
        controller.abort();

        await pending.then(() => null, () => null);
        await watcher.close();

        expect(report!.sessionId).not.toBeNull();
        expect(report!.status!.state).toBe('User sleep');
        expect(Date.now() - started).toBeLessThan(5_000);

    }, 30_000);

});
