/**
 * Unit tests for the table data peek.
 *
 * Two things are pinned here that nothing else can reach:
 *
 * 1. The exact SQL each dialect emits. Kysely does no dialect adaptation for
 *    row limiting: `.limit()` compiles to `limit @1` on SQL Server and
 *    `.top()` compiles to `top(10)` on the other three, and neither throws
 *    when used on the wrong one. Nothing in the type system or the compile
 *    step objects, so a full-string assertion per dialect is the only thing
 *    between this code and a statement the server rejects at runtime. Schema
 *    and table names arrive from the database itself and are checked here too:
 *    a name carrying the dialect's own quote character, or a dot, has to
 *    survive as one identifier.
 * 2. Which rows come back under which heading. A table shorter than two pages
 *    would otherwise show the same rows twice, once as "first" and once as
 *    "last", and a reader has no way to tell that from a table that genuinely
 *    has those rows at both ends.
 *
 * `createRecordingDb` builds a real Kysely instance on the dialect's own
 * adapter and compiler behind a driver that records instead of connecting, so
 * these run with no container — the same guarantee a `DummyDriver` harness
 * would give, on the harness this suite already has.
 */
import { describe, it, expect } from 'bun:test';
import { attempt } from '@logosdx/utils';

import { fetchRowPeek, MAX_PEEK_ROWS } from '../../../src/core/explore/index.js';
import type { Dialect } from '../../../src/core/connection/types.js';
import type { ColumnDetail, TableDetail } from '../../../src/core/explore/types.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';
import { createRecordingDb } from './recording-db.js';

/** Access that lets the check through, so a denial in a test is never incidental. */
const OPEN: ConfigAccess = { user: 'admin', agent: 'admin' };

/** The gate every non-policy case passes. */
const GATE = { configName: 'test', access: OPEN, channel: 'user' } as const;

function column(name: string, overrides: Partial<ColumnDetail> = {}): ColumnDetail {

    return {
        name,
        dataType: 'text',
        isNullable: true,
        isPrimaryKey: false,
        ordinalPosition: 1,
        ...overrides,
    };

}

/**
 * A table detail as `fetchDetail` would have returned it. Only the fields the
 * peek reads are meaningful; the rest are there because the type requires them.
 */
function table(overrides: Partial<TableDetail> = {}): TableDetail {

    return {
        name: 'users',
        schema: 'public',
        columns: [
            column('id', { isPrimaryKey: true, ordinalPosition: 1 }),
            column('email', { ordinalPosition: 2 }),
        ],
        indexes: [],
        foreignKeys: [],
        ...overrides,
    };

}

/** Rows with sequential ids, which is what makes an overlap visible. */
function rowsWithIds(ids: number[]): Record<string, unknown>[] {

    return ids.map((id) => ({ id, email: `user${id}@example.com` }));

}

/**
 * The exact statement each dialect must emit for one key column ascending.
 *
 * Asserted in full rather than by pattern, because the failure this guards is
 * silent: Kysely does no dialect adaptation for row limiting. `.limit()`
 * compiles to `limit @1` on SQL Server and `.top()` compiles to `top(10)` on
 * the other three; neither throws, neither is a type error, and each is valid
 * only on the dialects the other is not. A test that merely looked for "a row
 * limit somewhere" would pass against `select top(10) *` on postgres.
 */
const COMPILED: Record<Dialect, { schema?: string; sql: string; parameters: unknown[] }> = {
    postgres: {
        schema: 'public',
        sql: 'select * from "public"."users" as "peek" order by "id" asc limit $1',
        parameters: [10],
    },
    mysql: {
        schema: 'appdb',
        sql: 'select * from `appdb`.`users` as `peek` order by `id` asc limit ?',
        parameters: [10],
    },
    sqlite: {
        schema: undefined,
        sql: 'select * from "users" as "peek" order by "id" asc limit ?',
        parameters: [10],
    },
    mssql: {
        schema: 'dbo',
        // No `limit`, and the count is inlined rather than bound: `top()`
        // takes no parameter.
        sql: 'select top(10) * from "dbo"."users" as "peek" order by "id" asc',
        parameters: [],
    },
};

describe('explore: peek query building', () => {

    for (const dialect of ['postgres', 'mysql', 'sqlite', 'mssql'] as const) {

        const expected = COMPILED[dialect];

        it(`should compile the exact ${dialect} statement`, async () => {

            const db = createRecordingDb(dialect, [{ match: /select/, rows: [] }]);

            await fetchRowPeek(db.kysely, dialect, table({ schema: expected.schema }), GATE, 10);

            expect(db.queries[0]?.sql).toBe(expected.sql);
            expect(db.queries[0]?.parameters).toEqual(expected.parameters);

        });

        it(`should use the row-limit clause ${dialect} accepts and not the other`, async () => {

            const db = createRecordingDb(dialect, [{ match: /select/, rows: [] }]);

            await fetchRowPeek(db.kysely, dialect, table({ schema: expected.schema }), GATE, 10);

            const compiled = db.queries[0]?.sql ?? '';

            if (dialect === 'mssql') {

                expect(compiled).toContain('top(10)');
                expect(compiled).not.toContain('limit');

            }
            else {

                expect(compiled).toContain('limit');
                expect(compiled).not.toContain('top(');

            }

        });

    }

    it('should read the tail with a descending order on the same key', async () => {

        const db = createRecordingDb('postgres', [
            { match: / asc/, rows: rowsWithIds([1, 2, 3]) },
            { match: / desc/, rows: rowsWithIds([9, 8, 7]) },
        ]);

        await fetchRowPeek(db.kysely, 'postgres', table(), GATE, 3);

        expect(db.queries[1]?.sql).toBe(
            'select * from "public"."users" as "peek" order by "id" desc limit $1',
        );
        expect(db.queries[1]?.parameters).toEqual([3]);

    });

    it('should order a composite key by ordinal position, not array order', async () => {

        const detail = table({
            columns: [
                column('tenant_id', { isPrimaryKey: true, ordinalPosition: 2 }),
                column('todo_no', { isPrimaryKey: true, ordinalPosition: 1 }),
                column('title', { ordinalPosition: 3 }),
            ],
        });

        const db = createRecordingDb('postgres', [{ match: / asc/, rows: [] }]);

        await fetchRowPeek(db.kysely, 'postgres', detail, GATE, 10);

        expect(db.queries[0]?.sql).toContain('order by "todo_no" asc, "tenant_id" asc');

    });

    it('should omit ORDER BY entirely when the table has no primary key', async () => {

        const detail = table({ columns: [column('note', { ordinalPosition: 1 })] });
        const db = createRecordingDb('postgres', [{ match: /select/, rows: [] }]);

        await fetchRowPeek(db.kysely, 'postgres', detail, GATE, 10);

        expect(db.queries[0]?.sql).toBe('select * from "public"."users" as "peek" limit $1');
        expect(db.queries[0]?.sql).not.toContain('order by');

    });

    it('should keep a dotted table name whole instead of reading it as schema.table', async () => {

        const detail = table({ name: 'we.ird', schema: undefined });
        const db = createRecordingDb('sqlite', [{ match: /select/, rows: [] }]);

        await fetchRowPeek(db.kysely, 'sqlite', detail, GATE, 10);

        expect(db.queries[0]?.sql).toContain('from "we.ird"');
        expect(db.queries[0]?.sql).not.toContain('"we"."ird"');

    });

    it('should escape a quote inside an identifier rather than close it', async () => {

        const detail = table({
            name: 'we"ird',
            schema: 'sch"ema',
            columns: [column('i"d', { isPrimaryKey: true, ordinalPosition: 1 })],
        });

        const db = createRecordingDb('postgres', [{ match: / asc/, rows: [] }]);

        await fetchRowPeek(db.kysely, 'postgres', detail, GATE, 10);

        expect(db.queries[0]?.sql).toBe(
            'select * from "sch""ema"."we""ird" as "peek" order by "i""d" asc limit $1',
        );

    });

    it('should escape a backtick inside a mysql identifier', async () => {

        const detail = table({
            name: 'we`ird',
            schema: 'appdb',
            columns: [column('id', { isPrimaryKey: true, ordinalPosition: 1 })],
        });

        const db = createRecordingDb('mysql', [{ match: / asc/, rows: [] }]);

        await fetchRowPeek(db.kysely, 'mysql', detail, GATE, 10);

        expect(db.queries[0]?.sql).toBe(
            'select * from `appdb`.`we``ird` as `peek` order by `id` asc limit ?',
        );

    });

    it('should clamp a nonsense page size', async () => {

        const huge = createRecordingDb('postgres', [{ match: / asc/, rows: [] }]);
        await fetchRowPeek(huge.kysely, 'postgres', table(), GATE, 10_000);

        const zero = createRecordingDb('postgres', [{ match: / asc/, rows: [] }]);
        await fetchRowPeek(zero.kysely, 'postgres', table(), GATE, 0);

        expect(huge.queries[0]?.parameters).toEqual([MAX_PEEK_ROWS]);
        expect(zero.queries[0]?.parameters).toEqual([1]);

    });

    it('should inline the clamped count on mssql, where top takes no parameter', async () => {

        const db = createRecordingDb('mssql', [{ match: / asc/, rows: [] }]);

        await fetchRowPeek(db.kysely, 'mssql', table({ schema: 'dbo' }), GATE, 10_000);

        expect(db.queries[0]?.sql).toContain(`top(${MAX_PEEK_ROWS})`);
        expect(db.queries[0]?.parameters).toEqual([]);

    });

});

describe('explore: fetchRowPeek', () => {

    it('should report the whole table and skip the tail query when the page came back short', async () => {

        const db = createRecordingDb('postgres', [{ match: / asc/, rows: rowsWithIds([1, 2, 3]) }]);

        const peek = await fetchRowPeek(db.kysely, 'postgres', table(), GATE, 10);

        expect(peek.mode).toBe('whole');
        expect(peek.first.map((row) => row.id)).toEqual([1, 2, 3]);
        expect(peek.last).toEqual([]);
        expect(db.queries).toHaveLength(1);

    });

    it('should return an empty whole set for an empty table', async () => {

        const db = createRecordingDb('postgres', [{ match: / asc/, rows: [] }]);

        const peek = await fetchRowPeek(db.kysely, 'postgres', table(), GATE, 10);

        expect(peek.mode).toBe('whole');
        expect(peek.first).toEqual([]);
        expect(peek.last).toEqual([]);
        expect(db.queries).toHaveLength(1);

    });

    it('should stop at the head when there is no primary key to order a tail by', async () => {

        const detail = table({ columns: [column('note', { ordinalPosition: 1 })] });
        const db = createRecordingDb('postgres', [
            { match: /select/, rows: [{ note: 'a' }, { note: 'b' }, { note: 'c' }] },
        ]);

        const peek = await fetchRowPeek(db.kysely, 'postgres', detail, GATE, 3);

        expect(peek.mode).toBe('head');
        expect(peek.keyColumns).toEqual([]);
        expect(peek.last).toEqual([]);
        expect(db.queries).toHaveLength(1);

    });

    it('should return both ends, tail re-reversed to ascending, when they do not overlap', async () => {

        const db = createRecordingDb('postgres', [
            { match: / asc/, rows: rowsWithIds([1, 2, 3]) },
            { match: / desc/, rows: rowsWithIds([9, 8, 7]) },
        ]);

        const peek = await fetchRowPeek(db.kysely, 'postgres', table(), GATE, 3);

        expect(peek.mode).toBe('ends');
        expect(peek.first.map((row) => row.id)).toEqual([1, 2, 3]);
        expect(peek.last.map((row) => row.id)).toEqual([7, 8, 9]);

    });

    it('should collapse a partial overlap into one set rather than repeat rows', async () => {

        const db = createRecordingDb('postgres', [
            { match: / asc/, rows: rowsWithIds([1, 2, 3]) },
            { match: / desc/, rows: rowsWithIds([5, 4, 3]) },
        ]);

        const peek = await fetchRowPeek(db.kysely, 'postgres', table(), GATE, 3);

        expect(peek.mode).toBe('whole');
        expect(peek.first.map((row) => row.id)).toEqual([1, 2, 3, 4, 5]);
        expect(peek.last).toEqual([]);

    });

    it('should collapse a table of exactly one page, where both ends are the same rows', async () => {

        const db = createRecordingDb('postgres', [
            { match: / asc/, rows: rowsWithIds([1, 2, 3]) },
            { match: / desc/, rows: rowsWithIds([3, 2, 1]) },
        ]);

        const peek = await fetchRowPeek(db.kysely, 'postgres', table(), GATE, 3);

        expect(peek.mode).toBe('whole');
        expect(peek.first.map((row) => row.id)).toEqual([1, 2, 3]);

    });

    it('should compare every column of a composite key when detecting the overlap', async () => {

        const detail = table({
            columns: [
                column('tenant_id', { isPrimaryKey: true, ordinalPosition: 1 }),
                column('todo_no', { isPrimaryKey: true, ordinalPosition: 2 }),
            ],
        });

        // Same tenant on both ends, different todo_no: comparing only the first
        // key column would call this an overlap and hide the tail.
        const db = createRecordingDb('postgres', [
            { match: / asc/, rows: [{ tenant_id: 1, todo_no: 1 }, { tenant_id: 1, todo_no: 2 }] },
            { match: / desc/, rows: [{ tenant_id: 1, todo_no: 9 }, { tenant_id: 1, todo_no: 8 }] },
        ]);

        const peek = await fetchRowPeek(db.kysely, 'postgres', detail, GATE, 2);

        expect(peek.mode).toBe('ends');
        expect(peek.last.map((row) => row.todo_no)).toEqual([8, 9]);

    });

    it('should name the columns in ordinal order, so both sets draw one grid', async () => {

        const detail = table({
            columns: [
                column('email', { ordinalPosition: 2 }),
                column('id', { isPrimaryKey: true, ordinalPosition: 1 }),
            ],
        });

        const db = createRecordingDb('postgres', [{ match: / asc/, rows: [] }]);

        const peek = await fetchRowPeek(db.kysely, 'postgres', detail, GATE, 10);

        expect(peek.columns).toEqual(['id', 'email']);

    });

    it('should refuse a denied channel before touching the database', async () => {

        const db = createRecordingDb('postgres', [{ match: / asc/, rows: rowsWithIds([1]) }]);

        const gate = {
            configName: 'prod',
            access: { user: 'admin', agent: false },
            channel: 'agent',
        } as const;

        const [peek, err] = await attempt(() => fetchRowPeek(db.kysely, 'postgres', table(), gate, 10));

        expect(peek).toBeNull();
        expect(err?.message).toContain('agent');
        expect(db.queries).toHaveLength(0);

    });

});
