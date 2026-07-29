/**
 * Dialect-aware creation of operation rows in the noorm change table.
 *
 * WHY: a change-table row is the parent record that every file execution,
 * revert and teardown hangs off, so its generated id has to come back from
 * the insert or nothing downstream can be tracked. No two dialects report
 * that id the same way, and the retrieval was previously copy-pasted into
 * `runner/tracker.ts` and twice into `change/history.ts`. Every copy emitted
 * `RETURNING` on MySQL — which has no such clause — so the runner and the
 * change module were both inoperable there, and fixing one copy left the
 * others broken. One implementation now serves all three call sites.
 *
 * @example
 * ```typescript
 * const [id, err] = await insertOperationRecord({
 *     db, ndb, dialect, table: tables.change, values: { name, ... },
 * });
 *
 * if (err) throw new Error('Failed to create operation record', { cause: err });
 * ```
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import { attempt } from '@logosdx/utils';

import type { Dialect } from '../connection/types.js';
import { getNoormTables } from './tables.js';
import type { NewNoormChange, NoormDatabase } from './tables.js';

/**
 * The change table's name in whichever form the dialect uses — bare under
 * the `noorm` schema on pg/mssql, `__noorm_change__` on sqlite/mysql.
 */
type ChangeTableName = ReturnType<typeof getNoormTables>['change'];

/**
 * Coerce a driver-reported generated key into a plain positive integer.
 *
 * Every dialect reports it differently — mysql2 hands back a `bigint`,
 * node-postgres renders `lastval()`'s int8 as a string, mssql and sqlite
 * give a number. Returning `undefined` for anything unusable lets the caller
 * apply its own failure policy instead of carrying a `bigint`, a `0` or a
 * numeric string into a column that later rows join against.
 *
 * @example
 * toOperationId(42n); // 42
 * toOperationId('7'); // 7
 * toOperationId(null); // undefined
 */
export function toOperationId(value: unknown): number | undefined {

    if (value === null || value === undefined) return undefined;

    const asNumber = Number(value);

    if (!Number.isSafeInteger(asNumber) || asNumber <= 0) return undefined;

    return asNumber;

}

/**
 * Dialect-specific last-insert-id query.
 *
 * Only reached as a fallback when `RETURNING id` yielded nothing, so it
 * covers just the dialects that take the RETURNING path.
 *
 * Deliberately has no mysql or mssql case: both retrieve their id from the
 * insert itself. A second-statement `LAST_INSERT_ID()` would in fact be
 * wrong on mysql — it is per-connection, and Kysely returns the connection
 * to the pool between statements.
 *
 * Returns null if the dialect should always use RETURNING/OUTPUT.
 */
function lastInsertIdQuery(dialect: Dialect): ReturnType<typeof sql<{ id: number }>> | null {

    switch (dialect) {

    case 'sqlite':
        return sql<{ id: number }>`SELECT last_insert_rowid() as id`;

    case 'postgres':
        return sql<{ id: number }>`SELECT lastval() as id`;

    default:
        return null;

    }

}

/**
 * Insert an operation row and hand back its generated id.
 *
 * Three id-retrieval strategies, one per driver capability:
 *   mssql   OUTPUT inserted.id
 *   mysql   no RETURNING clause exists — the driver reports the generated
 *           key on the insert result itself
 *   others  RETURNING for an atomic insert+get-id
 *
 * Returns an `[id, error]` tuple rather than throwing so each call site keeps
 * its own failure policy: the runner and change trackers throw with their own
 * wording, while `recordReset` only emits and degrades to `0`, because a
 * missing audit row must not fail the teardown that produced it.
 *
 * A successful insert can still yield an `undefined` id when the driver
 * reports nothing usable — that is not an error here, it is the caller's to
 * classify.
 *
 * @example
 * const [id, err] = await insertOperationRecord({ db, ndb, dialect, table, values });
 */
export async function insertOperationRecord(opts: {
    db: Kysely<NoormDatabase>;
    ndb: Kysely<NoormDatabase>;
    dialect: Dialect;
    table: ChangeTableName;
    values: NewNoormChange;
}): Promise<[number | undefined, Error | null]> {

    const { db, ndb, dialect, table, values } = opts;

    const insertQuery = ndb.insertInto(table).values(values);

    if (dialect === 'mssql') {

        const [result, insertErr] = await attempt(() =>
            insertQuery
                .output('inserted.id as id')
                .executeTakeFirstOrThrow(),
        );

        if (insertErr) return [undefined, insertErr];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return [toOperationId((result as any)?.id), null];

    }

    if (dialect === 'mysql') {

        const [result, insertErr] = await attempt(() => insertQuery.executeTakeFirst());

        if (insertErr) return [undefined, insertErr];

        return [toOperationId(result?.insertId), null];

    }

    const [result, insertErr] = await attempt(() =>
        insertQuery.returning('id').executeTakeFirstOrThrow(),
    );

    if (insertErr) return [undefined, insertErr];

    const id = toOperationId(result?.id);

    if (id !== undefined) return [id, null];

    // SQLite with better-sqlite3 may return null for RETURNING.
    const fallbackQuery = lastInsertIdQuery(dialect);

    if (!fallbackQuery) return [undefined, null];

    // A failing fallback is indistinguishable from one that found nothing;
    // both leave the caller with no id, which is what it already handles.
    const [fallbackResult] = await attempt(() => fallbackQuery.execute(db));

    return [toOperationId(fallbackResult?.rows?.[0]?.id), null];

}
