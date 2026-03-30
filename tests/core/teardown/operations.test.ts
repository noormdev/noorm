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
