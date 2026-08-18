/**
 * Integration tests for the table data peek, against every dialect.
 *
 * The unit tests pin the SQL string; this pins that the SQL is *accepted*.
 * Those are different claims, and the gap between them is exactly where the
 * portability problem lives: `SELECT TOP (10) *` compiles from the same code
 * path as `LIMIT 10` and only a server can say whether either one parses. The
 * same goes for the identifier quoting — `"dbo"."peek_seq"` is only a valid
 * table reference on SQL Server while QUOTED_IDENTIFIER is on, which is the
 * driver's default and not something a compiled string reveals.
 *
 * Every case runs against all four dialects from one table of fixtures, so a
 * dialect cannot quietly go untested.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from 'kysely';
import { attempt, attemptSync } from '@logosdx/utils';

import type { Kysely } from 'kysely';
import type { Dialect } from '../../../src/core/connection/types.js';
import type { TableDetail } from '../../../src/core/explore/types.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';

import { fetchDetail, fetchRowPeek } from '../../../src/core/explore/index.js';
import { renderRowDocument } from '../../../src/tui/components/terminal/rowDocument.js';
import { createTestConnection, skipIfNoContainer } from '../../utils/db.js';

/** Access that lets `sql:read` through, so a denial in a test is never incidental. */
const OPEN: ConfigAccess = { user: 'admin', agent: 'admin' };

const GATE = { configName: 'noorm_test', access: OPEN, channel: 'user' } as const;

/** Page size every case uses, small enough to keep the fixtures readable. */
const PAGE = 4;

/**
 * Fixture tables, named for what each one proves.
 *
 * Row counts are stated relative to `PAGE` rather than as bare numbers: the
 * overlap cases are the ones that break if the page size ever moves.
 */
const TABLES = {
    /** Comfortably more than two pages: the two ends are disjoint. */
    seq: 'peek_seq',
    /** Between one and two pages: the ends meet and must not be drawn twice. */
    short: 'peek_short',
    /** Exactly one page: both queries return the same rows. */
    exact: 'peek_exact',
    /** No rows at all. */
    empty: 'peek_empty',
    /** No primary key, so there is no tail to read. */
    nokey: 'peek_nokey',
    /** Two-column primary key. */
    pair: 'peek_pair',
    /** Every row NULL in one column. */
    nulls: 'peek_nulls',
    /** One row holding a value of every kind the row view has to render. */
    values: 'peek_values',
} as const;

const ALL_TABLES = Object.values(TABLES);

/**
 * The value fixture, per dialect.
 *
 * Written out four times rather than generated, because the whole point is that
 * the four disagree: `bytea` against `varbinary` against `blob`, a real
 * `timestamptz` against SQLite's text, and a `jsonb` the driver parses against a
 * string it does not. A generated statement would have to paper over exactly the
 * differences under test.
 */
const VALUE_FIXTURE: Record<Dialect, { ddl: string; insert: string }> = {
    postgres: {
        ddl: `CREATE TABLE ${TABLES.values} (
            id integer PRIMARY KEY,
            c_null text,
            c_empty text,
            c_nullword text,
            c_flag boolean,
            c_ts timestamptz,
            c_big bigint,
            c_bytes bytea,
            c_doc jsonb
        )`,
        insert: `INSERT INTO ${TABLES.values} VALUES (
            1, NULL, '', 'null', true, TIMESTAMPTZ '2024-03-01 12:34:56+00',
            9223372036854775807, '\\x00ff10'::bytea, '{"a":1,"b":[2,3]}'::jsonb
        )`,
    },
    mysql: {
        ddl: `CREATE TABLE ${TABLES.values} (
            id int PRIMARY KEY,
            c_null text,
            c_empty text,
            c_nullword text,
            c_flag boolean,
            c_ts datetime,
            c_big bigint,
            c_bytes varbinary(16),
            c_doc json
        )`,
        insert: `INSERT INTO ${TABLES.values} VALUES (
            1, NULL, '', 'null', true, '2024-03-01 12:34:56',
            9223372036854775807, X'00ff10', '{"a":1,"b":[2,3]}'
        )`,
    },
    mssql: {
        ddl: `CREATE TABLE ${TABLES.values} (
            id int PRIMARY KEY,
            c_null nvarchar(50),
            c_empty nvarchar(50),
            c_nullword nvarchar(50),
            c_flag bit,
            c_ts datetime2,
            c_big bigint,
            c_bytes varbinary(16),
            c_doc nvarchar(max)
        )`,
        insert: `INSERT INTO ${TABLES.values} VALUES (
            1, NULL, '', 'null', 1, '2024-03-01 12:34:56',
            9223372036854775807, 0x00ff10, '{"a":1,"b":[2,3]}'
        )`,
    },
    sqlite: {
        ddl: `CREATE TABLE ${TABLES.values} (
            id integer PRIMARY KEY,
            c_null text,
            c_empty text,
            c_nullword text,
            c_flag integer,
            c_ts text,
            c_big integer,
            c_bytes blob,
            c_doc text
        )`,
        insert: `INSERT INTO ${TABLES.values} VALUES (
            1, NULL, '', 'null', 1, '2024-03-01 12:34:56',
            9007199254740993, X'00ff10', '{"a":1,"b":[2,3]}'
        )`,
    },
};

/** Dialects whose driver parses a JSON column into an object before we see it. */
const PARSES_JSON: Dialect[] = ['postgres', 'mysql'];

/**
 * SQLite is in-memory and lives only as long as the connection, so it needs no
 * container. The rest do, and `skipIfNoContainer` throws rather than skipping.
 */
async function connect(dialect: Dialect) {

    if (dialect !== 'sqlite') await skipIfNoContainer(dialect);

    return createTestConnection(dialect);

}

async function run(db: Kysely<unknown>, statement: string): Promise<void> {

    await sql.raw(statement).execute(db);

}

/**
 * Insert `count` rows numbered from 1, one statement per row.
 *
 * One at a time rather than a multi-row VALUES list because MSSQL caps a single
 * INSERT at 1000 rows and the syntax differences are not worth the saving on
 * fixtures this size.
 */
async function fill(db: Kysely<unknown>, table: string, count: number): Promise<void> {

    for (let id = 1; id <= count; id += 1) {

        await run(db, `INSERT INTO ${table} (id, label) VALUES (${id}, 'row-${id}')`);

    }

}

async function createFixtures(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

    for (const table of ALL_TABLES) {

        await run(db, `DROP TABLE IF EXISTS ${table}`);

    }

    await run(db, `CREATE TABLE ${TABLES.seq} (id INTEGER PRIMARY KEY, label VARCHAR(50))`);
    await fill(db, TABLES.seq, PAGE * 4);

    await run(db, `CREATE TABLE ${TABLES.short} (id INTEGER PRIMARY KEY, label VARCHAR(50))`);
    await fill(db, TABLES.short, PAGE * 2 - 1);

    await run(db, `CREATE TABLE ${TABLES.exact} (id INTEGER PRIMARY KEY, label VARCHAR(50))`);
    await fill(db, TABLES.exact, PAGE);

    await run(db, `CREATE TABLE ${TABLES.empty} (id INTEGER PRIMARY KEY, label VARCHAR(50))`);

    await run(db, `CREATE TABLE ${TABLES.nokey} (label VARCHAR(50))`);

    for (let i = 1; i <= PAGE * 2; i += 1) {

        await run(db, `INSERT INTO ${TABLES.nokey} (label) VALUES ('row-${i}')`);

    }

    // `zone_id` before `item_no` on purpose: alphabetical order would put
    // `item_no` first, so a peek that sorted the key columns by name instead of
    // by ordinal position produces a visibly different first page here.
    await run(
        db,
        `CREATE TABLE ${TABLES.pair} (
            zone_id INTEGER NOT NULL,
            item_no INTEGER NOT NULL,
            label VARCHAR(50),
            PRIMARY KEY (zone_id, item_no)
        )`,
    );

    for (let zone = 1; zone <= 2; zone += 1) {

        for (let no = 1; no <= PAGE * 2; no += 1) {

            await run(
                db,
                `INSERT INTO ${TABLES.pair} (zone_id, item_no, label) VALUES (${zone}, ${no}, 'z${zone}-${no}')`,
            );

        }

    }

    await run(db, `CREATE TABLE ${TABLES.nulls} (id INTEGER PRIMARY KEY, maybe VARCHAR(50))`);

    for (let id = 1; id <= 3; id += 1) {

        await run(db, `INSERT INTO ${TABLES.nulls} (id, maybe) VALUES (${id}, NULL)`);

    }

    await run(db, VALUE_FIXTURE[dialect].ddl);
    await run(db, VALUE_FIXTURE[dialect].insert);

}

async function dropFixtures(db: Kysely<unknown>): Promise<void> {

    for (const table of ALL_TABLES) {

        await run(db, `DROP TABLE IF EXISTS ${table}`);

    }

}

for (const dialect of ['postgres', 'mysql', 'mssql', 'sqlite'] as const) {

    describe(`integration: ${dialect} row peek`, () => {

        let db: Kysely<unknown>;
        let destroy: () => Promise<void>;

        /**
         * The detail the screen would already be holding when the reader asks
         * for a peek, fetched the same way the screen fetches it.
         */
        const detailFor = async (table: string): Promise<TableDetail> => {

            const detail = await fetchDetail(db, dialect, 'tables', table);

            expect(detail).not.toBeNull();

            return detail!;

        };

        beforeAll(async () => {

            const conn = await connect(dialect);
            db = conn.db;
            destroy = conn.destroy;

            await createFixtures(db, dialect);

        });

        afterAll(async () => {

            if (!destroy) return;

            await dropFixtures(db);
            await destroy();

        });

        it('should read both ends of a table longer than two pages', async () => {

            const peek = await fetchRowPeek(db, dialect, await detailFor(TABLES.seq), GATE, PAGE);

            expect(peek.mode).toBe('ends');
            expect(peek.keyColumns).toEqual(['id']);
            expect(peek.first.map((row) => Number(row['id']))).toEqual([1, 2, 3, 4]);
            expect(peek.last.map((row) => Number(row['id']))).toEqual([13, 14, 15, 16]);

        });

        it('should carry the row values, not just the keys', async () => {

            const peek = await fetchRowPeek(db, dialect, await detailFor(TABLES.seq), GATE, PAGE);

            expect(peek.first[0]?.['label']).toBe('row-1');
            expect(peek.last.at(-1)?.['label']).toBe('row-16');

        });

        it('should show one set when the table holds fewer than two pages', async () => {

            const peek = await fetchRowPeek(db, dialect, await detailFor(TABLES.short), GATE, PAGE);

            const ids = peek.first.map((row) => Number(row['id']));

            expect(peek.mode).toBe('whole');
            expect(peek.last).toEqual([]);
            expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7]);
            expect(new Set(ids).size).toBe(ids.length);

        });

        it('should show one set when the table holds exactly one page', async () => {

            const peek = await fetchRowPeek(db, dialect, await detailFor(TABLES.exact), GATE, PAGE);

            expect(peek.mode).toBe('whole');
            expect(peek.first.map((row) => Number(row['id']))).toEqual([1, 2, 3, 4]);

        });

        it('should return an empty set for an empty table without failing', async () => {

            const peek = await fetchRowPeek(db, dialect, await detailFor(TABLES.empty), GATE, PAGE);

            expect(peek.mode).toBe('whole');
            expect(peek.first).toEqual([]);
            expect(peek.columns).toEqual(['id', 'label']);

        });

        it('should read the head only when the table has no primary key', async () => {

            const peek = await fetchRowPeek(db, dialect, await detailFor(TABLES.nokey), GATE, PAGE);

            expect(peek.mode).toBe('head');
            expect(peek.keyColumns).toEqual([]);
            expect(peek.first).toHaveLength(PAGE);
            expect(peek.last).toEqual([]);

        });

        it('should order a composite key by ordinal position, not column name', async () => {

            const peek = await fetchRowPeek(db, dialect, await detailFor(TABLES.pair), GATE, PAGE);

            // Sorted by name the key would read `item_no, zone_id`, and the
            // first page would be z1-1, z2-1, z1-2, z2-2 instead.
            expect(peek.mode).toBe('ends');
            expect(peek.keyColumns).toEqual(['zone_id', 'item_no']);
            expect(peek.first.map((row) => row['label'])).toEqual(['z1-1', 'z1-2', 'z1-3', 'z1-4']);
            expect(peek.last.map((row) => row['label'])).toEqual(['z2-5', 'z2-6', 'z2-7', 'z2-8']);

        });

        it('should render a column that is NULL in every row', async () => {

            const peek = await fetchRowPeek(db, dialect, await detailFor(TABLES.nulls), GATE, PAGE);

            expect(peek.mode).toBe('whole');
            expect(peek.first).toHaveLength(3);
            expect(peek.first.every((row) => row['maybe'] === null)).toBe(true);

        });

        /**
         * The one row of `peek_values`, rendered the way the row view renders
         * it.
         *
         * The unit tests feed the formatter values chosen by hand; this feeds it
         * whatever this driver actually returns, which is the only way to find
         * out that `bun:sqlite` hands back a `Uint8Array` where the other three
         * hand back a `Buffer`.
         */
        const valueDocument = async (format: 'json' | 'yaml') => {

            const peek = await fetchRowPeek(db, dialect, await detailFor(TABLES.values), GATE, PAGE);
            const row = peek.first[0];

            expect(row).toBeDefined();

            return renderRowDocument(row!, peek.columns, format);

        };

        it('should keep NULL apart from the empty string and the word null', async () => {

            const document = await valueDocument('yaml');

            expect(document).toContain('c_null: null');
            expect(document).toContain('c_empty: ""');
            expect(document).toContain('c_nullword: "null"');

        });

        it('should summarize this driver\'s binary rather than dumping its wrapper', async () => {

            const document = await valueDocument('yaml');

            expect(document).toContain('c_bytes: <binary 3 bytes 0x00ff10>');
            expect(document).not.toContain('"type"');
            expect(document).not.toContain('Buffer');

        });

        it('should render every value as something other than an object tag', async () => {

            const document = await valueDocument('yaml');

            expect(document).not.toContain('[object Object]');
            expect(document).not.toContain('<invalid date>');
            expect(document).not.toContain('undefined');

        });

        it('should produce JSON that parses back', async () => {

            // The claim under this is that nothing in the row made
            // `JSON.stringify` throw or emit something it cannot read again -
            // a bigint is the value that does the former.
            const document = await valueDocument('json');
            const [parsed, err] = attemptSync(() => JSON.parse(document));

            expect(err).toBeNull();
            expect(parsed).toBeDefined();

        });

        it('should carry a large integer without rounding it into a float', async () => {

            const document = await valueDocument('yaml');

            // MySQL and SQLite hand back a JS `number` for a 64-bit integer and
            // have already lost precision by the time we see it; postgres and
            // mssql hand back a string and keep it. The formatter's job is not
            // to invent the digits back, it is to print what arrived without
            // scientific notation or a thrown TypeError.
            expect(document).toMatch(/c_big: "?9\d{15,18}"?/);

        });

        it('should render a timestamp as a readable instant', async () => {

            const document = await valueDocument('yaml');

            expect(document).toContain('c_ts: 2024-03-01');

        });

        if (PARSES_JSON.includes(dialect)) {

            it('should render a parsed json column as nested structure', async () => {

                const document = await valueDocument('yaml');

                expect(document).toContain('c_doc:');
                expect(document).toContain('a: 1');
                expect(document).toContain('- 2');

            });

        }

        it('should refuse the read before it reaches the database when policy denies', async () => {

            const detail = await detailFor(TABLES.seq);

            const [peek, err] = await attempt(() => fetchRowPeek(db, dialect, detail, {
                configName: 'noorm_test',
                access: { user: 'admin', agent: false },
                channel: 'agent',
            }, PAGE));

            expect(peek).toBeNull();
            expect(err?.message).toContain('agent');

        });

        it('should surface a readable error when the table is gone', async () => {

            const detail = await detailFor(TABLES.seq);

            const [peek, err] = await attempt(() => fetchRowPeek(
                db,
                dialect,
                { ...detail, name: 'peek_does_not_exist' },
                GATE,
                PAGE,
            ));

            expect(peek).toBeNull();
            expect(err).toBeInstanceOf(Error);
            expect(err?.message.length).toBeGreaterThan(0);

        });

    });

}
