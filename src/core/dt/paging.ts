/**
 * Stable pagination for bulk reads, shared by the .dt export pipeline and the
 * transfer executor.
 *
 * Both used `LIMIT n OFFSET m` with no `ORDER BY`. No engine guarantees row
 * order across two such statements, so any write to the source between pages
 * shifts the window: rows are skipped and rows are read twice, and because the
 * caller counts what it received rather than what exists, the operation still
 * reports the full row count. A 50k-row export under concurrent `UPDATE`
 * measured 14,149 rows missing and 13,387 duplicated while reporting success.
 *
 * Keyset pagination fixes the ordering *and* the window: each page asks for
 * rows strictly after the last key seen, so a concurrent update cannot move a
 * row across the cursor.
 *
 * @example
 * ```typescript
 * const pager = createKeysetPager({
 *     db, dialect: 'postgres', table: 'users',
 *     columns: ['id', 'email'], keyColumns: ['id'], batchSize: 1000,
 * });
 *
 * while (true) {
 *     const rows = await pager.next();
 *     if (rows.length === 0) break;
 *     // ...
 * }
 * ```
 */
import { sql } from 'kysely';

import type { Kysely, RawBuilder } from 'kysely';
import type { NoormDatabase } from '../shared/tables.js';
import type { Dialect } from '../connection/types.js';

/**
 * Options for {@link createKeysetPager}.
 */
export interface KeysetPagerOptions {

    db: Kysely<NoormDatabase>;

    dialect: Dialect;

    /** Table to read from. */
    table: string;

    /** Columns to select, in .dt / plan order. */
    columns: string[];

    /**
     * Primary key columns, in key order. Empty means the table has no primary
     * key — see {@link createKeysetPager} for what happens then.
     */
    keyColumns: string[];

    /** Rows per page. Ignored for a key-less table. */
    batchSize: number;

}

/**
 * A cursor over a table that yields each row exactly once.
 */
export interface KeysetPager {

    /** Fetch the next page. Returns `[]` once the table is exhausted. */
    next(): Promise<Record<string, unknown>[]>;

}

/**
 * Quote an identifier for the given dialect.
 */
function getQuoteIdent(dialect: string): (c: string) => string {

    if (dialect === 'mssql') return (c: string) => `[${c.replace(/]/g, ']]')}]`;
    if (dialect === 'mysql') return (c: string) => `\`${c.replace(/`/g, '``')}\``;

    return (c: string) => `"${c.replace(/"/g, '""')}"`;

}

/**
 * Build the `WHERE` predicate that selects rows strictly after `cursor`.
 *
 * Expanded to an OR-chain of equality prefixes rather than a row-value
 * comparison (`(a, b) > (x, y)`) because MSSQL has no row constructor.
 * Values are bound, never interpolated.
 */
function buildCursorPredicate(
    keyColumns: string[],
    cursor: unknown[],
    quoteIdent: (c: string) => string,
): RawBuilder<unknown> {

    const clauses = keyColumns.map((_col, i) => {

        const conjuncts: RawBuilder<unknown>[] = [];

        for (let j = 0; j < i; j++) {

            conjuncts.push(sql`${sql.raw(quoteIdent(keyColumns[j]!))} = ${cursor[j]}`);

        }

        conjuncts.push(sql`${sql.raw(quoteIdent(keyColumns[i]!))} > ${cursor[i]}`);

        return sql`(${sql.join(conjuncts, sql` AND `)})`;

    });

    return sql`(${sql.join(clauses, sql` OR `)})`;

}

/**
 * Create a pager over `table`.
 *
 * With a primary key, pages are keyset-ordered and stable under concurrent
 * writes. Without one there is no stable cursor, so the pager falls back to a
 * single unpaginated `SELECT`: one statement is one consistent snapshot on
 * every supported engine, where paging would silently drop and duplicate rows.
 * The cost is that a key-less table is read entirely into memory — a bounded,
 * visible cost, unlike silent corruption.
 */
export function createKeysetPager(options: KeysetPagerOptions): KeysetPager {

    const { db, dialect, table, columns, keyColumns, batchSize } = options;

    const quoteIdent = getQuoteIdent(dialect);
    const columnList = columns.map(quoteIdent).join(', ');
    const orderList = keyColumns.map(quoteIdent).join(', ');

    let cursor: unknown[] | null = null;
    let exhausted = false;

    /**
     * Read every row in one statement. Used when the table has no primary key.
     */
    const readAll = async (): Promise<Record<string, unknown>[]> => {

        const result = await sql<Record<string, unknown>>`
            SELECT ${sql.raw(columnList)}
            FROM ${sql.table(table)}
        `.execute(db);

        return result.rows;

    };

    /**
     * Read one keyset page starting strictly after the current cursor.
     */
    const readPage = async (): Promise<Record<string, unknown>[]> => {

        const where = cursor
            ? sql`WHERE ${buildCursorPredicate(keyColumns, cursor, quoteIdent)}`
            : sql``;

        const limit = dialect === 'mssql'
            ? sql`OFFSET 0 ROWS FETCH NEXT ${batchSize} ROWS ONLY`
            : sql`LIMIT ${batchSize}`;

        const result = await sql<Record<string, unknown>>`
            SELECT ${sql.raw(columnList)}
            FROM ${sql.table(table)}
            ${where}
            ORDER BY ${sql.raw(orderList)}
            ${limit}
        `.execute(db);

        const last = result.rows[result.rows.length - 1];

        if (last) {

            cursor = keyColumns.map((col) => last[col]);

        }

        return result.rows;

    };

    return {

        async next(): Promise<Record<string, unknown>[]> {

            if (exhausted) return [];

            if (keyColumns.length === 0) {

                exhausted = true;

                return readAll();

            }

            const rows = await readPage();

            if (rows.length < batchSize) {

                exhausted = true;

            }

            return rows;

        },

    };

}
