/**
 * Cross-dialect transfer integration tests.
 *
 * Every other transfer test opens one dialect, which is why cross-dialect
 * transfer shipped broken: the planner probed the destination with the
 * *source* dialect, so postgres catalog SQL ran against MySQL and every
 * cross-dialect transfer aborted in the planner. `DtStreamer` — the whole
 * conversion layer — was therefore unreachable and never executed.
 *
 * Assertions compare the destination's actual contents, not the reported
 * counts: the first run of this path reported `rowsTransferred: 1,
 * rowsSkipped: 2, status: success` while dropping two thirds of the table.
 *
 * Requires both postgres and mysql containers.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { sql } from 'kysely';

import type { Kysely } from 'kysely';

import { transferData, getTransferPlan } from '../../../src/core/transfer/index.js';
import { createConnection } from '../../../src/core/connection/factory.js';
import { skipIfNoContainer, makeTestConfig, TEST_CONNECTIONS } from '../../utils/db.js';

const TABLE = 'xdialect_probe';

describe('transfer: cross-dialect postgres to mysql', () => {

    let pgDb: Kysely<unknown>;
    let myDb: Kysely<unknown>;
    let pgDestroy: () => Promise<void>;
    let myDestroy: () => Promise<void>;

    const pgConfig = makeTestConfig('xdialect_pg', { ...TEST_CONNECTIONS.postgres });
    const myConfig = makeTestConfig('xdialect_my', { ...TEST_CONNECTIONS.mysql });

    beforeAll(async () => {

        await skipIfNoContainer('postgres');
        await skipIfNoContainer('mysql');

        const pgConn = await createConnection(pgConfig.connection, 'xdialect_pg');
        pgDb = pgConn.db;
        pgDestroy = pgConn.destroy;

        const myConn = await createConnection(myConfig.connection, 'xdialect_my');
        myDb = myConn.db;
        myDestroy = myConn.destroy;

        await sql.raw(`DROP TABLE IF EXISTS ${TABLE}`).execute(pgDb);
        await sql.raw(`DROP TABLE IF EXISTS ${TABLE}`).execute(myDb);

        await sql.raw(`
            CREATE TABLE ${TABLE} (
                id int PRIMARY KEY,
                label text NOT NULL,
                meta jsonb,
                flag boolean NOT NULL
            )
        `).execute(pgDb);

        await sql.raw(`
            CREATE TABLE ${TABLE} (
                id int PRIMARY KEY,
                label varchar(255) NOT NULL,
                meta json,
                flag tinyint(1) NOT NULL
            )
        `).execute(myDb);

    });

    afterAll(async () => {

        if (pgDb) await sql.raw(`DROP TABLE IF EXISTS ${TABLE}`).execute(pgDb).catch(() => undefined);
        if (myDb) await sql.raw(`DROP TABLE IF EXISTS ${TABLE}`).execute(myDb).catch(() => undefined);

        if (myDestroy) await myDestroy();
        if (pgDestroy) await pgDestroy();

    });

    beforeEach(async () => {

        await sql.raw(`DELETE FROM ${TABLE}`).execute(pgDb);
        await sql.raw(`DELETE FROM ${TABLE}`).execute(myDb);

        await sql.raw(`
            INSERT INTO ${TABLE} (id, label, meta, flag) VALUES
                (1, 'alpha', '{"k":1}', true),
                (2, 'beta',  '{"k":2}', false),
                (3, 'gamma', NULL,      true)
        `).execute(pgDb);

    });

    it('should plan a cross-dialect transfer instead of aborting on the destination probe', async () => {

        const [plan, err] = await getTransferPlan(pgConfig, myConfig, { tables: [TABLE] });

        // Probing with the source dialect produced
        // `column t.table_rows does not exist` / a MySQL syntax error here.
        expect(err).toBeNull();
        expect(plan!.crossDialect).toBe(true);
        expect(plan!.tables.map((t) => t.name)).toContain(TABLE);

    });

    it('should land every source row in the destination', async () => {

        const [result, err] = await transferData(pgConfig, myConfig, { tables: [TABLE] });

        expect(err).toBeNull();
        expect(result!.status).toBe('success');

        const landed = await sql<{ id: number; label: string; meta: unknown; flag: number }>`
            SELECT id, label, meta, flag FROM xdialect_probe ORDER BY id
        `.execute(myDb);

        expect(landed.rows.map((r) => r.id)).toEqual([1, 2, 3]);
        expect(landed.rows.map((r) => r.label)).toEqual(['alpha', 'beta', 'gamma']);
        expect(landed.rows.map((r) => Number(r.flag))).toEqual([1, 0, 1]);

        // jsonb arrives from postgres as an object; MySQL's driver has no
        // JSON codec, so an unconverted object inserted as "[object Object]"
        // and the row was counted as skipped.
        expect(landed.rows[0]!.meta).toEqual({ k: 1 });
        expect(landed.rows[1]!.meta).toEqual({ k: 2 });
        expect(landed.rows[2]!.meta).toBeNull();

        expect(result!.totalRows).toBe(3);

    });

    it('should fail loudly when a row cannot be inserted', async () => {

        // A label longer than the destination column forces a real insert
        // error. It must surface as a failure, not be counted as "skipped":
        // the strategy check read the raw option, so the SDK default
        // (undefined) swallowed every non-conflict error.
        await sql.raw(`UPDATE ${TABLE} SET label = repeat('x', 300) WHERE id = 2`).execute(pgDb);

        const [result, err] = await transferData(pgConfig, myConfig, { tables: [TABLE] });

        expect(err).toBeNull();
        expect(result!.status).not.toBe('success');

        const failed = result!.tables.find((t) => t.table === TABLE)!;

        expect(failed.status).toBe('failed');
        expect(failed.rowsSkipped).toBe(0);
        expect(failed.error).toBeTruthy();

    });

});
