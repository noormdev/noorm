/**
 * Unit tests for teardown operations.
 *
 * Tests pure functions and preserve filtering logic.
 * Uses Kysely DummyDriver with mocked executor to avoid real DB,
 * while exercising the full truncateData/teardownSchema pipeline.
 */
import { describe, it, expect, vi } from 'bun:test';

import {
    Kysely,
    DummyDriver,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
} from 'kysely';

import { isNoormTable, truncateData, teardownSchema } from '../../../src/core/teardown/index.js';

// ─────────────────────────────────────────────────────────────
// Helpers — mock Kysely that returns controlled table rows
// ─────────────────────────────────────────────────────────────

function tableRow(name: string, schema = 'public') {

    return {
        table_name: name,
        table_schema: schema,
        column_count: '3',
        row_estimate: '100',
    };

}

function createMockKysely(tableRows: Record<string, unknown>[]) {

    const db = new Kysely<unknown>({
        dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (db) => new PostgresIntrospector(db),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
    });

    let callCount = 0;
    const originalExecutor = db.getExecutor();

    vi.spyOn(originalExecutor, 'provideConnection').mockImplementation(async (consumer) => {

        return consumer({
            executeQuery: vi.fn().mockImplementation(() => {

                callCount++;

                // First query is listTables (includeNoormTables),
                // subsequent queries are other object types — return empty
                return Promise.resolve({ rows: callCount === 1 ? tableRows : [] });

            }),
            streamQuery: () => {

                throw new Error('not implemented');

            },
        });

    });

    return db;

}

/**
 * Like createMockKysely, but returns different row sets per category.
 *
 * Mirrors the Promise.all order in teardownSchema:
 *   1. tables, 2. views, 3. functions, 4. procedures, 5. types, 6. foreignKeys
 *
 * Used to assert drop ordering with mixed object types present.
 */
function createMockKyselyForTeardown(rows: {
    tables?: Record<string, unknown>[];
    views?: Record<string, unknown>[];
    functions?: Record<string, unknown>[];
    procedures?: Record<string, unknown>[];
    types?: Record<string, unknown>[];
    foreignKeys?: Record<string, unknown>[];
}) {

    const db = new Kysely<unknown>({
        dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (db) => new PostgresIntrospector(db),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
    });

    const sequence: Record<string, unknown>[][] = [
        rows.tables ?? [],
        rows.views ?? [],
        rows.functions ?? [],
        rows.procedures ?? [],
        rows.types ?? [],
        rows.foreignKeys ?? [],
    ];

    let callCount = 0;
    const originalExecutor = db.getExecutor();

    vi.spyOn(originalExecutor, 'provideConnection').mockImplementation(async (consumer) => {

        return consumer({
            executeQuery: vi.fn().mockImplementation(() => {

                const next = sequence[callCount] ?? [];
                callCount++;

                return Promise.resolve({ rows: next });

            }),
            streamQuery: () => {

                throw new Error('not implemented');

            },
        });

    });

    return db;

}


describe('teardown: operations', () => {

    describe('isNoormTable', () => {

        it('returns true for tables starting with __noorm_', () => {

            expect(isNoormTable('__noorm_custom_table')).toBe(true);
            expect(isNoormTable('__noorm_test')).toBe(true);
            expect(isNoormTable('__noorm_')).toBe(true);

        });

        it('returns true for known NOORM_TABLES values', () => {

            expect(isNoormTable('__noorm_version__')).toBe(true);
            expect(isNoormTable('__noorm_change__')).toBe(true);
            expect(isNoormTable('__noorm_executions__')).toBe(true);
            expect(isNoormTable('__noorm_lock__')).toBe(true);
            expect(isNoormTable('__noorm_identities__')).toBe(true);

        });

        it('returns false for user tables', () => {

            expect(isNoormTable('users')).toBe(false);
            expect(isNoormTable('todo_lists')).toBe(false);
            expect(isNoormTable('products')).toBe(false);
            expect(isNoormTable('orders')).toBe(false);
            expect(isNoormTable('AppSettings')).toBe(false);

        });

        it('returns false for tables containing "noorm" but not starting with __noorm_', () => {

            expect(isNoormTable('noorm_users')).toBe(false);
            expect(isNoormTable('my_noorm_table')).toBe(false);
            expect(isNoormTable('_noorm_test')).toBe(false);
            expect(isNoormTable('noorm')).toBe(false);

        });

        it('returns false for tables with __noorm prefix variations', () => {

            expect(isNoormTable('_noorm_version')).toBe(false);
            expect(isNoormTable('___noorm_version')).toBe(false);
            expect(isNoormTable('NOORM_version')).toBe(false);
            expect(isNoormTable('__NOORM_version')).toBe(false);

        });

        it('returns false for empty string', () => {

            expect(isNoormTable('')).toBe(false);

        });

        it('handles case sensitivity correctly', () => {

            // Should be case-sensitive
            expect(isNoormTable('__NOORM_version__')).toBe(false);
            expect(isNoormTable('__Noorm_version__')).toBe(false);

        });

    });

});

// ─────────────────────────────────────────────────────────────
// truncateData — preserve filtering (dryRun, real function)
// ─────────────────────────────────────────────────────────────

describe('teardown: truncateData preserve filtering', () => {

    it('should truncate all non-noorm tables when no preserve given', async () => {

        const db = createMockKysely([
            tableRow('users'),
            tableRow('posts'),
            tableRow('comments'),
            tableRow('__noorm_changes'),
        ]);

        const result = await truncateData(db, 'postgres', { dryRun: true });

        expect(result.truncated).toEqual(['users', 'posts', 'comments']);
        expect(result.preserved).toEqual(['__noorm_changes']);

    });

    it('should preserve tables listed in preserve option', async () => {

        const db = createMockKysely([
            tableRow('users'),
            tableRow('posts'),
            tableRow('seeds'),
            tableRow('lookups'),
        ]);

        const result = await truncateData(db, 'postgres', {
            preserve: ['seeds', 'lookups'],
            dryRun: true,
        });

        expect(result.truncated).toEqual(['users', 'posts']);
        expect(result.preserved).toEqual(['seeds', 'lookups']);

    });

    it('should truncate only tables in the only list', async () => {

        const db = createMockKysely([
            tableRow('users'),
            tableRow('posts'),
            tableRow('comments'),
            tableRow('seeds'),
        ]);

        const result = await truncateData(db, 'postgres', {
            only: ['users', 'posts'],
            dryRun: true,
        });

        expect(result.truncated).toEqual(['users', 'posts']);
        expect(result.preserved).toEqual(['comments', 'seeds']);

    });

    it('should combine preserve and only filters', async () => {

        const db = createMockKysely([
            tableRow('users'),
            tableRow('posts'),
            tableRow('seeds'),
            tableRow('lookups'),
        ]);

        const result = await truncateData(db, 'postgres', {
            preserve: ['seeds'],
            only: ['users', 'posts', 'seeds'],
            dryRun: true,
        });

        expect(result.truncated).toEqual(['users', 'posts']);
        expect(result.preserved).toEqual(['seeds', 'lookups']);

    });

    it('should always preserve __noorm_ tables even if listed in only', async () => {

        const db = createMockKysely([
            tableRow('users'),
            tableRow('__noorm_changes'),
            tableRow('__noorm_history'),
        ]);

        const result = await truncateData(db, 'postgres', {
            only: ['users', '__noorm_changes'],
            dryRun: true,
        });

        expect(result.truncated).toEqual(['users']);
        expect(result.preserved).toEqual(['__noorm_changes', '__noorm_history']);

    });

    it('should generate correct SQL excluding preserved tables', async () => {

        const db = createMockKysely([
            tableRow('users'),
            tableRow('seeds'),
        ]);

        const result = await truncateData(db, 'postgres', {
            preserve: ['seeds'],
            dryRun: true,
        });

        const truncateStmts = result.statements.filter(s => s.includes('TRUNCATE'));
        expect(truncateStmts).toEqual(['TRUNCATE TABLE "users" RESTART IDENTITY CASCADE']);

    });

    it('emits zero statements when there is nothing to truncate', async () => {

        const db = createMockKysely([
            tableRow('seeds'),
            tableRow('lookups'),
        ]);

        const result = await truncateData(db, 'postgres', {
            preserve: ['seeds', 'lookups'],
            dryRun: true,
        });

        expect(result.truncated).toEqual([]);
        // No FK disable/enable bookends when nothing is being truncated
        expect(result.statements).toEqual([]);

    });

});

// ─────────────────────────────────────────────────────────────
// truncateData — MSSQL per-table NOCHECK (M-6 deadlock fix)
// ─────────────────────────────────────────────────────────────

describe('teardown: truncateData mssql NOCHECK strategy (M-6)', () => {

    it('emits per-table NOCHECK then per-table DELETE then per-table CHECK', async () => {

        const db = createMockKysely([
            { table_name: 'users', schema_name: 'dbo', column_count: 3, row_count: 0 },
            { table_name: 'posts', schema_name: 'dbo', column_count: 3, row_count: 0 },
        ]);

        const result = await truncateData(db, 'mssql', { dryRun: true });

        // Expect three groups: NOCHECK x2, DELETE x2, CHECK x2.
        // Order within each group preserves the table-list order.
        const nocheck = result.statements.filter((s) => s.includes('NOCHECK CONSTRAINT ALL'));
        const checks = result.statements.filter((s) => s.includes('CHECK CONSTRAINT ALL') && !s.includes('NOCHECK'));
        const deletes = result.statements.filter((s) => s.includes('DELETE FROM'));

        // truncateData passes only table names (no schema) to the dialect ops,
        // so the emitted ALTER/DELETE statements are unqualified.
        expect(nocheck).toEqual([
            'ALTER TABLE [users] NOCHECK CONSTRAINT ALL',
            'ALTER TABLE [posts] NOCHECK CONSTRAINT ALL',
        ]);
        expect(deletes.length).toBe(2);
        expect(deletes[0]).toContain('DELETE FROM [users]');
        expect(deletes[1]).toContain('DELETE FROM [posts]');
        expect(checks).toEqual([
            'ALTER TABLE [users] CHECK CONSTRAINT ALL',
            'ALTER TABLE [posts] CHECK CONSTRAINT ALL',
        ]);

    });

    it('never emits sp_MSforeachtable for mssql truncate (regression guard)', async () => {

        const db = createMockKysely([
            { table_name: 'A', schema_name: 'dbo', column_count: 1, row_count: 0 },
            { table_name: 'B', schema_name: 'dbo', column_count: 1, row_count: 0 },
            { table_name: 'C', schema_name: 'dbo', column_count: 1, row_count: 0 },
        ]);

        const result = await truncateData(db, 'mssql', { dryRun: true });
        const joined = result.statements.join('\n');

        expect(joined).not.toContain('sp_MSforeachtable');

    });

    it('preserves identity reseed (DBCC CHECKIDENT) for mssql', async () => {

        const db = createMockKysely([
            { table_name: 'users', schema_name: 'dbo', column_count: 1, row_count: 0 },
        ]);

        const result = await truncateData(db, 'mssql', { dryRun: true });

        const hasReseed = result.statements.some((s) => s.includes('DBCC CHECKIDENT'));
        expect(hasReseed).toBe(true);

    });

    it('produces full statement sequence for an only-list (NOCHECK → DELETE → CHECK)', async () => {

        const db = createMockKysely([
            { table_name: 'A', schema_name: 'dbo', column_count: 1, row_count: 0 },
            { table_name: 'B', schema_name: 'dbo', column_count: 1, row_count: 0 },
            { table_name: 'C', schema_name: 'dbo', column_count: 1, row_count: 0 },
        ]);

        const result = await truncateData(db, 'mssql', {
            only: ['A', 'B'],
            dryRun: true,
        });

        expect(result.truncated).toEqual(['A', 'B']);

        const firstNocheckIdx = result.statements.findIndex((s) => s.includes('NOCHECK CONSTRAINT ALL'));
        const firstDeleteIdx = result.statements.findIndex((s) => s.includes('DELETE FROM'));
        const firstCheckIdx = result.statements.findIndex(
            (s) => s.includes('CHECK CONSTRAINT ALL') && !s.includes('NOCHECK'),
        );

        expect(firstNocheckIdx).toBeLessThan(firstDeleteIdx);
        expect(firstDeleteIdx).toBeLessThan(firstCheckIdx);

    });

});

// ─────────────────────────────────────────────────────────────
// truncateData — other dialects (no behavior change)
// ─────────────────────────────────────────────────────────────

describe('teardown: truncateData session-level FK toggle dialects', () => {

    it('postgres emits single SET disable/enable around truncates', async () => {

        const db = createMockKysely([
            tableRow('users'),
        ]);

        const result = await truncateData(db, 'postgres', { dryRun: true });

        expect(result.statements[0]).toBe('SET session_replication_role = \'replica\'');
        expect(result.statements[result.statements.length - 1]).toBe('SET session_replication_role = \'origin\'');

    });

});

// ─────────────────────────────────────────────────────────────
// teardownSchema — preserveTables filtering (dryRun, real pipeline)
// ─────────────────────────────────────────────────────────────

describe('teardown: teardownSchema preserveTables filtering', () => {

    it('should preserve tables listed in preserveTables option', async () => {

        const db = createMockKysely([
            tableRow('users'),
            tableRow('posts'),
            tableRow('audit_log'),
        ]);

        const result = await teardownSchema(db, 'postgres', {
            preserveTables: ['audit_log'],
            dryRun: true,
        });

        expect(result.dropped.tables).toEqual(['users', 'posts']);
        expect(result.preserved).toEqual(['audit_log']);

    });

    it('should always preserve __noorm_ tables regardless of preserveTables', async () => {

        const db = createMockKysely([
            tableRow('users'),
            tableRow('__noorm_changes'),
        ]);

        const result = await teardownSchema(db, 'postgres', { dryRun: true });

        expect(result.dropped.tables).toEqual(['users']);
        expect(result.preserved).toEqual(['__noorm_changes']);

    });

});

// ─────────────────────────────────────────────────────────────
// teardownSchema — drop order (M-5: schema-bound deps)
// MSSQL schema-bound UDFs/views hold dependency locks on tables.
// Procs/funcs/views must be dropped BEFORE tables. Types last.
// ─────────────────────────────────────────────────────────────

describe('teardown: teardownSchema drop order', () => {

    it('drops mssql objects in order: FK → Procs → Funcs → Views → Tables → Types', async () => {

        // MSSQL explore row shapes — see src/core/explore/dialects/mssql.ts
        const db = createMockKyselyForTeardown({
            tables: [
                { table_name: 'Memory', schema_name: 'dbo', column_count: 3, row_count: 0 },
            ],
            views: [
                { view_name: 'vw_Memory', schema_name: 'dbo', column_count: 2 },
            ],
            functions: [
                { func_name: 'fn_MemoryConfidence', schema_name: 'dbo', param_count: 1, return_type: 'scalar' },
            ],
            procedures: [
                { proc_name: 'sp_Memory_Create', schema_name: 'dbo', param_count: 2 },
            ],
            types: [],
            foreignKeys: [],
        });

        const result = await teardownSchema(db, 'mssql', { dryRun: true });

        // Filter out comment-only lines (e.g. from sqlite no-op statements)
        const stmts = result.statements.filter((s) => !s.startsWith('--'));

        const procIdx = stmts.findIndex((s) => s.includes('DROP PROCEDURE') && s.includes('sp_Memory_Create'));
        const funcIdx = stmts.findIndex((s) => s.includes('DROP FUNCTION') && s.includes('fn_MemoryConfidence'));
        const viewIdx = stmts.findIndex((s) => s.includes('DROP VIEW') && s.includes('vw_Memory'));
        const tableIdx = stmts.findIndex((s) => s.includes('DROP TABLE') && s.includes('Memory') && !s.includes('vw_'));

        expect(procIdx).toBeGreaterThanOrEqual(0);
        expect(funcIdx).toBeGreaterThan(procIdx);
        expect(viewIdx).toBeGreaterThan(funcIdx);
        expect(tableIdx).toBeGreaterThan(viewIdx);

    });

    it('drops fks before procedures/functions/views/tables', async () => {

        const db = createMockKyselyForTeardown({
            tables: [
                { table_name: 'orders', schema_name: 'dbo', column_count: 3, row_count: 0 },
            ],
            views: [
                { view_name: 'vw_orders', schema_name: 'dbo', column_count: 2 },
            ],
            functions: [
                { func_name: 'fn_total', schema_name: 'dbo', param_count: 0, return_type: 'scalar' },
            ],
            procedures: [
                { proc_name: 'sp_run', schema_name: 'dbo', param_count: 0 },
            ],
            types: [],
            foreignKeys: [
                {
                    fk_name: 'fk_orders_user',
                    schema_name: 'dbo',
                    table_name: 'orders',
                    column_name: 'user_id',
                    ref_schema: 'dbo',
                    ref_table: 'users',
                    ref_column: 'id',
                    delete_action: 'NO ACTION',
                    update_action: 'NO ACTION',
                },
            ],
        });

        const result = await teardownSchema(db, 'mssql', { dryRun: true });
        const stmts = result.statements.filter((s) => !s.startsWith('--'));

        const fkIdx = stmts.findIndex((s) => s.includes('DROP CONSTRAINT') && s.includes('fk_orders_user'));
        const procIdx = stmts.findIndex((s) => s.includes('DROP PROCEDURE'));
        const funcIdx = stmts.findIndex((s) => s.includes('DROP FUNCTION'));
        const viewIdx = stmts.findIndex((s) => s.includes('DROP VIEW'));
        const tableIdx = stmts.findIndex((s) => s.includes('DROP TABLE'));

        expect(fkIdx).toBeGreaterThanOrEqual(0);
        expect(procIdx).toBeGreaterThan(fkIdx);
        expect(funcIdx).toBeGreaterThan(procIdx);
        expect(viewIdx).toBeGreaterThan(funcIdx);
        expect(tableIdx).toBeGreaterThan(viewIdx);

    });

    it('drops types last (after tables)', async () => {

        const db = createMockKyselyForTeardown({
            tables: [
                { table_name: 'orders', schema_name: 'dbo', column_count: 3, row_count: 0 },
            ],
            types: [
                { type_name: 'EmailAddress', schema_name: 'dbo', is_table_type: false },
            ],
        });

        const result = await teardownSchema(db, 'mssql', { dryRun: true });
        const stmts = result.statements.filter((s) => !s.startsWith('--'));

        const tableIdx = stmts.findIndex((s) => s.includes('DROP TABLE'));
        const typeIdx = stmts.findIndex((s) => s.includes('DROP TYPE'));

        expect(tableIdx).toBeGreaterThanOrEqual(0);
        expect(typeIdx).toBeGreaterThan(tableIdx);

    });

});
