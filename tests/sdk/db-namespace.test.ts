/**
 * DbNamespace truncate/teardown options tests.
 *
 * Verifies that user-provided options take priority over
 * settings.yml fallbacks for preserve lists.
 *
 * Uses Kysely DummyDriver with mocked executor — no mock.module
 * to avoid polluting the module cache for other test files.
 */
import { describe, it, expect, vi } from 'bun:test';

import {
    Kysely,
    DummyDriver,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
} from 'kysely';

import { DbNamespace } from '../../src/sdk/namespaces/db.js';

import type { ContextState } from '../../src/sdk/state.js';
import type { Config } from '../../src/core/config/types.js';
import type { Settings } from '../../src/core/settings/types.js';
import type { Identity } from '../../src/core/identity/types.js';

// ─────────────────────────────────────────────────────────────
// Test Fixtures
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

    let queryCount = 0;
    const originalExecutor = db.getExecutor();

    vi.spyOn(originalExecutor, 'provideConnection').mockImplementation(async (consumer) => {

        return consumer({
            executeQuery: vi.fn().mockImplementation(() => {

                queryCount++;

                // First query is listTables (or includeNoormTables),
                // subsequent queries (views, functions, FKs etc.) return empty
                return Promise.resolve({ rows: queryCount === 1 ? tableRows : [] });

            }),
            streamQuery: () => {

                throw new Error('not implemented');

            },
        });

    });

    return db;

}

function createMockConfig(): Config {

    return {
        name: 'test',
        type: 'local',
        isTest: true,
        access: { user: 'admin', mcp: 'admin' },
        connection: { dialect: 'postgres', database: 'testdb' },
    };

}

const mockIdentity: Identity = {
    name: 'tester',
    source: 'system',
};

function createState(
    settings: Settings = {},
    tableRows: Record<string, unknown>[] = [],
): ContextState {

    return {
        connection: { db: createMockKysely(tableRows), dialect: 'postgres' },
        config: createMockConfig(),
        settings,
        identity: mockIdentity,
        options: {},
        projectRoot: '/tmp/test-project',
        changeManager: null,
    };

}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('sdk: DbNamespace', () => {

    // ─────────────────────────────────────────────────────
    // truncate — settings fallback
    // ─────────────────────────────────────────────────────

    describe('truncate preserve fallback', () => {

        it('should fall back to settings.teardown.preserveTables when no options given', async () => {

            const state = createState(
                { teardown: { preserveTables: ['seeds', 'lookups'] } },
                [tableRow('users'), tableRow('seeds'), tableRow('lookups')],
            );
            const db = new DbNamespace(state);

            const result = await db.truncate({ dryRun: true });

            expect(result.truncated).toEqual(['users']);
            expect(result.preserved).toEqual(['seeds', 'lookups']);

        });

        it('should use user-provided preserve over settings', async () => {

            const state = createState(
                { teardown: { preserveTables: ['seeds', 'lookups'] } },
                [tableRow('users'), tableRow('posts'), tableRow('seeds'), tableRow('lookups')],
            );
            const db = new DbNamespace(state);

            // User explicitly preserves only 'users' — settings ignored
            const result = await db.truncate({ preserve: ['users'], dryRun: true });

            expect(result.truncated).toEqual(['posts', 'seeds', 'lookups']);
            expect(result.preserved).toEqual(['users']);

        });

        it('should truncate all tables when neither options nor settings provide preserve', async () => {

            const state = createState(
                {},
                [tableRow('users'), tableRow('posts')],
            );
            const db = new DbNamespace(state);

            const result = await db.truncate({ dryRun: true });

            expect(result.truncated).toEqual(['users', 'posts']);
            expect(result.preserved).toEqual([]);

        });

        it('should forward only option alongside settings preserve', async () => {

            const state = createState(
                { teardown: { preserveTables: ['seeds'] } },
                [tableRow('users'), tableRow('posts'), tableRow('seeds'), tableRow('comments')],
            );
            const db = new DbNamespace(state);

            const result = await db.truncate({ only: ['users', 'posts'], dryRun: true });

            // only + preserve: truncate users/posts, preserve seeds, comments not in only list
            expect(result.truncated).toEqual(['users', 'posts']);
            expect(result.preserved).toEqual(['seeds', 'comments']);

        });

        it('should always preserve __noorm_ tables', async () => {

            const state = createState(
                {},
                [tableRow('users'), tableRow('__noorm_changes')],
            );
            const db = new DbNamespace(state);

            const result = await db.truncate({ dryRun: true });

            expect(result.truncated).toEqual(['users']);
            expect(result.preserved).toEqual(['__noorm_changes']);

        });

    });

    // ─────────────────────────────────────────────────────
    // teardown — settings fallback
    // ─────────────────────────────────────────────────────

    describe('teardown settings fallback', () => {

        it('should preserve tables from settings.teardown.preserveTables', async () => {

            const state = createState(
                { teardown: { preserveTables: ['audit_log'] } },
                [tableRow('users'), tableRow('posts'), tableRow('audit_log')],
            );
            const db = new DbNamespace(state);

            const result = await db.teardown();

            expect(result.dropped.tables).toEqual(['users', 'posts']);
            expect(result.preserved).toEqual(['audit_log']);

        });

        it('should always preserve __noorm_ tables', async () => {

            const state = createState(
                {},
                [tableRow('users'), tableRow('__noorm_changes')],
            );
            const db = new DbNamespace(state);

            const result = await db.teardown();

            expect(result.dropped.tables).toEqual(['users']);
            expect(result.preserved).toEqual(['__noorm_changes']);

        });

        it('should drop all non-noorm tables when settings has no teardown', async () => {

            const state = createState(
                {},
                [tableRow('users'), tableRow('posts')],
            );
            const db = new DbNamespace(state);

            const result = await db.teardown();

            expect(result.dropped.tables).toEqual(['users', 'posts']);
            expect(result.preserved).toEqual([]);

        });

    });

    // ─────────────────────────────────────────────────────
    // Build fn — constructor injection, no public setter
    // ─────────────────────────────────────────────────────

    describe('build fn injection', () => {

        it('should not expose a public _buildFn setter', () => {

            const descriptor = Object.getOwnPropertyDescriptor(DbNamespace.prototype, '_buildFn');

            expect(descriptor).toBeUndefined();

        });

        it('should invoke the constructor-injected build fn on reset()', async () => {

            const state = createState(
                {},
                [tableRow('users')],
            );
            const buildFnStub = vi.fn().mockResolvedValue(undefined);
            const db = new DbNamespace(state, buildFnStub);

            await db.reset();

            expect(buildFnStub).toHaveBeenCalledWith({ force: true });

        });

    });

});
