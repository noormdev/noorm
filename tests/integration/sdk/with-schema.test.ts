/**
 * Integration tests for Context.withSchema() against live databases.
 *
 * Provisions three schemas per dialect via the native qualifier (schemas
 * on postgres/mssql, databases on mysql, ATTACHed databases on sqlite),
 * each with a distinct table shape and TypeScript type, then proves:
 *
 *  - derived-context isolation under interleaved reads/writes across
 *    three derived contexts plus the parent
 *  - transaction() inherits schema scoping from a derived context
 *  - impersonate() composes with a derived context (postgres/mssql only —
 *    mysql/sqlite have no impersonation strategy, dialect-strategy.ts)
 *  - parent.disconnect() releases a held connection opened through a
 *    derived context (postgres/mssql only, same reason)
 *
 * Schema/database names are suffixed with a per-run random id so
 * concurrent runs against the same shared docker-compose.test.yml
 * containers (e.g. two worktrees testing at once) never collide.
 *
 * Requires docker-compose.test.yml containers (postgres 15432, mysql
 * 13306, mssql 11433); sqlite runs in-process, no container needed.
 */
import { randomUUID } from 'node:crypto';

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Kysely, sql } from 'kysely';
import { attempt } from '@logosdx/utils';

import { Context } from '../../../src/sdk/context.js';
import { createConnection } from '../../../src/core/connection/factory.js';
import {
    skipIfNoContainer,
    makeTestConfig,
    TEST_CONNECTIONS,
} from '../../utils/db.js';

import type { ConnectionResult } from '../../../src/core/connection/types.js';

// ─────────────────────────────────────────────────────────────
// Fixture shapes
// ─────────────────────────────────────────────────────────────

/** Parent's own table lives in the connection's default (unqualified) schema. */
interface ParentItem { id: number; sku: string }
interface AItem { id: number; label: string }
interface BItem { id: number; quantity: number }
interface CItem { id: number; weight: number; unit: string }

/**
 * Table name is generated per-run (`items_parent_<runId>`), so the DB
 * shape is keyed by an index signature rather than a literal — there is
 * no compile-time-known table name to key a plain interface on.
 */
interface ParentDb { [table: string]: ParentItem }
interface ADb { items: AItem }
interface BDb { items: BItem }
interface CDb { items: CItem }

interface SchemaNames { a: string; b: string; c: string }

const runId = randomUUID().slice(0, 8);

function makeSchemaNames(prefix: string): SchemaNames {

    return {
        a: `wschema_${prefix}_a_${runId}`,
        b: `wschema_${prefix}_b_${runId}`,
        c: `wschema_${prefix}_c_${runId}`,
    };

}

async function runAll<DB>(db: Kysely<DB>, statements: string[]): Promise<void> {

    for (const statement of statements) {

        await sql.raw(statement).execute(db);

    }

}

/**
 * Run idempotent `DROP ... IF EXISTS` teardown statements, swallowing any
 * per-statement error so one already-missing object doesn't abort the rest
 * of `afterAll` cleanup. Teardown-only — every call site passes `IF EXISTS`
 * DROP statements; this is not a general-purpose "run and ignore errors"
 * helper for non-teardown code paths.
 */
async function dropIgnoringErrors<DB>(db: Kysely<DB>, statements: string[]): Promise<void> {

    for (const statement of statements) {

        await attempt(() => sql.raw(statement).execute(db));

    }

}

/**
 * Interleave inserts and updates across the parent and all three derived
 * contexts, then read each back through its own context.
 *
 * Every table is named `items` (or, for the parent, a unique generated
 * name) but carries a distinct column shape per schema — a qualifier bug
 * that lets a derived context fall through to the wrong schema, or lets
 * two contexts collide on one physical table, surfaces as a thrown
 * "column does not exist" error or a mismatched/duplicated row here,
 * never as a silent pass.
 */
async function assertInterleavedIsolation(fixture: {
    parent: { ctx: Context<ParentDb>; table: string };
    a: { ctx: Context<ADb> };
    b: { ctx: Context<BDb> };
    c: { ctx: Context<CDb> };
}): Promise<void> {

    const { parent, a, b, c } = fixture;

    const parentRow: ParentItem = { id: 1, sku: 'PARENT-SKU-1' };
    const aRow: AItem = { id: 1, label: 'widget-a' };
    const bRow: BItem = { id: 1, quantity: 7 };
    const cRow: CItem = { id: 1, weight: 12, unit: 'kg' };

    // Round 1 — interleaved inserts, scrambled order, run concurrently.
    await Promise.all([
        b.ctx.kysely.insertInto('items').values(bRow).execute(),
        parent.ctx.kysely.insertInto(parent.table).values(parentRow).execute(),
        a.ctx.kysely.insertInto('items').values(aRow).execute(),
        c.ctx.kysely.insertInto('items').values(cRow).execute(),
    ]);

    const [cRows1, aRows1, parentRows1, bRows1] = await Promise.all([
        c.ctx.kysely.selectFrom('items').selectAll().execute(),
        a.ctx.kysely.selectFrom('items').selectAll().execute(),
        parent.ctx.kysely.selectFrom(parent.table).selectAll().execute(),
        b.ctx.kysely.selectFrom('items').selectAll().execute(),
    ]);

    expect(aRows1).toEqual([aRow]);
    expect(bRows1).toEqual([bRow]);
    expect(cRows1).toEqual([cRow]);
    expect(parentRows1).toEqual([parentRow]);

    // Round 2 — interleaved updates in a different scramble, proving
    // isolation holds across a second wave, not just the initial write.
    const aRowV2 = { ...aRow, label: 'widget-a-v2' };
    const bRowV2 = { ...bRow, quantity: 8 };
    const cRowV2 = { ...cRow, weight: 13 };
    const parentRowV2 = { ...parentRow, sku: 'PARENT-SKU-1-v2' };

    await Promise.all([
        a.ctx.kysely.updateTable('items').set({ label: aRowV2.label }).where('id', '=', 1).execute(),
        c.ctx.kysely.updateTable('items').set({ weight: cRowV2.weight }).where('id', '=', 1).execute(),
        parent.ctx.kysely.updateTable(parent.table).set({ sku: parentRowV2.sku }).where('id', '=', 1).execute(),
        b.ctx.kysely.updateTable('items').set({ quantity: bRowV2.quantity }).where('id', '=', 1).execute(),
    ]);

    const [parentRows2, bRows2, aRows2, cRows2] = await Promise.all([
        parent.ctx.kysely.selectFrom(parent.table).selectAll().execute(),
        b.ctx.kysely.selectFrom('items').selectAll().execute(),
        a.ctx.kysely.selectFrom('items').selectAll().execute(),
        c.ctx.kysely.selectFrom('items').selectAll().execute(),
    ]);

    expect(aRows2).toEqual([aRowV2]);
    expect(bRows2).toEqual([bRowV2]);
    expect(cRows2).toEqual([cRowV2]);
    expect(parentRows2).toEqual([parentRowV2]);

}

// ─────────────────────────────────────────────────────────────
// PostgreSQL
// ─────────────────────────────────────────────────────────────

describe('integration: sdk withSchema postgres', () => {

    const names = makeSchemaNames('pg');
    const parentTable = `items_parent_pg_${runId}`;
    const TEST_ROLE = `wschema_pg_role_${runId}`;

    let ctx: Context<ParentDb>;
    let a: Context<ADb>;
    let b: Context<BDb>;
    let c: Context<CDb>;

    async function dropRoleCompletely(db: Kysely<unknown>): Promise<void> {

        await sql.raw(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${TEST_ROLE}') THEN
                    EXECUTE 'DROP OWNED BY ${TEST_ROLE}';
                    EXECUTE 'DROP ROLE ${TEST_ROLE}';
                END IF;
            END $$;
        `).execute(db);

    }

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        ctx = new Context(
            makeTestConfig('pg_with_schema', TEST_CONNECTIONS.postgres),
            {}, { name: 'tester', source: 'system' }, {}, '/tmp/test',
        );
        await ctx.connect();

        await runAll(ctx.kysely, [
            `CREATE SCHEMA "${names.a}"`,
            `CREATE SCHEMA "${names.b}"`,
            `CREATE SCHEMA "${names.c}"`,
            `CREATE TABLE "${names.a}"."items" (id integer primary key, label text not null)`,
            `CREATE TABLE "${names.b}"."items" (id integer primary key, quantity integer not null)`,
            `CREATE TABLE "${names.c}"."items" (id integer primary key, weight integer not null, unit text not null)`,
            `CREATE TABLE "${parentTable}" (id integer primary key, sku text not null)`,
            `CREATE ROLE ${TEST_ROLE} LOGIN PASSWORD 'test123'`,
            `GRANT ${TEST_ROLE} TO noorm_test WITH SET true`,
            `GRANT USAGE ON SCHEMA "${names.a}" TO ${TEST_ROLE}`,
            `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "${names.a}" TO ${TEST_ROLE}`,
        ]);

        a = ctx.withSchema<ADb>(names.a);
        b = ctx.withSchema<BDb>(names.b);
        c = ctx.withSchema<CDb>(names.c);

    }, 30_000);

    afterAll(async () => {

        if (!ctx?.connected) return;

        await dropRoleCompletely(ctx.kysely);
        await dropIgnoringErrors(ctx.kysely, [
            `DROP TABLE IF EXISTS "${parentTable}"`,
            `DROP SCHEMA IF EXISTS "${names.a}" CASCADE`,
            `DROP SCHEMA IF EXISTS "${names.b}" CASCADE`,
            `DROP SCHEMA IF EXISTS "${names.c}" CASCADE`,
        ]);
        await ctx.disconnect();

    });

    it('provisions three schemas with distinct shapes and isolates interleaved reads/writes across the parent and all three', async () => {

        await assertInterleavedIsolation({
            parent: { ctx, table: parentTable },
            a: { ctx: a },
            b: { ctx: b },
            c: { ctx: c },
        });

    });

    it('transaction() inherits schema scoping from a derived context', async () => {

        await a.transaction(async (trx) => {

            await trx.insertInto('items').values({ id: 2, label: 'via-transaction' }).execute();

        });

        const ownRows = await a.kysely.selectFrom('items').selectAll().where('id', '=', 2).execute();
        expect(ownRows).toEqual([{ id: 2, label: 'via-transaction' }]);

        // The transaction ran scoped to schema A — not silently against a
        // sibling schema.
        const siblingRows = await b.kysely.selectFrom('items').selectAll().where('id', '=', 2).execute();
        expect(siblingRows).toEqual([]);

    });

    it('impersonate() composes with a derived context — resolves against the derived schema', async () => {

        const result = await a.impersonate(TEST_ROLE, async (scope) => {

            const identity = await sql<{ username: string }>`SELECT current_user AS username`.execute(scope.kysely);

            await scope.kysely.insertInto('items').values({ id: 3, label: 'via-impersonation' }).execute();
            const rows = await scope.kysely.selectFrom('items').selectAll().where('id', '=', 3).execute();

            return { username: identity.rows[0]!.username, rows };

        });

        expect(result.username).toBe(TEST_ROLE);
        expect(result.rows).toEqual([{ id: 3, label: 'via-impersonation' }]);

    });

    it('parent.disconnect() releases a held connection opened through a derived context', async () => {

        const leaky = new Context(
            makeTestConfig('pg_with_schema_leak', TEST_CONNECTIONS.postgres),
            {}, { name: 'tester', source: 'system' }, {}, '/tmp/test',
        );
        await leaky.connect();

        const leakyA = leaky.withSchema<ADb>(names.a);

        // Explicit mode, deliberately never reverted.
        await leakyA.impersonate(TEST_ROLE);

        const [, err] = await attempt(() => Promise.race([
            leaky.disconnect(),
            new Promise((_, reject) => setTimeout(
                () => reject(new Error('disconnect() hung')),
                5000,
            ).unref()),
        ]));

        expect(err).toBeNull();
        expect(leaky.connected).toBe(false);

    }, 15_000);

});

// ─────────────────────────────────────────────────────────────
// MySQL
// ─────────────────────────────────────────────────────────────

describe('integration: sdk withSchema mysql', () => {

    const names = makeSchemaNames('mysql');
    const parentTable = `items_parent_mysql_${runId}`;

    let ctx: Context<ParentDb>;
    let a: Context<ADb>;
    let b: Context<BDb>;
    let c: Context<CDb>;
    let systemConn: ConnectionResult;

    beforeAll(async () => {

        await skipIfNoContainer('mysql');

        const { database: _unused, ...mysqlNoDb } = TEST_CONNECTIONS.mysql;

        systemConn = await createConnection({
            ...mysqlNoDb,
            user: 'root',
            database: 'information_schema',
        }, 'system');

        for (const name of [names.a, names.b, names.c]) {

            await sql.raw(`CREATE DATABASE \`${name}\``).execute(systemConn.db);
            await sql.raw(
                `GRANT ALL PRIVILEGES ON \`${name}\`.* TO '${TEST_CONNECTIONS.mysql.user}'@'%'`,
            ).execute(systemConn.db);

        }
        await sql.raw('FLUSH PRIVILEGES').execute(systemConn.db);

        ctx = new Context(
            makeTestConfig('mysql_with_schema', TEST_CONNECTIONS.mysql),
            {}, { name: 'tester', source: 'system' }, {}, '/tmp/test',
        );
        await ctx.connect();

        await runAll(ctx.kysely, [
            `CREATE TABLE \`${names.a}\`.items (id INT PRIMARY KEY, label VARCHAR(64) NOT NULL)`,
            `CREATE TABLE \`${names.b}\`.items (id INT PRIMARY KEY, quantity INT NOT NULL)`,
            `CREATE TABLE \`${names.c}\`.items (id INT PRIMARY KEY, weight INT NOT NULL, unit VARCHAR(16) NOT NULL)`,
            `CREATE TABLE \`${parentTable}\` (id INT PRIMARY KEY, sku VARCHAR(64) NOT NULL)`,
        ]);

        a = ctx.withSchema<ADb>(names.a);
        b = ctx.withSchema<BDb>(names.b);
        c = ctx.withSchema<CDb>(names.c);

    }, 30_000);

    afterAll(async () => {

        if (ctx?.connected) {

            await dropIgnoringErrors(ctx.kysely, [`DROP TABLE IF EXISTS \`${parentTable}\``]);
            await ctx.disconnect();

        }

        if (systemConn) {

            for (const name of [names.a, names.b, names.c]) {

                await attempt(() => sql.raw(`DROP DATABASE IF EXISTS \`${name}\``).execute(systemConn.db));

            }
            await systemConn.destroy();

        }

    });

    it('provisions three databases with distinct shapes and isolates interleaved reads/writes across the parent and all three', async () => {

        await assertInterleavedIsolation({
            parent: { ctx, table: parentTable },
            a: { ctx: a },
            b: { ctx: b },
            c: { ctx: c },
        });

    });

    it('transaction() inherits schema scoping from a derived context', async () => {

        await a.transaction(async (trx) => {

            await trx.insertInto('items').values({ id: 2, label: 'via-transaction' }).execute();

        });

        const ownRows = await a.kysely.selectFrom('items').selectAll().where('id', '=', 2).execute();
        expect(ownRows).toEqual([{ id: 2, label: 'via-transaction' }]);

        const siblingRows = await b.kysely.selectFrom('items').selectAll().where('id', '=', 2).execute();
        expect(siblingRows).toEqual([]);

    });

    // No impersonate()/held-connection coverage here — dialectStrategy.mysql
    // is null (src/sdk/impersonate/dialect-strategy.ts), so Context.impersonate()
    // throws before borrowing a connection. Nothing to compose against.

});

// ─────────────────────────────────────────────────────────────
// MSSQL
// ─────────────────────────────────────────────────────────────

describe('integration: sdk withSchema mssql', () => {

    const names = makeSchemaNames('mssql');
    const parentTable = `items_parent_mssql_${runId}`;
    const TEST_USER = `wschema_mssql_user_${runId}`;

    let ctx: Context<ParentDb>;
    let a: Context<ADb>;
    let b: Context<BDb>;
    let c: Context<CDb>;

    beforeAll(async () => {

        await skipIfNoContainer('mssql');

        ctx = new Context(
            makeTestConfig('mssql_with_schema', TEST_CONNECTIONS.mssql),
            {}, { name: 'tester', source: 'system' }, {}, '/tmp/test',
        );
        await ctx.connect();

        await runAll(ctx.kysely, [
            `CREATE SCHEMA [${names.a}]`,
            `CREATE SCHEMA [${names.b}]`,
            `CREATE SCHEMA [${names.c}]`,
            `CREATE TABLE [${names.a}].items (id INT PRIMARY KEY, label NVARCHAR(64) NOT NULL)`,
            `CREATE TABLE [${names.b}].items (id INT PRIMARY KEY, quantity INT NOT NULL)`,
            `CREATE TABLE [${names.c}].items (id INT PRIMARY KEY, weight INT NOT NULL, unit NVARCHAR(16) NOT NULL)`,
            `CREATE TABLE [${parentTable}] (id INT PRIMARY KEY, sku NVARCHAR(64) NOT NULL)`,
            `CREATE USER [${TEST_USER}] WITHOUT LOGIN`,
            `GRANT SELECT, INSERT, UPDATE ON SCHEMA::[${names.a}] TO [${TEST_USER}]`,
        ]);

        a = ctx.withSchema<ADb>(names.a);
        b = ctx.withSchema<BDb>(names.b);
        c = ctx.withSchema<CDb>(names.c);

    }, 30_000);

    afterAll(async () => {

        if (!ctx?.connected) return;

        await dropIgnoringErrors(ctx.kysely, [
            `DROP USER IF EXISTS [${TEST_USER}]`,
            `DROP TABLE IF EXISTS [${parentTable}]`,
            `DROP TABLE IF EXISTS [${names.a}].items`,
            `DROP TABLE IF EXISTS [${names.b}].items`,
            `DROP TABLE IF EXISTS [${names.c}].items`,
            `DROP SCHEMA IF EXISTS [${names.a}]`,
            `DROP SCHEMA IF EXISTS [${names.b}]`,
            `DROP SCHEMA IF EXISTS [${names.c}]`,
        ]);
        await ctx.disconnect();

    });

    it('provisions three schemas with distinct shapes and isolates interleaved reads/writes across the parent and all three', async () => {

        await assertInterleavedIsolation({
            parent: { ctx, table: parentTable },
            a: { ctx: a },
            b: { ctx: b },
            c: { ctx: c },
        });

    });

    it('transaction() inherits schema scoping from a derived context', async () => {

        await a.transaction(async (trx) => {

            await trx.insertInto('items').values({ id: 2, label: 'via-transaction' }).execute();

        });

        const ownRows = await a.kysely.selectFrom('items').selectAll().where('id', '=', 2).execute();
        expect(ownRows).toEqual([{ id: 2, label: 'via-transaction' }]);

        const siblingRows = await b.kysely.selectFrom('items').selectAll().where('id', '=', 2).execute();
        expect(siblingRows).toEqual([]);

    });

    it('impersonate() composes with a derived context — resolves against the derived schema', async () => {

        const result = await a.impersonate(TEST_USER, async (scope) => {

            const identity = await sql<{ username: string }>`SELECT USER_NAME() AS username`.execute(scope.kysely);

            await scope.kysely.insertInto('items').values({ id: 3, label: 'via-impersonation' }).execute();
            const rows = await scope.kysely.selectFrom('items').selectAll().where('id', '=', 3).execute();

            return { username: identity.rows[0]!.username, rows };

        });

        expect(result.username).toBe(TEST_USER);
        expect(result.rows).toEqual([{ id: 3, label: 'via-impersonation' }]);

    });

    it('parent.disconnect() releases a held connection opened through a derived context', async () => {

        const leaky = new Context(
            makeTestConfig('mssql_with_schema_leak', TEST_CONNECTIONS.mssql),
            {}, { name: 'tester', source: 'system' }, {}, '/tmp/test',
        );
        await leaky.connect();

        const leakyA = leaky.withSchema<ADb>(names.a);

        // Explicit mode, deliberately never reverted.
        await leakyA.impersonate(TEST_USER);

        const [, err] = await attempt(() => Promise.race([
            leaky.disconnect(),
            new Promise((_, reject) => setTimeout(
                () => reject(new Error('disconnect() hung')),
                5000,
            ).unref()),
        ]));

        expect(err).toBeNull();
        expect(leaky.connected).toBe(false);

    }, 15_000);

});

// ─────────────────────────────────────────────────────────────
// SQLite
// ─────────────────────────────────────────────────────────────

describe('integration: sdk withSchema sqlite', () => {

    const names = makeSchemaNames('sqlite');
    const parentTable = `items_parent_sqlite_${runId}`;

    let ctx: Context<ParentDb>;
    let a: Context<ADb>;
    let b: Context<BDb>;
    let c: Context<CDb>;

    beforeAll(async () => {

        ctx = new Context(
            makeTestConfig('sqlite_with_schema', TEST_CONNECTIONS.sqlite),
            {}, { name: 'tester', source: 'system' }, {}, '/tmp/test',
        );
        await ctx.connect();

        // In-memory ATTACHed databases — no file, no cleanup needed beyond
        // closing the connection. sqlite's native "schema" qualifier.
        await runAll(ctx.kysely, [
            `ATTACH DATABASE ':memory:' AS "${names.a}"`,
            `ATTACH DATABASE ':memory:' AS "${names.b}"`,
            `ATTACH DATABASE ':memory:' AS "${names.c}"`,
            `CREATE TABLE "${names.a}"."items" (id INTEGER PRIMARY KEY, label TEXT NOT NULL)`,
            `CREATE TABLE "${names.b}"."items" (id INTEGER PRIMARY KEY, quantity INTEGER NOT NULL)`,
            `CREATE TABLE "${names.c}"."items" (id INTEGER PRIMARY KEY, weight INTEGER NOT NULL, unit TEXT NOT NULL)`,
            `CREATE TABLE "${parentTable}" (id INTEGER PRIMARY KEY, sku TEXT NOT NULL)`,
        ]);

        a = ctx.withSchema<ADb>(names.a);
        b = ctx.withSchema<BDb>(names.b);
        c = ctx.withSchema<CDb>(names.c);

    });

    afterAll(async () => {

        if (!ctx?.connected) return;

        // Attached in-memory databases vanish with the connection — no
        // DETACH/DROP needed, unlike the file-backed dialects above.
        await ctx.disconnect();

    });

    it('provisions three ATTACHed databases with distinct shapes and isolates interleaved reads/writes across the parent and all three', async () => {

        await assertInterleavedIsolation({
            parent: { ctx, table: parentTable },
            a: { ctx: a },
            b: { ctx: b },
            c: { ctx: c },
        });

    });

    it('transaction() inherits schema scoping from a derived context', async () => {

        await a.transaction(async (trx) => {

            await trx.insertInto('items').values({ id: 2, label: 'via-transaction' }).execute();

        });

        const ownRows = await a.kysely.selectFrom('items').selectAll().where('id', '=', 2).execute();
        expect(ownRows).toEqual([{ id: 2, label: 'via-transaction' }]);

        const siblingRows = await b.kysely.selectFrom('items').selectAll().where('id', '=', 2).execute();
        expect(siblingRows).toEqual([]);

    });

    // No impersonate()/held-connection coverage here — dialectStrategy.sqlite
    // is null (src/sdk/impersonate/dialect-strategy.ts), so Context.impersonate()
    // throws before borrowing a connection. Nothing to compose against.

});
