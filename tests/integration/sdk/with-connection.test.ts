/**
 * Context.withConnection() and connection.discard() against live servers.
 *
 * A discard only counts if the server closed the session, so every assertion
 * is made from a second connection looking at what the server still has open.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { attempt } from '@logosdx/utils';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import type { ConnectionResult, Dialect } from '../../../src/core/connection/types.js';
import { observer, type NoormEvents } from '../../../src/core/observer.js';
import { Context } from '../../../src/sdk/context.js';
import { DisconnectedError } from '../../../src/sdk/index.js';
import type { PinnedConnection } from '../../../src/sdk/index.js';
import { TEST_CONNECTIONS, assertTestDatabase, createTestConnection, makeTestConfig, skipIfNoContainer } from '../../utils/db.js';

type ServerDialect = Exclude<Dialect, 'sqlite'>;

/** MSSQL reuses a session number as soon as it is free, so its identifier includes the login time. */
const SESSIONS: Record<ServerDialect, { session: string; sleep: string; open: (id: string) => ReturnType<typeof sql<{ n: number }>> }> = {
    postgres: {
        sleep: 'select pg_sleep(3)',
        session: 'select pg_backend_pid()::text as id',
        open: (id) => sql`select count(*)::int as n from pg_stat_activity where pid = ${Number(id)}`,
    },
    mysql: {
        sleep: 'select sleep(3)',
        session: 'select cast(connection_id() as char) as id',
        open: (id) => sql`select count(*) as n from information_schema.processlist where id = ${Number(id)}`,
    },
    mssql: {
        sleep: 'waitfor delay \'00:00:03\'',
        session: 'select concat(session_id, \':\', convert(varchar(33), login_time, 126)) as id from sys.dm_exec_sessions where session_id = @@SPID',
        open: (id) => sql`
            select count(*) as n from sys.dm_exec_sessions
            where concat(session_id, ':', convert(varchar(33), login_time, 126)) = ${id}
        `,
    },
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.each<ServerDialect>(['postgres', 'mysql', 'mssql'])('sdk: withConnection on %s', (dialect) => {

    const name = `__with_connection_${dialect}__`;
    const queries = SESSIONS[dialect];
    const events: NoormEvents['connection:error'][] = [];
    let witness: ConnectionResult;
    let ctx: Context | undefined;
    let stop: () => void;

    async function connect(max: number): Promise<Context> {

        const config = makeTestConfig(name, { ...TEST_CONNECTIONS[dialect], pool: { max } });

        assertTestDatabase(config.connection);

        ctx = new Context(config, {}, { name: 'tester', source: 'system' }, {}, '/tmp/test');
        await ctx.connect();

        return ctx;

    }

    const sessionOf = async (db: Kysely<unknown>) => (await sql<{ id: string }>`${sql.raw(queries.session)}`.execute(db)).rows[0]!.id;

    const isOpen = async (id: string) => Number((await queries.open(id).execute(witness.db)).rows[0]!.n) > 0;

    /** The server ends a session a moment after its socket closes. */
    async function closes(id: string, maxTries = 30): Promise<boolean> {

        for (let tries = 0; tries < maxTries; tries++) {

            if (!await isOpen(id)) return true;

            await wait(100);

        }

        return false;

    }

    beforeAll(async () => {

        await skipIfNoContainer(dialect);
        witness = await createTestConnection(dialect);
        stop = observer.on('connection:error', (event) => {

            if (event.configName === name) events.push(event);

        });

    });

    afterEach(async () => {

        await ctx?.disconnect();
        ctx = undefined;
        events.length = 0;

    });

    afterAll(async () => {

        stop();
        await witness.destroy();

    });

    it('should close the session of a discarded connection and run the next query on a new one', async () => {

        // The point of discard(): the session must be gone from the server, not parked in the pool.
        const context = await connect(1);

        const discarded = await context.withConnection(async (db, connection: PinnedConnection) => {

            const id = await sessionOf(db);

            connection.discard();

            return id;

        });

        expect(await closes(discarded)).toBe(true);
        expect(await context.withConnection((db) => sessionOf(db))).not.toBe(discarded);

    });

    it('should return the connection to the pool when discard() is not called', async () => {

        // Discarding is opt-in: an ordinary pinned use must not cost a reconnect.
        const context = await connect(1);

        const first = await context.withConnection((db) => sessionOf(db));
        const second = await context.withConnection((db) => sessionOf(db));

        expect(second).toBe(first);

    });

    it('should keep the connection when the callback throws without discarding', async () => {

        // A failed statement leaves a healthy session; closing on every error would empty the pool under load.
        const context = await connect(1);
        const failure = new Error('constraint violated');
        let failed = '';

        const [, err] = await attempt(() => context.withConnection(async (db) => {

            failed = await sessionOf(db);

            throw failure;

        }));

        expect(err).toBe(failure);
        expect(await context.withConnection((db) => sessionOf(db))).toBe(failed);

    });

    it('should discard and reject with the callback error when the callback discards and then throws', async () => {

        // The caller that gives up on a session usually also fails its own work; both must happen.
        const context = await connect(1);
        const failure = new Error('work failed on a dead session');
        let failed = '';

        const [, err] = await attempt(() => context.withConnection(async (db, connection) => {

            failed = await sessionOf(db);
            connection.discard();

            throw failure;

        }));

        expect(err).toBe(failure);
        expect(await closes(failed)).toBe(true);
        expect(await context.withConnection((db) => sessionOf(db))).not.toBe(failed);

    });

    it('should discard only the connection of the callback that asked for it', async () => {

        // Two callers pin at once; one caller's discard must never close the other's session.
        const context = await connect(2);
        const bothPinned = Promise.withResolvers<void>();
        let pinned = 0;

        const pin = (discard: boolean) => context.withConnection(async (db, connection) => {

            const id = await sessionOf(db);

            if (++pinned === 2) bothPinned.resolve();

            await bothPinned.promise;

            if (discard) connection.discard();

            return id;

        });

        const [discarded, kept] = await Promise.all([pin(true), pin(false)]);

        expect(kept).not.toBe(discarded);
        expect(await closes(discarded)).toBe(true);
        expect(await isOpen(kept)).toBe(true);

    });

    it('should accept repeated discard() calls', async () => {

        // Error paths often overlap, so a second call must not throw or close anything else.
        const context = await connect(1);

        const discarded = await context.withConnection(async (db, connection) => {

            connection.discard();
            connection.discard();

            return sessionOf(db);

        });

        expect(await closes(discarded)).toBe(true);
        expect(await context.withConnection((db) => sessionOf(db))).not.toBe(discarded);

    });

    it('should not report a discard as a connection error', async () => {

        // connection:error is what operators alert on; an intentional close is not a failure.
        const context = await connect(1);

        const discarded = await context.withConnection(async (db, connection) => {

            connection.discard();

            return sessionOf(db);

        });

        await closes(discarded);
        await context.withConnection((db) => sessionOf(db));
        await wait(300);

        expect(events).toEqual([]);

    });

    it('should discard only the inner connection when a nested call discards', async () => {

        // A helper that pins its own connection must not be able to close its caller's.
        const context = await connect(2);

        const ids = await context.withConnection(async (db) => {

            const outer = await sessionOf(db);
            const inner = await context.withConnection(async (innerDb, connection) => {

                connection.discard();

                return sessionOf(innerDb);

            });

            return { outer, inner, outerAfter: await sessionOf(db) };

        });

        expect(ids.inner).not.toBe(ids.outer);
        expect(ids.outerAfter).toBe(ids.outer);
        expect(await closes(ids.inner)).toBe(true);
        expect(await isOpen(ids.outer)).toBe(true);

    });

    it('should discard only the outer connection when the outer of two nested calls discards', async () => {

        const context = await connect(2);

        const ids = await context.withConnection(async (db, connection) => {

            connection.discard();

            return { outer: await sessionOf(db), inner: await context.withConnection((innerDb) => sessionOf(innerDb)) };

        });

        expect(await closes(ids.outer)).toBe(true);
        expect(await isOpen(ids.inner)).toBe(true);

    });

    it('should not discard the connection a pool query used inside the callback', async () => {

        // The callback's own ctx.kysely queries check out other connections; discard() is about the pinned one.
        const context = await connect(2);

        const ids = await context.withConnection(async (db, connection) => {

            connection.discard();

            return { pinned: await sessionOf(db), pooled: await sessionOf(context.kysely) };

        });

        expect(ids.pooled).not.toBe(ids.pinned);
        expect(await closes(ids.pinned)).toBe(true);
        expect(await isOpen(ids.pooled)).toBe(true);

    });

    it('should not discard the connection a transaction used inside the callback', async () => {

        const context = await connect(2);

        const ids = await context.withConnection(async (db, connection) => {

            connection.discard();

            return {
                pinned: await sessionOf(db),
                transacted: await context.kysely.transaction().execute((trx) => sessionOf(trx)),
            };

        });

        expect(ids.transacted).not.toBe(ids.pinned);
        expect(await closes(ids.pinned)).toBe(true);
        expect(await isOpen(ids.transacted)).toBe(true);

    });

    it('should ignore discard() on a handle kept past its callback', async () => {

        // By then the pool may have lent the same connection to someone else.
        const context = await connect(1);
        let kept: PinnedConnection | undefined;

        const first = await context.withConnection(async (db, connection) => {

            kept = connection;

            return sessionOf(db);

        });

        kept?.discard();

        const second = await context.withConnection((db) => sessionOf(db));

        expect(second).toBe(first);
        expect(await isOpen(first)).toBe(true);

    });

    it('should let disconnect() finish while a query is in flight on the pinned connection', async () => {

        // The stuck session discard() exists for is one that is busy in a statement, not one sitting idle.
        const context = await connect(1);
        const pinned = Promise.withResolvers<string>();

        const running = attempt(() => context.withConnection(async (db) => {

            pinned.resolve(await sessionOf(db));

            await sql`${sql.raw(queries.sleep)}`.execute(db);

        }));
        const id = await pinned.promise;

        await wait(200);

        const disconnected = await Promise.race([
            context.disconnect().then(() => true),
            wait(2_000).then(() => false),
        ]);
        const [, err] = await running;

        expect(disconnected).toBe(true);
        expect(err).toBeInstanceOf(DisconnectedError);
        // A server notices the closed socket only once the statement ends.
        expect(await closes(id, 80)).toBe(true);

    });

    it('should let disconnect() finish while a callback is still running', async () => {

        // A callback stuck on an unresponsive session must not be able to hold shutdown open.
        const context = await connect(1);
        const pinned = Promise.withResolvers<string>();
        const stuck = Promise.withResolvers<void>();

        const running = attempt(() => context.withConnection(async (db) => {

            pinned.resolve(await sessionOf(db));

            await stuck.promise;

        }));
        const id = await pinned.promise;

        const disconnected = await Promise.race([
            context.disconnect().then(() => true),
            wait(5_000).then(() => false),
        ]);
        const [, err] = await running;

        stuck.resolve();

        expect(disconnected).toBe(true);
        expect(err).toBeInstanceOf(DisconnectedError);
        expect(await closes(id)).toBe(true);

    });

});

describe('sdk: withConnection releases a postgres advisory lock by discarding', () => {

    const key = 7_000_000 + Math.floor(Math.random() * 1_000_000);
    let witness: ConnectionResult;
    let ctx: Context;

    const tryLock = async (db: Kysely<unknown>) =>
        (await sql<{ locked: boolean }>`select pg_try_advisory_lock(${key}) as locked`.execute(db)).rows[0]!.locked;

    const pid = async (db: Kysely<unknown>) => (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(db)).rows[0]!.pid;

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        const config = makeTestConfig('__with_connection_lock__', { ...TEST_CONNECTIONS.postgres, pool: { max: 1 } });

        assertTestDatabase(config.connection);

        witness = await createTestConnection('postgres');
        ctx = new Context(config, {}, { name: 'tester', source: 'system' }, {}, '/tmp/test');
        await ctx.connect();

    });

    afterAll(async () => {

        await ctx.disconnect();
        await witness.destroy();

    });

    it('should leave the lock held when the locking connection goes back to the pool', async () => {

        // The control: this is the stuck lock that discard() exists to clear.
        const holder = await ctx.withConnection(async (db) => {

            await sql`select pg_advisory_lock(${key})`.execute(db);

            return pid(db);

        });

        const lockedElsewhere = await tryLock(witness.db);

        const reused = await ctx.withConnection(async (db) => {

            await sql`select pg_advisory_unlock(${key})`.execute(db);

            return pid(db);

        });

        expect(lockedElsewhere).toBe(false);
        expect(reused).toBe(holder);

    });

    it('should free the lock once the locking connection is discarded', async () => {

        // Session locks die with the session, so closing it is the only release a caller can force.
        await ctx.withConnection(async (db, connection) => {

            await sql`select pg_advisory_lock(${key})`.execute(db);
            connection.discard();

        });

        const freed = await witness.db.connection().execute(async (db) => {

            for (let tries = 0; tries < 30; tries++) {

                if (await tryLock(db)) {

                    await sql`select pg_advisory_unlock(${key})`.execute(db);

                    return true;

                }

                await wait(100);

            }

            return false;

        });

        expect(freed).toBe(true);

    });

});
