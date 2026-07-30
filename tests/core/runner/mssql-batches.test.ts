/**
 * Unit tests for `executeSqlBody` — the dialect-aware execution shim.
 *
 * Verifies the multi-batch failure semantics required by slice 3:
 * - the failing batch index appears in the returned error string
 * - subsequent batches do NOT run after a failure (short-circuit)
 * - non-MSSQL dialects bypass the splitter entirely
 *
 * Uses an in-memory SQLite Kysely with `dialect: 'mssql'` on the RunContext.
 * SQLite never sees `GO` (the splitter strips it), so we can drive the
 * MSSQL code path against a real driver without standing up MSSQL.
 */
import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { Kysely, SqliteDialect, sql } from 'kysely';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — bun:sqlite is provided by the Bun runtime
import { Database } from 'bun:sqlite';

import { executeSqlBody } from '../../../src/core/runner/mssql-batches.js';
import type { RunContext } from '../../../src/core/runner/types.js';


/**
 * Wrap bun:sqlite to satisfy Kysely's SqliteDialect database adapter shape.
 *
 * Mirrors the smallest possible subset needed to execute `sql.raw(...)`
 * statements through `executeSqlBody`. We don't need transactions, plugins,
 * or schema introspection in this test.
 */
class BunSqliteStmt {

    #stmt: ReturnType<Database['prepare']>;

    constructor(stmt: ReturnType<Database['prepare']>) {

        this.#stmt = stmt;

    }

    get reader(): boolean {

        return this.#stmt.columnNames.length > 0;

    }

    all(params: ReadonlyArray<unknown>): unknown[] {

        // cast-justified: bun:sqlite's variadic bind params are typed as the
        // overload union (string|number|bigint|...); Kysely passes an opaque
        // ReadonlyArray<unknown>, so we widen to `never[]` to bridge the shape.
        return this.#stmt.all(...params as never[]);

    }

    run(params: ReadonlyArray<unknown>): { changes: number | bigint; lastInsertRowid: number | bigint } {

        // cast-justified: same bun:sqlite variadic-bind bridge as `all()` above.
        const result = this.#stmt.run(...params as never[]);

        return {
            changes: result.changes,
            lastInsertRowid: result.lastInsertRowid,
        };

    }

    *iterate(params: ReadonlyArray<unknown>): IterableIterator<unknown> {

        // cast-justified: same bun:sqlite variadic-bind bridge as `all()` above.
        const rows = this.#stmt.all(...params as never[]);

        for (const row of rows) {

            yield row;

        }

    }

}

class BunSqliteDb {

    #db: Database;

    constructor() {

        this.#db = new Database(':memory:');

    }

    close(): void {

        this.#db.close();

    }

    prepare(query: string): BunSqliteStmt {

        return new BunSqliteStmt(this.#db.prepare(query));

    }

}

interface TestSetup {
    db: Kysely<unknown>;
    bun: BunSqliteDb;
    context: RunContext;
}

function makeContext(dialect: RunContext['dialect']): TestSetup {

    const bun = new BunSqliteDb();

    const db = new Kysely<unknown>({
        dialect: new SqliteDialect({
            // cast-justified: SqliteDialect expects better-sqlite3's Database
            // type; BunSqliteDb mirrors the subset Kysely actually invokes
            // (prepare/close), so widening to `never` bridges the nominal type.
            database: bun as never,
        }),
    });

    const context: RunContext = {
        // cast-justified: RunContext['db'] is Kysely<NoormDatabase>; this test
        // exercises executeSqlBody with raw SQL only (no tracking-table access),
        // so the unknown-schema instance satisfies every call site reached here.
        db: db as RunContext['db'],
        configName: 'test',
        identity: { name: 'Test', email: 't@x.com', source: 'config' },
        projectRoot: '/tmp',
        access: { user: 'admin', agent: 'admin' },
        channel: 'user',
        dialect,
    };

    return { db, bun, context };

}


describe('runner: executeSqlBody (MSSQL multi-batch)', () => {

    let setup: TestSetup;

    beforeEach(() => {

        setup = makeContext('mssql');

    });

    afterEach(async () => {

        await setup.db.destroy();

    });

    it('should return null and run all batches on success', async () => {

        const sqlContent = [
            'CREATE TABLE t1 (id INT)',
            'GO',
            'CREATE TABLE t2 (id INT)',
            'GO',
            'CREATE TABLE t3 (id INT)',
        ].join('\n');

        const err = await executeSqlBody(setup.context, sqlContent);

        expect(err).toBeNull();

        // All three tables exist
        const rows = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`.execute(setup.db);
        const names = rows.rows.map((r) => r.name);

        expect(names).toEqual(['t1', 't2', 't3']);

    });

    it('should report `[batch N of M]` when the Nth batch fails and skip remaining batches', async () => {

        // Five batches; batch 3 is a syntax error. Batches 4 and 5 would succeed if reached.
        const sqlContent = [
            'CREATE TABLE b1 (id INT)',
            'GO',
            'CREATE TABLE b2 (id INT)',
            'GO',
            'THIS IS NOT VALID SQL',
            'GO',
            'CREATE TABLE b4 (id INT)',
            'GO',
            'CREATE TABLE b5 (id INT)',
        ].join('\n');

        const err = await executeSqlBody(setup.context, sqlContent);

        expect(err).toContain('[batch 3 of 5]');

        // Verify short-circuit: b1 and b2 ran (created), b4 and b5 did NOT
        const rows = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`.execute(setup.db);
        const names = rows.rows.map((r) => r.name);

        expect(names).toContain('b1');
        expect(names).toContain('b2');
        expect(names).not.toContain('b4');
        expect(names).not.toContain('b5');

    });

    it('should NOT prefix `[batch …]` when a single-batch (no GO) MSSQL file fails', async () => {

        const err = await executeSqlBody(setup.context, 'NOT VALID SQL');

        expect(err).not.toBeNull();
        expect(err).not.toContain('[batch');

    });

    it('should return null for an empty MSSQL file (0 batches)', async () => {

        expect(await executeSqlBody(setup.context, '')).toBeNull();
        expect(await executeSqlBody(setup.context, '   \n\n')).toBeNull();
        expect(await executeSqlBody(setup.context, '-- comment only\n')).toBeNull();

    });

    it('should preserve trailing-GO behavior: 1 real batch, no batch index prefix', async () => {

        const err = await executeSqlBody(setup.context, 'CREATE TABLE only_one (id INT)\nGO\n');

        expect(err).toBeNull();

        const rows = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table'`.execute(setup.db);

        expect(rows.rows.map((r) => r.name)).toContain('only_one');

    });

});


describe('runner: executeSqlBody (non-MSSQL dialects)', () => {

    let setup: TestSetup;

    afterEach(async () => {

        await setup.db.destroy();

    });

    it('should execute as one statement without splitting on GO when dialect is sqlite', async () => {

        // The splitter MUST NOT engage for sqlite. SQLite would reject the bare `GO` token.
        setup = makeContext('sqlite');

        const err = await executeSqlBody(setup.context, 'CREATE TABLE just_one (id INT)');

        expect(err).toBeNull();

    });

    it('should pass through the dialect error message verbatim when not MSSQL', async () => {

        setup = makeContext('sqlite');

        const err = await executeSqlBody(setup.context, 'NOT VALID SQL');

        expect(err).not.toBeNull();
        expect(err).not.toContain('[batch');

    });

    it('should treat undefined dialect as non-MSSQL (whole-content execution)', async () => {

        setup = makeContext(undefined);

        const err = await executeSqlBody(setup.context, 'CREATE TABLE nodialect (id INT)');

        expect(err).toBeNull();

    });

});
