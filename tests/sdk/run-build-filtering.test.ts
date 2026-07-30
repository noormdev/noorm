/**
 * SDK run.build() include/exclude/rules filtering tests.
 *
 * Proves ctx.noorm.run.build() honors settings.build.include/exclude and
 * settings.rules identically to the TUI's Run Build screen
 * (`RunBuildScreen.tsx`'s loading effect), and that db.reset()'s rebuild
 * inherits the same filtering purely through its existing delegation to
 * run.build — no duplicate filtering machinery.
 *
 * Uses Kysely DummyDriver with a mocked executor — no mock.module, per
 * db-namespace.test.ts's precedent (avoids polluting the shared module
 * cache for tests/utils + tests/core + tests/sdk, which CI runs in one
 * `bun test --serial` process). build() also resolves context.secrets /
 * globalSecrets via the process-wide StateManager singleton
 * (getStateManager), which throws unless .load() has run —
 * loadEmptyState() below resets the singleton and loads it against each
 * test's own temp projectRoot (no on-disk state file, so load() takes the
 * offline "new project" branch — no identity key or live service needed).
 */
import { afterEach, describe, expect, it, vi } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    Kysely,
    DummyDriver,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
} from 'kysely';

import { RunNamespace } from '../../src/sdk/namespaces/run.js';
import { NoormOps } from '../../src/sdk/noorm-ops.js';
import { NotConnectedError } from '../../src/sdk/guards.js';
import { getStateManager, resetStateManager } from '../../src/core/state/index.js';

import type { ContextState } from '../../src/sdk/state.js';
import type { Config } from '../../src/core/config/types.js';
import type { Settings } from '../../src/core/settings/types.js';
import type { Identity } from '../../src/core/identity/types.js';
import type { BatchResult } from '../../src/core/runner/index.js';

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

function fakeBatchResult(): BatchResult {

    return {
        status: 'success',
        files: [],
        filesRun: 0,
        filesSkipped: 0,
        filesFailed: 0,
        durationMs: 0,
    };

}

/** Bare DummyDriver Kysely — DummyDriver.executeQuery throws unless the caller mocks it. */
function makeKysely(): Kysely<unknown> {

    return new Kysely<unknown>({
        dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (db) => new PostgresIntrospector(db),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
    });

}

/**
 * Kysely wired to a DummyDriver whose connection answers generically
 * enough to drive a real runBuild() to completion. Mocked at
 * `driver.acquireConnection()` rather than `db.getExecutor().provideConnection`
 * (db-namespace.test.ts's spot) because Tracker queries go through
 * `db.withSchema('noorm')`, which clones the executor (`withPluginAtFront`
 * builds a *new* `DefaultQueryExecutor`) — a spy on the original executor's
 * `provideConnection` never sees schema-scoped queries. The driver instance
 * itself is shared across every such clone, so this is the one seam that
 * actually intercepts everything build() runs.
 *
 * Tracker.createOperation's `insert ... returning "id"` (verified via a
 * compiled-query sanity check — it's the only query shape containing both
 * substrings) gets an incrementing id, or the whole batch aborts before
 * touching any file. Everything else — the needsRun lookup, file-record
 * inserts/updates, and each fixture file's own SQL body — gets empty rows,
 * which reads as "no prior execution" / "no-op success". This is enough to
 * prove which files build() attempted to run; simulating real execution
 * semantics is core/runner's own test surface, not this one's.
 */
function makeMockKysely(): Kysely<unknown> {

    const driver = new DummyDriver();
    let nextId = 1;

    vi.spyOn(driver, 'acquireConnection').mockResolvedValue({
        executeQuery: vi.fn().mockImplementation((compiledQuery: { sql: string }) => {

            const allocatesId = /insert into/i.test(compiledQuery.sql)
                && /returning/i.test(compiledQuery.sql);

            return Promise.resolve(
                allocatesId
                    ? { rows: [{ id: nextId++ }] }
                    : { rows: [], numAffectedRows: 1n },
            );

        }),
        streamQuery: () => {

            throw new Error('not implemented');

        },
    });

    return new Kysely<unknown>({
        dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => driver,
            createIntrospector: (db) => new PostgresIntrospector(db),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
    });

}

function makeConfig(overrides: Partial<Config> = {}): Config {

    return {
        name: 'dev',
        type: 'local',
        isTest: false,
        access: { user: 'admin', agent: 'admin' },
        connection: { dialect: 'postgres', database: 'testdb' },
        ...overrides,
    };

}

const mockIdentity: Identity = {
    name: 'tester',
    source: 'system',
};

function makeState(
    projectRoot: string,
    settings: Settings,
    configOverrides: Partial<Config> = {},
    db: Kysely<unknown> = makeMockKysely(),
): ContextState {

    return {
        connection: { db, dialect: 'postgres', destroy: async () => {} },
        config: makeConfig(configOverrides),
        settings,
        identity: mockIdentity,
        options: {},
        projectRoot,
        changeManager: null,
    };

}

/** Temp project with sql/a/001_a.sql and sql/b/001_b.sql fixture files. */
async function makeSqlProject(): Promise<string> {

    const projectRoot = await mkdtemp(join(tmpdir(), 'noorm-build-filter-'));

    await mkdir(join(projectRoot, 'sql', 'a'), { recursive: true });
    await mkdir(join(projectRoot, 'sql', 'b'), { recursive: true });
    await writeFile(join(projectRoot, 'sql', 'a', '001_a.sql'), 'select 1;');
    await writeFile(join(projectRoot, 'sql', 'b', '001_b.sql'), 'select 1;');

    return projectRoot;

}

/**
 * Resets the process-wide StateManager singleton and loads it against
 * `projectRoot` before each test — getStateManager caches its first
 * instance for the process lifetime, so without a reset the second test
 * to run would silently reuse the first test's temp projectRoot.
 */
async function loadEmptyState(projectRoot: string): Promise<void> {

    resetStateManager();
    await getStateManager(projectRoot).load();

}

const tempDirs: string[] = [];

afterEach(async () => {

    resetStateManager();

    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));

});

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('sdk: RunNamespace.build() filtering', () => {

    it('should only pass files under the included folder to runBuild', async () => {

        const projectRoot = await makeSqlProject();
        tempDirs.push(projectRoot);
        await loadEmptyState(projectRoot);

        const state = makeState(projectRoot, { build: { include: ['a'] } });
        const run = new RunNamespace(state);

        const result = await run.build();

        expect(result.files.map((f) => f.filepath)).toEqual([
            join(projectRoot, 'sql', 'a', '001_a.sql'),
        ]);

    });

    it('should resolve a failed BatchResult, not throw, when the sql dir is missing', async () => {

        // Regression: db reset on a project without a sql/ dir must keep
        // runBuild's discovery-failure contract (failed result, no throw) —
        // an eager throw here crashed `noorm db reset` to exit 1.
        const { mkdtemp } = await import('node:fs/promises');
        const { tmpdir } = await import('node:os');
        const projectRoot = await mkdtemp(join(tmpdir(), 'noorm-run-filter-nodir-'));
        tempDirs.push(projectRoot);
        await loadEmptyState(projectRoot);

        const state = makeState(projectRoot, {});
        const run = new RunNamespace(state);

        const result = await run.build();

        expect(result.status).toBe('failed');
        expect(result.files).toEqual([]);

    });

    it('should pass every discovered file when build settings are empty (regression guard)', async () => {

        const projectRoot = await makeSqlProject();
        tempDirs.push(projectRoot);
        await loadEmptyState(projectRoot);

        const state = makeState(projectRoot, {});
        const run = new RunNamespace(state);

        const result = await run.build();

        expect(result.files.map((f) => f.filepath).sort()).toEqual([
            join(projectRoot, 'sql', 'a', '001_a.sql'),
            join(projectRoot, 'sql', 'b', '001_b.sql'),
        ].sort());

    });

    it('should apply a rule matching isTest to alter the effective file set', async () => {

        const projectRoot = await makeSqlProject();
        tempDirs.push(projectRoot);
        await loadEmptyState(projectRoot);

        const state = makeState(
            projectRoot,
            { rules: [{ match: { isTest: true }, exclude: ['b'] }] },
            { isTest: true },
        );
        const run = new RunNamespace(state);

        const result = await run.build();

        expect(result.files.map((f) => f.filepath)).toEqual([
            join(projectRoot, 'sql', 'a', '001_a.sql'),
        ]);

    });

    it('should run zero files (not fall back to discovery) when every file is excluded', async () => {

        const projectRoot = await makeSqlProject();
        tempDirs.push(projectRoot);
        await loadEmptyState(projectRoot);

        const state = makeState(projectRoot, { build: { exclude: ['a', 'b'] } });
        const run = new RunNamespace(state);

        const result = await run.build();

        // runner.ts:123 `if (preFilteredFiles)` treats `[]` as provided (arrays
        // are truthy) and `undefined` as "discover everything" — an empty
        // result here proves build() took the pre-filtered branch rather than
        // falling back to a full discovery that would have found 2 files.
        expect(result.files).toEqual([]);
        expect(result.filesRun).toBe(0);

    });

    it('should surface unmatchedInclude when a build.include entry matches nothing', async () => {

        // Real-world case: include entries are relative to paths.sql, not the
        // project root, so repeating the sql/ prefix (`sql/a` against a
        // fixture rooted at <projectRoot>/sql) matches no discovered file.
        const projectRoot = await makeSqlProject();
        tempDirs.push(projectRoot);
        await loadEmptyState(projectRoot);

        const state = makeState(projectRoot, { build: { include: ['a', 'sql/a'] } });
        const run = new RunNamespace(state);

        const result = await run.build();

        expect(result.unmatchedInclude).toEqual(['sql/a']);

    });

    it('should leave unmatchedInclude undefined when every include entry matches', async () => {

        const projectRoot = await makeSqlProject();
        tempDirs.push(projectRoot);
        await loadEmptyState(projectRoot);

        const state = makeState(projectRoot, { build: { include: ['a'] } });
        const run = new RunNamespace(state);

        const result = await run.build();

        expect(result.unmatchedInclude).toBeUndefined();

    });

    it('should throw NotConnectedError before any file-system access when disconnected', async () => {

        // Iteration 1 regression: #createRunContext() (which throws
        // NotConnectedError via requireConnection) must run before sqlPath
        // discovery, or a missing/unreadable sql dir masks the connection
        // error. projectRoot below doesn't exist, so a discovery-before-
        // connection-check regression would surface as a "Failed to read
        // directory" error instead of NotConnectedError.
        const state: ContextState = {
            connection: null,
            config: makeConfig(),
            settings: {},
            identity: mockIdentity,
            options: {},
            projectRoot: '/nonexistent/noorm-build-filter-root',
            changeManager: null,
        };
        const run = new RunNamespace(state);

        await expect(run.build()).rejects.toThrow(NotConnectedError);

    });

});

describe('sdk: db.reset() inherits build filtering via delegation', () => {

    it('should invoke run.build (not duplicate filtering machinery) on reset()', async () => {

        const projectRoot = await makeSqlProject();
        tempDirs.push(projectRoot);

        const db = makeKysely();
        const state = makeState(projectRoot, { build: { include: ['a'] } }, {}, db);
        const ops = new NoormOps(state);

        // ops.run is accessed here only to obtain a reference to pass to
        // vi.spyOn — access order doesn't otherwise matter: NoormOps#run
        // memoizes on #run, and db.ts's buildFn closure ((opts) =>
        // this.run.build(opts)) re-reads this.run on every call rather than
        // capturing a reference at ops.db construction time, so it always
        // resolves to whichever instance #run is holding — the same one
        // spied on below, regardless of whether ops.run or ops.db was
        // touched first.
        const runNamespace = ops.run;
        const buildSpy = vi.spyOn(runNamespace, 'build').mockResolvedValue(fakeBatchResult());

        // teardownSchema (reset()'s pre-rebuild step) needs a connection that
        // answers "no objects found" for every explore query.
        vi.spyOn(db.getExecutor(), 'provideConnection').mockImplementation(async (consumer) =>
            consumer({
                executeQuery: vi.fn().mockResolvedValue({ rows: [] }),
                streamQuery: () => {

                    throw new Error('not implemented');

                },
            }),
        );

        await ops.db.reset();

        expect(buildSpy).toHaveBeenCalledWith({ force: true });

    });

});
