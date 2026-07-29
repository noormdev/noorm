/**
 * Unit tests for the shared operation-record helper.
 *
 * WHY these assert SQL shape rather than a returned number: the defect this
 * helper exists to prevent was `.returning('id')` on MySQL, a dialect with no
 * RETURNING clause. Every suite that exercised `createOperation` constructed
 * it with `'sqlite'`, so the emitted SQL was never observed and the runner and
 * change modules were both inoperable on MySQL under a green suite. Compiling
 * the query per dialect and reading the statement back is what makes that
 * class of bug visible without a live server.
 *
 * The second trap encoded here is the follow-up query. `LAST_INSERT_ID()` and
 * `SCOPE_IDENTITY()` are per-connection, and Kysely returns the connection to
 * the pool between statements — so on mysql and mssql the id must come out of
 * the insert itself and no second statement may be issued. The tests assert
 * the statement count, not just the value.
 */
import { describe, it, expect } from 'bun:test';
import { Kysely, SqliteDialect } from 'kysely';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { insertOperationRecord, toOperationId } from '../../../src/core/shared/operation-id.js';
import { getNoormTables, noormDb } from '../../../src/core/shared/index.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import type { NewNoormChange, NoormDatabase } from '../../../src/core/shared/index.js';
import type { Dialect } from '../../../src/core/connection/types.js';

import { createRecordingDb, type ResponseRule } from '../explore/recording-db.js';

const VALUES: NewNoormChange = {
    name: 'change:test',
    change_type: 'change',
    direction: 'change',
    status: 'pending',
    config_name: 'test',
    executed_by: 'test@example.com',
};

/**
 * Run the helper against a dialect's real query compiler, recording every
 * statement the driver would have sent.
 */
async function compileFor(dialect: Dialect, rules: ResponseRule[] = []) {

    const recording = createRecordingDb(dialect, rules);
    const db = recording.kysely as unknown as Kysely<NoormDatabase>;

    const [id, err] = await insertOperationRecord({
        db,
        ndb: noormDb(db, dialect),
        dialect,
        table: getNoormTables(dialect).change,
        values: VALUES,
    });

    return { id, err, recording };

}

describe('shared: toOperationId', () => {

    it('should accept the shapes each driver reports a generated key in', () => {

        // mysql2 reports a bigint, node-postgres renders int8 as a string,
        // mssql and sqlite give a plain number.
        expect(toOperationId(42n)).toBe(42);
        expect(toOperationId('7')).toBe(7);
        expect(toOperationId(3)).toBe(3);

    });

    it('should reject values that would corrupt the rows joining against it', () => {

        // A 0 or a negative would be written into child rows' change_id as a
        // reference to a change record that does not exist.
        expect(toOperationId(0)).toBeUndefined();
        expect(toOperationId(-1)).toBeUndefined();
        expect(toOperationId('not-a-number')).toBeUndefined();

        // Beyond 2^53 the Number conversion is already lossy, so the id would
        // no longer identify the row that was inserted.
        expect(toOperationId(2n ** 63n)).toBeUndefined();

    });

    it('should report an absent key as absent rather than as a zero', () => {

        expect(toOperationId(null)).toBeUndefined();
        expect(toOperationId(undefined)).toBeUndefined();

    });

});

describe('shared: insertOperationRecord', () => {

    it('should never emit RETURNING on mysql', async () => {

        const { recording } = await compileFor('mysql', [
            { match: /insert into/i, insertId: 12n },
        ]);

        const insert = recording.queries[0]!;

        // MySQL has no RETURNING clause: emitting one makes every operation
        // record fail, which is exactly how the runner and change modules
        // shipped inoperable on MySQL.
        expect(insert.sql).not.toMatch(/returning/i);
        expect(insert.sql).toMatch(/^insert into/i);

    });

    it('should take the mysql id from the insert result without a second query', async () => {

        const { id, err, recording } = await compileFor('mysql', [
            { match: /insert into/i, insertId: 12n },
        ]);

        expect(err).toBeNull();
        expect(id).toBe(12);

        // LAST_INSERT_ID() is per-connection and Kysely pools connections, so
        // a follow-up statement could read another session's insert.
        expect(recording.queries).toHaveLength(1);
        expect(recording.find(/LAST_INSERT_ID/i)).toBeUndefined();

    });

    it('should not fall back to a second query when mysql reports no key', async () => {

        const { id, err, recording } = await compileFor('mysql');

        expect(err).toBeNull();
        expect(id).toBeUndefined();
        expect(recording.queries).toHaveLength(1);

    });

    it('should read the mssql id from an OUTPUT clause on the insert', async () => {

        const { id, err, recording } = await compileFor('mssql', [
            { match: /insert into/i, rows: [{ id: 8 }] },
        ]);

        expect(err).toBeNull();
        expect(id).toBe(8);

        const insert = recording.queries[0]!;

        expect(insert.sql).toMatch(/output/i);
        expect(insert.sql).toMatch(/inserted/i);
        expect(insert.sql).not.toMatch(/returning/i);

    });

    it('should not fall back to SCOPE_IDENTITY when mssql reports no key', async () => {

        const { id, recording } = await compileFor('mssql', [
            { match: /insert into/i, rows: [{ id: null }] },
        ]);

        // SCOPE_IDENTITY() is per-connection for the same reason
        // LAST_INSERT_ID() is.
        expect(id).toBeUndefined();
        expect(recording.queries).toHaveLength(1);
        expect(recording.find(/SCOPE_IDENTITY/i)).toBeUndefined();

    });

    it('should use RETURNING on postgres and sqlite', async () => {

        for (const dialect of ['postgres', 'sqlite'] as const) {

            const { id, err, recording } = await compileFor(dialect, [
                { match: /insert into/i, rows: [{ id: 5 }] },
            ]);

            expect(err).toBeNull();
            expect(id).toBe(5);
            expect(recording.queries).toHaveLength(1);
            expect(recording.queries[0]!.sql).toMatch(/returning/i);

        }

    });

    it('should fall back to last_insert_rowid when sqlite RETURNING yields no id', async () => {

        // better-sqlite3 can report a row with no id for RETURNING; without
        // the fallback the caller sees a failed insert that in fact succeeded.
        const { id, err, recording } = await compileFor('sqlite', [
            { match: /insert into/i, rows: [{ id: null }] },
            { match: /last_insert_rowid/i, rows: [{ id: 3 }] },
        ]);

        expect(err).toBeNull();
        expect(id).toBe(3);
        expect(recording.queries).toHaveLength(2);

    });

    it('should fall back to lastval when postgres RETURNING yields no id', async () => {

        const { id, err, recording } = await compileFor('postgres', [
            { match: /insert into/i, rows: [{ id: null }] },
            { match: /lastval/i, rows: [{ id: 9 }] },
        ]);

        expect(err).toBeNull();
        expect(id).toBe(9);
        expect(recording.queries).toHaveLength(2);

    });

    it('should return a failed insert as an error rather than throwing', async () => {

        // recordReset degrades to 0 on failure instead of failing the teardown
        // it is recording, which is only possible if the helper hands the
        // error back rather than throwing it.
        const { id, err } = await compileFor('postgres', [
            { match: /insert into/i, error: new Error('connection reset') },
        ]);

        expect(err).toBeInstanceOf(Error);
        expect(err!.message).toBe('connection reset');
        expect(id).toBeUndefined();

    });

    it('should qualify the insert with the noorm schema on postgres', async () => {

        const { recording } = await compileFor('postgres', [
            { match: /insert into/i, rows: [{ id: 1 }] },
        ]);

        expect(recording.queries[0]!.sql).toContain('"noorm"."change"');

    });

    it('should return an id a real sqlite database can join child rows to', async () => {

        const db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new BunSqliteDatabase(':memory:') as never,
            }),
        });

        await v1.up(db as Kysely<unknown>, 'sqlite');

        const [id, err] = await insertOperationRecord({
            db,
            ndb: noormDb(db, 'sqlite'),
            dialect: 'sqlite',
            table: getNoormTables('sqlite').change,
            values: VALUES,
        });

        expect(err).toBeNull();
        expect(id).toBeGreaterThan(0);

        const row = await db
            .selectFrom('__noorm_change__')
            .select(['id', 'name'])
            .where('id', '=', id!)
            .executeTakeFirst();

        expect(row?.name).toBe(VALUES.name);

        await db.destroy();

    });

});
