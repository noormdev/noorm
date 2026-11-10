/** Context.withConnection() where no server is involved: SQLite, schema scoping, and the connected guard. */
import { afterEach, describe, expect, it } from 'bun:test';
import { attempt } from '@logosdx/utils';
import { sql } from 'kysely';

import { Context, DisconnectedError, NotConnectedError } from '../../src/sdk/index.js';
import type { PinnedConnection } from '../../src/sdk/index.js';
import { makeTestConfig } from '../utils/db.js';

interface AuxDb { item: { id: number } }

describe('sdk: withConnection on sqlite', () => {

    let ctx: Context | undefined;

    function create(): Context {

        ctx = new Context(
            makeTestConfig('with_connection_sqlite', { dialect: 'sqlite', database: ':memory:' }),
            {}, { name: 'tester', source: 'system' }, {}, '/tmp/test',
        );

        return ctx;

    }

    afterEach(async () => {

        await ctx?.disconnect();
        ctx = undefined;

    });

    it('should require a connected context', async () => {

        // Same guard as every other connected call, so a forgotten connect() fails the same way everywhere.
        const context = create();

        const [, err] = await attempt(() => context.withConnection(async () => 'unreachable'));

        expect(err).toBeInstanceOf(NotConnectedError);

    });

    it('should return what the callback returns', async () => {

        const context = create();
        await context.connect();

        const value = await context.withConnection(async (db) => (await sql<{ n: number }>`select 41 + 1 as n`.execute(db)).rows[0]!.n);

        expect(value).toBe(42);

    });

    it('should keep the database usable after discard()', async () => {

        // SQLite has one in-process connection; closing it would lose a :memory: database.
        const context = create();
        await context.connect();
        await sql`create table item (id integer primary key)`.execute(context.kysely);

        await context.withConnection(async (db, connection: PinnedConnection) => {

            await sql`insert into item (id) values (1)`.execute(db);
            connection.discard();

        });

        const rows = await sql<{ id: number }>`select id from item`.execute(context.kysely);

        expect(rows.rows).toEqual([{ id: 1 }]);

    });

    it('should scope the pinned connection to the schema of a derived context', async () => {

        // ctx.kysely is schema-scoped on a derived context; the pinned instance must not silently differ.
        const context = create();
        await context.connect();
        await sql`attach database ':memory:' as aux`.execute(context.kysely);
        await sql`create table aux.item (id integer primary key)`.execute(context.kysely);
        await sql`insert into aux.item (id) values (7)`.execute(context.kysely);

        const rows = await context.withSchema<AuxDb>('aux').withConnection((db) => db.selectFrom('item').select('id').execute());

        expect(rows).toEqual([{ id: 7 }]);

    });

    it('should let disconnect() finish while a callback is still running', async () => {

        // Shutdown must not depend on a callback that may never return.
        const context = create();
        await context.connect();
        const started = Promise.withResolvers<void>();
        const stuck = Promise.withResolvers<void>();

        const running = attempt(() => context.withConnection(async () => {

            started.resolve();

            await stuck.promise;

        }));
        await started.promise;

        const disconnected = await Promise.race([
            context.disconnect().then(() => true),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000)),
        ]);
        const [, err] = await running;

        stuck.resolve();

        expect(disconnected).toBe(true);
        expect(err).toBeInstanceOf(DisconnectedError);

    });

});
