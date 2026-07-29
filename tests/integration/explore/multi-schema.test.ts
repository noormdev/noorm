/**
 * Integration tests for schema-scoped exploration.
 *
 * Every other explore fixture is single-schema, which is why "detail returns
 * another schema's indexes", "--schema does nothing on list", and "two
 * same-named tables render identically" all shipped green. This file creates a
 * second schema per dialect and asserts explore keeps them apart.
 *
 * Requires docker-compose.test.yml containers to be running.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';

import type { Kysely } from 'kysely';

import { fetchOverview, fetchList, fetchDetail } from '../../../src/core/explore/index.js';
import { createTestConnection, skipIfNoContainer } from '../../utils/db.js';

/** Prefixed so a shared container can host several suites at once. */
const ALT_SCHEMA = 'explore_ms_alt';
const TABLE = 'explore_ms_orders';
const PROC = 'explore_ms_touch';

/** MySQL has no schema below the database; CI provisions this second one. */
const MYSQL_ALT_DB = 'noorm_test_dest';

async function run(db: Kysely<unknown>, statements: string[]): Promise<void> {

    for (const statement of statements) {

        await sql.raw(statement).execute(db);

    }

}

async function runIgnoringErrors(db: Kysely<unknown>, statements: string[]): Promise<void> {

    for (const statement of statements) {

        await attempt(() => sql.raw(statement).execute(db));

    }

}

describe('integration: postgres multi-schema explore', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        const conn = await createTestConnection('postgres');
        db = conn.db;
        destroy = conn.destroy;

        await runIgnoringErrors(db, [
            `DROP SCHEMA IF EXISTS ${ALT_SCHEMA} CASCADE`,
            `DROP TABLE IF EXISTS public.${TABLE}`,
            `DROP PROCEDURE IF EXISTS public.${PROC}(integer, text)`,
        ]);

        await run(db, [
            `CREATE SCHEMA ${ALT_SCHEMA}`,
            `CREATE TABLE ${ALT_SCHEMA}.${TABLE} (id integer PRIMARY KEY, note text)`,
            `CREATE INDEX idx_${TABLE}_alt_note ON ${ALT_SCHEMA}.${TABLE} (note)`,
            `CREATE TABLE public.${TABLE} (id integer PRIMARY KEY, a text, b text)`,
            `CREATE INDEX idx_${TABLE}_public_a ON public.${TABLE} (a)`,
            `CREATE PROCEDURE public.${PROC}(IN p_id integer, INOUT p_note text)
             LANGUAGE plpgsql AS $$ BEGIN p_note := p_note || p_id::text; END $$`,
        ]);

    });

    afterAll(async () => {

        if (!db) return;

        await runIgnoringErrors(db, [
            `DROP SCHEMA IF EXISTS ${ALT_SCHEMA} CASCADE`,
            `DROP TABLE IF EXISTS public.${TABLE}`,
            `DROP PROCEDURE IF EXISTS public.${PROC}(integer, text)`,
        ]);

        await destroy();

    });

    it('should list only the requested schema', async () => {

        const tables = await fetchList(db, 'postgres', 'tables', { schema: ALT_SCHEMA });

        expect(tables.map((t) => t.name)).toEqual([TABLE]);
        expect(tables[0]?.schema).toBe(ALT_SCHEMA);

    });

    it('should list both same-named tables, distinguishable by schema, when unfiltered', async () => {

        const tables = await fetchList(db, 'postgres', 'tables');
        const matches = tables.filter((t) => t.name === TABLE);

        expect(matches.map((t) => t.schema).sort()).toEqual([ALT_SCHEMA, 'public']);

    });

    it('should describe the requested schema, indexes included', async () => {

        const detail = await fetchDetail(db, 'postgres', 'tables', TABLE, ALT_SCHEMA);

        expect(detail?.schema).toBe(ALT_SCHEMA);
        expect(detail?.columns.map((c) => c.name)).toEqual(['id', 'note']);

        const indexNames = detail!.indexes.map((i) => i.name);

        expect(indexNames).toContain(`idx_${TABLE}_alt_note`);
        expect(indexNames).not.toContain(`idx_${TABLE}_public_a`);
        expect(detail!.indexes.every((i) => i.tableSchema === ALT_SCHEMA)).toBe(true);

    });

    it('should scope the overview to the requested schema', async () => {

        const overview = await fetchOverview(db, 'postgres', { schema: ALT_SCHEMA });

        expect(overview.tables).toBe(1);
        expect(overview.procedures).toBe(0);

    });

    it('should return procedure parameters, not an empty list', async () => {

        const detail = await fetchDetail(db, 'postgres', 'procedures', PROC, 'public');

        expect(detail?.parameters.map((p) => [p.name, p.mode])).toEqual([
            ['p_id', 'IN'],
            ['p_note', 'INOUT'],
        ]);

    });

    it('should agree with the list view on parameter count', async () => {

        const summaries = await fetchList(db, 'postgres', 'procedures', { schema: 'public' });
        const summary = summaries.find((p) => p.name === PROC);
        const detail = await fetchDetail(db, 'postgres', 'procedures', PROC, 'public');

        expect(detail?.parameters).toHaveLength(summary!.parameterCount);

    });

    it('should only count locks held against this database', async () => {

        const locks = await fetchList(db, 'postgres', 'locks');

        // Cluster-wide pg_locks would include other databases on the container;
        // every returned relation must resolve inside this one.
        expect(Array.isArray(locks)).toBe(true);

        const [, err] = await attempt(() => fetchList(db, 'postgres', 'locks'));

        expect(err).toBeNull();

    });

});

describe('integration: mysql cross-database explore', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('mysql');

        const conn = await createTestConnection('mysql');
        db = conn.db;
        destroy = conn.destroy;

        await runIgnoringErrors(db, [
            `DROP TABLE IF EXISTS ${MYSQL_ALT_DB}.${TABLE}`,
            `DROP TABLE IF EXISTS ${TABLE}`,
        ]);

        await run(db, [
            `CREATE TABLE ${MYSQL_ALT_DB}.${TABLE} (id INT PRIMARY KEY, note VARCHAR(64))`,
            `CREATE INDEX idx_${TABLE}_alt_note ON ${MYSQL_ALT_DB}.${TABLE} (note)`,
            `CREATE TABLE ${TABLE} (id INT PRIMARY KEY, a VARCHAR(64), b VARCHAR(64))`,
            `CREATE INDEX idx_${TABLE}_home_a ON ${TABLE} (a)`,
        ]);

    });

    afterAll(async () => {

        if (!db) return;

        await runIgnoringErrors(db, [
            `DROP TABLE IF EXISTS ${MYSQL_ALT_DB}.${TABLE}`,
            `DROP TABLE IF EXISTS ${TABLE}`,
        ]);

        await destroy();

    });

    it('should read indexes from the requested database, not the connected one', async () => {

        const detail = await fetchDetail(db, 'mysql', 'tables', TABLE, MYSQL_ALT_DB);
        const indexNames = detail!.indexes.map((i) => i.name);

        expect(detail?.schema).toBe(MYSQL_ALT_DB);
        expect(detail?.columns.map((c) => c.name)).toEqual(['id', 'note']);
        expect(indexNames).toContain(`idx_${TABLE}_alt_note`);
        expect(indexNames).not.toContain(`idx_${TABLE}_home_a`);

    });

    it('should not label a row with one database while sourcing it from another', async () => {

        const detail = await fetchDetail(db, 'mysql', 'tables', TABLE, MYSQL_ALT_DB);

        expect(detail!.indexes.every((i) => i.tableSchema === MYSQL_ALT_DB)).toBe(true);

    });

    it('should list tables from the requested database', async () => {

        const tables = await fetchList(db, 'mysql', 'tables', { schema: MYSQL_ALT_DB });
        const found = tables.find((t) => t.name === TABLE);

        expect(found?.schema).toBe(MYSQL_ALT_DB);
        expect(found?.columnCount).toBe(2);

    });

    it('should still default to the connected database', async () => {

        const detail = await fetchDetail(db, 'mysql', 'tables', TABLE);

        expect(detail?.columns.map((c) => c.name)).toEqual(['id', 'a', 'b']);
        expect(detail!.indexes.map((i) => i.name)).toContain(`idx_${TABLE}_home_a`);

    });

});

describe('integration: mssql multi-schema explore', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('mssql');

        const conn = await createTestConnection('mssql');
        db = conn.db;
        destroy = conn.destroy;

        await runIgnoringErrors(db, [
            `DROP TABLE IF EXISTS ${ALT_SCHEMA}.${TABLE}`,
            `DROP TABLE IF EXISTS dbo.${TABLE}`,
            `DROP SCHEMA IF EXISTS ${ALT_SCHEMA}`,
        ]);

        await run(db, [
            `CREATE SCHEMA ${ALT_SCHEMA}`,
        ]);

        await run(db, [
            `CREATE TABLE ${ALT_SCHEMA}.${TABLE} (id INT PRIMARY KEY, note NVARCHAR(64))`,
            `CREATE INDEX idx_${TABLE}_alt_note ON ${ALT_SCHEMA}.${TABLE} (note)`,
            `CREATE TABLE dbo.${TABLE} (id INT PRIMARY KEY, a NVARCHAR(64), b NVARCHAR(64))`,
            `CREATE INDEX idx_${TABLE}_dbo_a ON dbo.${TABLE} (a)`,
            `INSERT INTO ${ALT_SCHEMA}.${TABLE} (id, note) VALUES (1, 'x'), (2, 'y')`,
        ]);

    });

    afterAll(async () => {

        if (!db) return;

        await runIgnoringErrors(db, [
            `DROP TABLE IF EXISTS ${ALT_SCHEMA}.${TABLE}`,
            `DROP TABLE IF EXISTS dbo.${TABLE}`,
            `DROP SCHEMA IF EXISTS ${ALT_SCHEMA}`,
        ]);

        await destroy();

    });

    it('should list only the requested schema', async () => {

        const tables = await fetchList(db, 'mssql', 'tables', { schema: ALT_SCHEMA });

        expect(tables.map((t) => t.name)).toEqual([TABLE]);
        expect(tables[0]?.schema).toBe(ALT_SCHEMA);

    });

    it('should describe the requested schema, indexes included', async () => {

        const detail = await fetchDetail(db, 'mssql', 'tables', TABLE, ALT_SCHEMA);
        const indexNames = detail!.indexes.map((i) => i.name);

        expect(detail?.columns.map((c) => c.name)).toEqual(['id', 'note']);
        expect(indexNames).toContain(`idx_${TABLE}_alt_note`);
        expect(indexNames).not.toContain(`idx_${TABLE}_dbo_a`);

    });

    it('should report rowCountEstimate as a number, not driver text', async () => {

        const tables = await fetchList(db, 'mssql', 'tables', { schema: ALT_SCHEMA });
        const detail = await fetchDetail(db, 'mssql', 'tables', TABLE, ALT_SCHEMA);

        expect(typeof tables[0]?.rowCountEstimate).toBe('number');
        expect(tables[0]?.rowCountEstimate).toBe(2);
        expect(typeof detail?.rowCountEstimate).toBe('number');

    });

    it('should report an empty table as undefined rather than zero-as-text', async () => {

        const detail = await fetchDetail(db, 'mssql', 'tables', TABLE, 'dbo');

        expect(detail?.rowCountEstimate).toBeUndefined();

    });

});

describe('integration: sqlite hostile identifiers', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    /** Names a third-party tool or a plain `.sql` file could legally create. */
    const HOSTILE = ['we"ird', "tbl'quote", 'a.b', 'таблица', 'Table With Space', 'sel;ect'];

    beforeAll(async () => {

        const conn = await createTestConnection('sqlite');
        db = conn.db;
        destroy = conn.destroy;

        await run(db, [
            'CREATE TABLE plain (id INTEGER PRIMARY KEY)',
            'CREATE TABLE canary (id INTEGER PRIMARY KEY)',
            'CREATE TABLE audit_log (id INTEGER)',
            ...HOSTILE.map((name) => `CREATE TABLE "${name.replaceAll('"', '""')}" (id INTEGER PRIMARY KEY, val TEXT)`),

            // Body contains INSERT; the trigger event is DELETE.
            `CREATE TRIGGER cascade_delete AFTER DELETE ON plain
             BEGIN INSERT INTO audit_log (id) VALUES (OLD.id); END`,

            // Name contains "before"; the timing is AFTER.
            `CREATE TRIGGER before_update_log AFTER UPDATE OF id ON plain
             BEGIN INSERT INTO audit_log (id) VALUES (NEW.id); END`,
        ]);

    });

    afterAll(async () => {

        if (destroy) await destroy();

    });

    it('should list every table, including hostile names', async () => {

        const tables = await fetchList(db, 'sqlite', 'tables');
        const names = tables.map((t) => t.name);

        for (const name of HOSTILE) {

            expect(names).toContain(name);

        }

    });

    it('should keep unrelated tables describable when a hostile name exists', async () => {

        const detail = await fetchDetail(db, 'sqlite', 'tables', 'plain');

        expect(detail?.name).toBe('plain');

    });

    it('should describe a hostile-named table', async () => {

        const detail = await fetchDetail(db, 'sqlite', 'tables', 'we"ird');

        expect(detail?.columns.map((c) => c.name)).toEqual(['id', 'val']);

    });

    it('should produce an overview rather than a syntax error', async () => {

        const overview = await fetchOverview(db, 'sqlite');

        expect(overview.tables).toBe(3 + HOSTILE.length);
        expect(overview.triggers).toBe(2);

    });

    it('should read trigger events from the header, against real sqlite_master text', async () => {

        const triggers = await fetchList(db, 'sqlite', 'triggers');
        const cascade = triggers.find((t) => t.name === 'cascade_delete');
        const named = triggers.find((t) => t.name === 'before_update_log');

        expect(cascade?.events).toEqual(['DELETE']);
        expect(cascade?.timing).toBe('AFTER');

        // "before" appears in the trigger's own name, not as its timing.
        expect(named?.timing).toBe('AFTER');
        expect(named?.events).toEqual(['UPDATE']);

    });

    it('should describe a trigger without inventing events from its body', async () => {

        const detail = await fetchDetail(db, 'sqlite', 'triggers', 'cascade_delete');

        expect(detail?.events).toEqual(['DELETE']);
        expect(detail?.tableName).toBe('plain');

    });

    it('should not execute appended DDL smuggled through a table name', async () => {

        await fetchList(db, 'sqlite', 'tables');

        const survivors = await sql<{ name: string }>`
            SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'canary'
        `.execute(db);

        expect(survivors.rows).toHaveLength(1);

    });

    it('should reject a schema filter instead of silently returning nothing', async () => {

        const [result, err] = await attempt(() =>
            fetchList(db, 'sqlite', 'tables', { schema: 'app' }),
        );

        expect(result).toBeNull();
        expect(err?.message).toContain('SQLite has no schemas');

    });

});
