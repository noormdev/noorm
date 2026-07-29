/**
 * Recording Kysely harness for explore dialect unit tests.
 *
 * The previous harness stubbed `compileQuery` to return `SELECT 1`, so the
 * SQL a dialect method actually generates was never observable and a wrong
 * `WHERE` predicate was structurally undetectable. This builds a real Kysely
 * instance using the dialect's real adapter and query compiler, backed by a
 * driver that records every compiled statement and replays canned rows.
 *
 * @example
 * ```ts
 * const db = createRecordingDb('postgres', [
 *     { match: /FROM pg_proc/, rows: [{ oid: '675394', prosrc: '...' }] },
 *     { match: /information_schema.parameters/, rows: [] },
 * ]);
 *
 * await postgresExploreOperations.getProcedureDetail(db.kysely, 'sp_touch');
 *
 * expect(db.find(/information_schema.parameters/)?.parameters).toContain('sp_touch_675394');
 * ```
 */
import {
    Kysely,
    MssqlAdapter,
    MssqlIntrospector,
    MssqlQueryCompiler,
    MysqlAdapter,
    MysqlIntrospector,
    MysqlQueryCompiler,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
    SqliteAdapter,
    SqliteIntrospector,
    SqliteQueryCompiler,
} from 'kysely';

import type {
    CompiledQuery,
    DatabaseConnection,
    Driver,
    QueryResult,
} from 'kysely';

import type { Dialect } from '../../../src/core/connection/types.js';

/**
 * One compiled statement as the driver saw it.
 */
export interface RecordedQuery {

    sql: string;
    parameters: readonly unknown[];

}

/**
 * Rows to replay for the first statement matching `match`.
 *
 * Rules are consumed in order: a rule serves at most one statement, so two
 * rules with the same matcher answer two successive calls. Unmatched
 * statements return no rows.
 */
export interface ResponseRule {

    match: RegExp | string;
    rows?: unknown[];

    /**
     * Generated key the driver reports alongside the rows.
     *
     * MySQL has no RETURNING clause, so its id arrives here rather than in a
     * row — replaying it is the only way to exercise that path without a
     * live server.
     */
    insertId?: bigint;

    /** Reject instead of replaying rows, to exercise error paths. */
    error?: Error;

}

/**
 * A Kysely instance whose driver records instead of connecting.
 */
export interface RecordingDb {

    kysely: Kysely<unknown>;
    queries: RecordedQuery[];

    /** First recorded statement matching `pattern`, or undefined. */
    find(pattern: RegExp | string): RecordedQuery | undefined;

    /** Every recorded statement matching `pattern`. */
    findAll(pattern: RegExp | string): RecordedQuery[];

}

function matches(query: RecordedQuery, pattern: RegExp | string): boolean {

    return typeof pattern === 'string'
        ? query.sql.includes(pattern)
        : pattern.test(query.sql);

}

/**
 * Adapter/compiler/introspector triple per dialect, so compiled SQL uses the
 * real placeholder syntax ($1, ?, @1) and the real identifier quoting.
 */
function dialectParts(dialect: Dialect) {

    if (dialect === 'postgres') {

        return {
            adapter: new PostgresAdapter(),
            compiler: new PostgresQueryCompiler(),
            introspector: (db: Kysely<unknown>) => new PostgresIntrospector(db),
        };

    }

    if (dialect === 'mysql') {

        return {
            adapter: new MysqlAdapter(),
            compiler: new MysqlQueryCompiler(),
            introspector: (db: Kysely<unknown>) => new MysqlIntrospector(db),
        };

    }

    if (dialect === 'mssql') {

        return {
            adapter: new MssqlAdapter(),
            compiler: new MssqlQueryCompiler(),
            introspector: (db: Kysely<unknown>) => new MssqlIntrospector(db),
        };

    }

    return {
        adapter: new SqliteAdapter(),
        compiler: new SqliteQueryCompiler(),
        introspector: (db: Kysely<unknown>) => new SqliteIntrospector(db),
    };

}

/**
 * Build a Kysely instance that compiles for real and records what it would
 * have sent.
 *
 * @param dialect - Dialect whose adapter and compiler to use
 * @param rules - Canned responses, consumed in order (see {@link ResponseRule})
 */
export function createRecordingDb(
    dialect: Dialect,
    rules: ResponseRule[] = [],
): RecordingDb {

    const queries: RecordedQuery[] = [];
    const pending = [...rules];
    const parts = dialectParts(dialect);

    const connection: DatabaseConnection = {

        async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {

            const recorded: RecordedQuery = {
                sql: compiled.sql,
                parameters: compiled.parameters,
            };

            queries.push(recorded);

            const index = pending.findIndex((rule) => matches(recorded, rule.match));

            if (index === -1) {

                return { rows: [] };

            }

            const [rule] = pending.splice(index, 1);

            if (rule!.error) {

                throw rule!.error;

            }

            return { rows: (rule!.rows ?? []) as R[], insertId: rule!.insertId };

        },

        // eslint-disable-next-line require-yield
        async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {

            throw new Error('streamQuery is not supported by the recording harness');

        },

    };

    const driver: Driver = {
        init: async () => {},
        acquireConnection: async () => connection,
        beginTransaction: async () => {},
        commitTransaction: async () => {},
        rollbackTransaction: async () => {},
        releaseConnection: async () => {},
        destroy: async () => {},
    };

    const kysely = new Kysely<unknown>({
        dialect: {
            createAdapter: () => parts.adapter,
            createDriver: () => driver,
            createIntrospector: parts.introspector,
            createQueryCompiler: () => parts.compiler,
        },
    });

    return {
        kysely,
        queries,
        find: (pattern) => queries.find((q) => matches(q, pattern)),
        findAll: (pattern) => queries.filter((q) => matches(q, pattern)),
    };

}
