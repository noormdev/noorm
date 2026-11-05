/**
 * Postgres routines are called unqualified through a withSchema context, so
 * most tests also cover schema qualification. Fixture names carry a per-run
 * id: the containers are shared.
 */
import { randomUUID } from 'node:crypto';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { attempt } from '@logosdx/utils';

import { Context } from '../../../src/sdk/context.js';
import {
    createTestConnection,
    skipIfNoContainer,
    makeTestConfig,
    TEST_CONNECTIONS,
} from '../../utils/db.js';

import type { ConnectionResult } from '../../../src/core/connection/types.js';

const runId = randomUUID().slice(0, 8);

interface Entry { id: number }
interface SlowRow { n: number }
interface AcctDB { entries: Entry }

interface AcctProcs {
    'add_entry': [{ p_id: number }, void];
    'list_entries': [void, Entry];
    'add_entry_fn': [{ p_id: number }, Entry];
    'AddEntry': [{ p_id: number }, void];
}

interface AcctTvfs {
    'slow_rows': [void, SlowRow];
}

async function runAll<DB>(db: Kysely<DB>, statements: string[]): Promise<void> {

    for (const statement of statements) {

        await sql.raw(statement).execute(db);

    }

}

describe('integration: postgres transaction routines', () => {

    const schema = `trx_routines_${runId}`;

    let conn: ConnectionResult;
    let acct: Context<AcctDB, AcctProcs, object, AcctTvfs>;

    async function countEntries(): Promise<number> {

        const result = await sql<{ count: number }>`SELECT count(*)::int AS count FROM ${sql.table(`${schema}.entries`)}`.execute(conn.db);

        return result.rows[0]?.count ?? -1;

    }

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        conn = await createTestConnection('postgres');

        await runAll(conn.db, [
            `CREATE SCHEMA "${schema}"`,
            `CREATE TABLE "${schema}".entries (id integer PRIMARY KEY)`,
            `CREATE PROCEDURE "${schema}".add_entry(p_id integer) LANGUAGE sql AS $$
                INSERT INTO "${schema}".entries (id) VALUES (p_id)
            $$`,
            `CREATE PROCEDURE "${schema}"."AddEntry"(p_id integer) LANGUAGE sql AS $$
                INSERT INTO "${schema}".entries (id) VALUES (p_id)
            $$`,
            `CREATE FUNCTION "${schema}".list_entries() RETURNS SETOF "${schema}".entries LANGUAGE sql AS $$
                SELECT * FROM "${schema}".entries ORDER BY id
            $$`,
            `CREATE FUNCTION "${schema}".add_entry_fn(p_id integer) RETURNS SETOF "${schema}".entries LANGUAGE sql AS $$
                INSERT INTO "${schema}".entries (id) VALUES (p_id) RETURNING *
            $$`,
            `CREATE FUNCTION "${schema}".slow_rows() RETURNS TABLE (n integer) LANGUAGE plpgsql AS $$
                BEGIN
                    PERFORM pg_sleep(1.5);
                    RETURN QUERY SELECT generate_series(1, 2);
                END
            $$`,
        ]);

        const root = new Context<AcctDB, AcctProcs, object, AcctTvfs>(
            makeTestConfig('test-pg-trx-routines', TEST_CONNECTIONS.postgres),
            {}, { name: 'tester', source: 'system' }, {}, '/tmp/test-project',
        );

        acct = root.withSchema(schema);

        // Stands in for the getter's schema wrap over a guarded test connection.
        Object.defineProperty(acct, 'kysely', { value: conn.db.withSchema(schema), configurable: true });

    }, 30_000);

    afterAll(async () => {

        if (!conn) return;

        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(conn.db);
        await conn.destroy();

    });

    beforeEach(async () => {

        await sql.raw(`TRUNCATE "${schema}".entries`).execute(conn.db);

    });

    it('should cancel trx.tvf with SQLSTATE 57014 under SET LOCAL statement_timeout', async () => {

        const [, err] = await attempt(() => acct.transaction(async (trx) => {

            await sql`SET LOCAL statement_timeout = '200ms'`.execute(trx);

            return trx.tvf('slow_rows');

        }));

        expect(err).toMatchObject({ code: '57014' });

    });

    it('should return the slow tvf rows when no timeout is set', async () => {

        const rows = await acct.transaction((trx) => trx.tvf('slow_rows'));

        expect(rows).toEqual([{ n: 1 }, { n: 2 }]);

    });

    it('should roll back a trx.proc write when the callback throws', async () => {

        const boom = new Error('boom');
        let countInside = -1;

        const [, err] = await attempt(() => acct.transaction(async (trx) => {

            await trx.proc('add_entry', { p_id: 1 });

            countInside = (await trx.selectFrom('entries').selectAll().execute()).length;

            throw boom;

        }));

        expect(err).toBe(boom);
        expect(countInside).toBe(1);
        expect(await countEntries()).toBe(0);

    });

    it('should commit a trx.proc write when the callback returns', async () => {

        await acct.transaction((trx) => trx.proc('add_entry', { p_id: 1 }));

        expect(await countEntries()).toBe(1);

    });

    it('should SELECT a FUNCTION via trx.proc and keep the transaction usable', async () => {

        const entries = await acct.transaction(async (trx) => {

            await trx.proc('add_entry', { p_id: 1 });

            const rows = await trx.proc('list_entries');

            await trx.proc('add_entry', { p_id: 2 });

            return rows;

        });

        expect(entries).toEqual([{ id: 1 }]);
        expect(await countEntries()).toBe(2);

    });

    it('should commit concurrent trx.proc calls and a sibling insert on one handle', async () => {

        const [fnRows] = await acct.transaction((trx) => Promise.all([
            trx.proc('add_entry_fn', { p_id: 2 }),
            // Delayed one round trip so the insert lands while the FUNCTION call is in flight.
            sql`SELECT 1`.execute(trx).then(() => trx.insertInto('entries').values({ id: 3 }).execute()),
            trx.proc('add_entry', { p_id: 1 }),
        ]));

        expect(fnRows).toEqual([{ id: 2 }]);
        expect(await countEntries()).toBe(3);

    });

    it('should CALL a mixed-case procedure inside a transaction', async () => {

        await acct.transaction((trx) => trx.proc('AddEntry', { p_id: 1 }));

        expect(await countEntries()).toBe(1);

    });

    it('should resolve an unqualified trx.proc on the search path', async () => {

        const root = new Context<AcctDB, AcctProcs, object, AcctTvfs>(
            makeTestConfig('test-pg-trx-routines-root', TEST_CONNECTIONS.postgres),
            {}, { name: 'tester', source: 'system' }, {}, '/tmp/test-project',
        );

        Object.defineProperty(root, 'kysely', { value: conn.db, configurable: true });

        const entries = await root.transaction(async (trx) => {

            await sql`SET LOCAL search_path = ${sql.id(schema)}`.execute(trx);
            await trx.proc('add_entry', { p_id: 1 });

            return trx.proc('list_entries');

        });

        expect(entries).toEqual([{ id: 1 }]);

    });

});

describe('integration: mssql transaction routines', () => {

    const tvfName = `fn_trx_rows_${runId}`;

    let conn: ConnectionResult;
    let ctx: Context<unknown, object, object, Record<string, [void, SlowRow]>>;

    beforeAll(async () => {

        await skipIfNoContainer('mssql');

        conn = await createTestConnection('mssql');

        await sql.raw(`CREATE FUNCTION dbo.${tvfName}() RETURNS TABLE AS RETURN (SELECT 1 AS n UNION ALL SELECT 2 AS n)`).execute(conn.db);

        ctx = new Context(
            makeTestConfig('test-mssql-trx-routines', TEST_CONNECTIONS.mssql),
            {}, { name: 'tester', source: 'system' }, {}, '/tmp/test-project',
        );

        Object.defineProperty(ctx, 'kysely', { value: conn.db, configurable: true });

    }, 30_000);

    afterAll(async () => {

        if (!conn) return;

        await sql.raw(`DROP FUNCTION IF EXISTS dbo.${tvfName}`).execute(conn.db);
        await conn.destroy();

    });

    it('should return trx.tvf rows inside a transaction', async () => {

        const rows = await ctx.transaction((trx) => trx.tvf(`dbo.${tvfName}`));

        expect(rows).toEqual([{ n: 1 }, { n: 2 }]);

    });

});
