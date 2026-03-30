/**
 * DbNamespace truncate/teardown options tests.
 *
 * Verifies that user-provided options take priority over
 * settings.yml fallbacks for preserve lists.
 */
import { describe, it, expect, vi, mock, beforeEach } from 'bun:test';

import type { TruncateOptions } from '../../src/core/teardown/types.js';
import type { TeardownOptions } from '../../src/core/teardown/types.js';

// ─────────────────────────────────────────────────────────────
// Module Mocks
// ─────────────────────────────────────────────────────────────

const truncateDataMock = vi.fn().mockResolvedValue({
    truncated: [],
    preserved: [],
    statements: [],
    durationMs: 0,
});

const teardownSchemaMock = vi.fn().mockResolvedValue({
    dropped: { tables: [], views: [], functions: [], procedures: [], types: [], foreignKeys: [] },
    preserved: [],
    statements: [],
    durationMs: 0,
});

const previewTeardownMock = vi.fn().mockResolvedValue({
    toDrop: { tables: [], views: [], functions: [], procedures: [], types: [], foreignKeys: [] },
    toPreserve: [],
    statements: [],
});

mock.module('../../src/core/teardown/index.js', () => ({
    truncateData: truncateDataMock,
    teardownSchema: teardownSchemaMock,
    previewTeardown: previewTeardownMock,
}));

mock.module('../../src/core/explore/index.js', () => ({
    fetchOverview: vi.fn(),
    fetchList: vi.fn(),
    fetchDetail: vi.fn(),
}));


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

function createMockKysely() {

    return new Kysely<unknown>({
        dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (db) => new PostgresIntrospector(db),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
    });

}

function createMockConfig(): Config {

    return {
        name: 'test',
        type: 'local',
        isTest: true,
        protected: false,
        connection: { dialect: 'postgres', database: 'testdb' },
    };

}

const mockIdentity: Identity = {
    name: 'tester',
    source: 'system',
};

function createState(settings: Settings = {}): ContextState {

    return {
        connection: { db: createMockKysely(), dialect: 'postgres' },
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

    beforeEach(() => {

        truncateDataMock.mockClear();
        teardownSchemaMock.mockClear();

    });

    // ─────────────────────────────────────────────────────
    // truncate — settings fallback
    // ─────────────────────────────────────────────────────

    describe('truncate preserve fallback', () => {

        it('should fall back to settings.teardown.preserveTables when no options given', async () => {

            const state = createState({
                teardown: { preserveTables: ['seeds', 'lookups'] },
            });
            const db = new DbNamespace(state);

            await db.truncate();

            const passedOptions = truncateDataMock.mock.calls[0][2] as TruncateOptions;
            expect(passedOptions.preserve).toEqual(['seeds', 'lookups']);

        });

        it('should use user-provided preserve over settings', async () => {

            const state = createState({
                teardown: { preserveTables: ['seeds', 'lookups'] },
            });
            const db = new DbNamespace(state);

            await db.truncate({ preserve: ['users'] });

            const passedOptions = truncateDataMock.mock.calls[0][2] as TruncateOptions;
            expect(passedOptions.preserve).toEqual(['users']);

        });

        it('should pass undefined preserve when neither options nor settings provide one', async () => {

            const state = createState({});
            const db = new DbNamespace(state);

            await db.truncate();

            const passedOptions = truncateDataMock.mock.calls[0][2] as TruncateOptions;
            expect(passedOptions.preserve).toBeUndefined();

        });

        it('should forward only option alongside settings preserve', async () => {

            const state = createState({
                teardown: { preserveTables: ['seeds'] },
            });
            const db = new DbNamespace(state);

            await db.truncate({ only: ['users', 'posts'] });

            const passedOptions = truncateDataMock.mock.calls[0][2] as TruncateOptions;
            expect(passedOptions.only).toEqual(['users', 'posts']);
            expect(passedOptions.preserve).toEqual(['seeds']);

        });

        it('should forward dryRun and restartIdentity options', async () => {

            const state = createState({});
            const db = new DbNamespace(state);

            await db.truncate({ dryRun: true, restartIdentity: false });

            const passedOptions = truncateDataMock.mock.calls[0][2] as TruncateOptions;
            expect(passedOptions.dryRun).toBe(true);
            expect(passedOptions.restartIdentity).toBe(false);

        });

    });

    // ─────────────────────────────────────────────────────
    // teardown — settings fallback
    // ─────────────────────────────────────────────────────

    describe('teardown settings fallback', () => {

        it('should pass preserveTables from settings', async () => {

            const state = createState({
                teardown: { preserveTables: ['audit_log', 'app_config'] },
            });
            const db = new DbNamespace(state);

            await db.teardown();

            const passedOptions = teardownSchemaMock.mock.calls[0][2] as TeardownOptions;
            expect(passedOptions.preserveTables).toEqual(['audit_log', 'app_config']);

        });

        it('should pass postScript from settings', async () => {

            const state = createState({
                teardown: { postScript: 'sql/teardown/cleanup.sql' },
            });
            const db = new DbNamespace(state);

            await db.teardown();

            const passedOptions = teardownSchemaMock.mock.calls[0][2] as TeardownOptions;
            expect(passedOptions.postScript).toBe('sql/teardown/cleanup.sql');

        });

        it('should pass undefined preserveTables when settings has no teardown', async () => {

            const state = createState({});
            const db = new DbNamespace(state);

            await db.teardown();

            const passedOptions = teardownSchemaMock.mock.calls[0][2] as TeardownOptions;
            expect(passedOptions.preserveTables).toBeUndefined();
            expect(passedOptions.postScript).toBeUndefined();

        });

        it('should always pass configName and executedBy', async () => {

            const state = createState({});
            const db = new DbNamespace(state);

            await db.teardown();

            const passedOptions = teardownSchemaMock.mock.calls[0][2] as TeardownOptions;
            expect(passedOptions.configName).toBe('test');
            expect(passedOptions.executedBy).toBe('tester');

        });

    });

});
