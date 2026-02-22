# SDK Namespace Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize the flat `NoormOps` class into domain-aligned sub-namespaces (`changes`, `run`, `db`, `lock`, `vault`, `secrets`, `templates`, `transfer`, `dt`, `utils`) and add new capabilities (change authoring, dry-run previews, file discovery, vault ops).

**Architecture:** Each namespace is a small class that receives `ContextState` and delegates to core functions. `NoormOps` becomes a thin shell with lazy getters. Connected-only methods throw "Not connected" when `#state.connection` is null. Offline methods (scaffold, discover, validate) work without a connection.

**Tech Stack:** TypeScript, Kysely, bun:test

**Design doc:** `docs/plans/2026-02-21-sdk-namespace-redesign.md`

---

### Task 1: Create `ChangesNamespace`

The largest namespace — scaffold (offline) + execution (connected) + status/history (connected).

**Files:**
- Create: `src/sdk/namespaces/changes.ts`
- Test: `tests/sdk/namespaces/changes.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/sdk/namespaces/changes.test.ts
import { describe, it, expect } from 'bun:test';

import { ChangesNamespace } from '../../../src/sdk/namespaces/changes.js';
import type { ContextState } from '../../../src/sdk/state.js';
import type { Config } from '../../../src/core/config/types.js';
import type { Settings } from '../../../src/core/settings/types.js';
import type { Identity } from '../../../src/core/identity/types.js';

function createMockState(overrides: Partial<ContextState> = {}): ContextState {

    return {
        connection: null,
        config: {
            name: 'test',
            type: 'local',
            isTest: true,
            protected: false,
            connection: { dialect: 'postgres', database: 'testdb' },
        } as Config,
        settings: {} as Settings,
        identity: { name: 'tester', source: 'system' } as Identity,
        options: {},
        projectRoot: '/tmp/test-project',
        changeManager: null,
        ...overrides,
    };

}

describe('sdk: ChangesNamespace', () => {

    it('should be constructable from ContextState', () => {

        const state = createMockState();
        const ns = new ChangesNamespace(state);

        expect(ns).toBeDefined();

    });

    it('should throw on connected methods when not connected', () => {

        const state = createMockState({ connection: null });
        const ns = new ChangesNamespace(state);

        expect(() => ns.apply('test')).toThrow('Not connected');

    });

});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/sdk/namespaces/changes.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/sdk/namespaces/changes.ts
/**
 * Changes namespace — change authoring, execution, and history.
 *
 * Mirrors [g] changes in the TUI. Scaffold operations work offline,
 * execution and status queries require a database connection.
 */
import path from 'node:path';

import type { Kysely } from 'kysely';

import type { NoormDatabase } from '../../core/shared/index.js';
import type {
    Change,
    ChangeOptions,
    ChangeResult,
    BatchChangeResult,
    ChangeListItem,
    ChangeHistoryRecord,
    ChangeContext,
    CreateChangeOptions,
    AddFileOptions,
    ChangeFileType,
} from '../../core/change/index.js';
import {
    createChange,
    addFile as coreAddFile,
    removeFile as coreRemoveFile,
    renameFile as coreRenameFile,
    reorderFiles as coreReorderFiles,
    deleteChange as coreDeleteChange,
    parseChange as coreParseChange,
    discoverChanges as coreDiscoverChanges,
    validateChange as coreValidateChange,
    ChangeManager,
} from '../../core/change/index.js';
import { formatIdentity } from '../../core/identity/index.js';
import { getStateManager } from '../../core/state/index.js';

import type { ContextState } from '../state.js';

export class ChangesNamespace {

    #state: ContextState;
    #manager: ChangeManager | null = null;

    constructor(state: ContextState) {

        this.#state = state;

    }

    // ─────────────────────────────────────────────────────
    // Scaffold (offline)
    // ─────────────────────────────────────────────────────

    /**
     * Create a new change directory with change/ and revert/ folders.
     *
     * @example
     * ```typescript
     * const change = await ctx.noorm.changes.create({ description: 'add-user-roles' })
     * ```
     */
    async create(options: CreateChangeOptions): Promise<Change> {

        return createChange(this.#changesDir, options);

    }

    /**
     * Add a file to a change.
     *
     * @example
     * ```typescript
     * const updated = await ctx.noorm.changes.addFile(change, 'change', {
     *     name: 'create-table',
     *     type: 'sql',
     * })
     * ```
     */
    async addFile(
        change: Change,
        folder: 'change' | 'revert',
        options: AddFileOptions,
    ): Promise<Change> {

        return coreAddFile(change, folder, options);

    }

    /**
     * Remove a file from a change.
     *
     * @example
     * ```typescript
     * await ctx.noorm.changes.removeFile(change, 'change', '001_create-table.sql')
     * ```
     */
    async removeFile(
        change: Change,
        folder: 'change' | 'revert',
        filename: string,
    ): Promise<Change> {

        return coreRemoveFile(change, folder, filename);

    }

    /**
     * Rename a file in a change.
     *
     * @example
     * ```typescript
     * await ctx.noorm.changes.renameFile(change, 'change', '001_old.sql', 'new-name')
     * ```
     */
    async renameFile(
        change: Change,
        folder: 'change' | 'revert',
        oldFilename: string,
        newDescription: string,
    ): Promise<Change> {

        return coreRenameFile(change, folder, oldFilename, newDescription);

    }

    /**
     * Reorder files in a change folder.
     *
     * @example
     * ```typescript
     * await ctx.noorm.changes.reorderFiles(change, 'change', ['002_b.sql', '001_a.sql'])
     * ```
     */
    async reorderFiles(
        change: Change,
        folder: 'change' | 'revert',
        newOrder: string[],
    ): Promise<Change> {

        return coreReorderFiles(change, folder, newOrder);

    }

    /**
     * Delete a change directory from disk.
     *
     * @example
     * ```typescript
     * await ctx.noorm.changes.delete(change)
     * ```
     */
    async delete(change: Change): Promise<void> {

        return coreDeleteChange(change);

    }

    // ─────────────────────────────────────────────────────
    // Discovery & validation (offline)
    // ─────────────────────────────────────────────────────

    /**
     * Discover all changes on disk.
     *
     * @example
     * ```typescript
     * const changes = await ctx.noorm.changes.discover()
     * ```
     */
    async discover(): Promise<Change[]> {

        return coreDiscoverChanges(this.#changesDir, this.#sqlDir);

    }

    /**
     * Parse a single change from disk by name.
     *
     * @example
     * ```typescript
     * const change = await ctx.noorm.changes.parse('2024-01-15-add-users')
     * ```
     */
    async parse(name: string): Promise<Change> {

        const changePath = path.join(this.#changesDir, name);

        return coreParseChange(changePath, this.#sqlDir);

    }

    /**
     * Validate a change's structure.
     *
     * @throws ChangeValidationError if invalid
     *
     * @example
     * ```typescript
     * ctx.noorm.changes.validate(change)
     * ```
     */
    validate(change: Change): void {

        coreValidateChange(change);

    }

    // ─────────────────────────────────────────────────────
    // Execution (connected)
    // ─────────────────────────────────────────────────────

    /**
     * Apply a specific change.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.changes.apply('2024-01-15-add-users')
     * ```
     */
    async apply(name: string, options?: ChangeOptions): Promise<ChangeResult> {

        return this.#getManager().run(name, options);

    }

    /**
     * Revert a specific change.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.changes.revert('2024-01-15-add-users')
     * ```
     */
    async revert(name: string, options?: ChangeOptions): Promise<ChangeResult> {

        return this.#getManager().revert(name, options);

    }

    /**
     * Apply all pending changes.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.changes.ff()
     * ```
     */
    async ff(): Promise<BatchChangeResult> {

        return this.#getManager().ff();

    }

    // ─────────────────────────────────────────────────────
    // Status & history (connected)
    // ─────────────────────────────────────────────────────

    /**
     * Get status of all changes (merged disk + DB).
     *
     * @example
     * ```typescript
     * const all = await ctx.noorm.changes.status()
     * ```
     */
    async status(): Promise<ChangeListItem[]> {

        return this.#getManager().list();

    }

    /**
     * Get only pending (unapplied or reverted) changes.
     *
     * @example
     * ```typescript
     * const pending = await ctx.noorm.changes.pending()
     * ```
     */
    async pending(): Promise<ChangeListItem[]> {

        const all = await this.status();

        return all.filter(
            (cs) => !cs.orphaned && (cs.status === 'pending' || cs.status === 'reverted'),
        );

    }

    /**
     * Get execution history.
     *
     * @example
     * ```typescript
     * const history = await ctx.noorm.changes.history(10)
     * ```
     */
    async history(limit?: number): Promise<ChangeHistoryRecord[]> {

        return this.#getManager().getHistory(undefined, limit);

    }

    // ─────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────

    get #changesDir(): string {

        return path.join(
            this.#state.projectRoot,
            this.#state.settings.paths?.changes ?? 'changes',
        );

    }

    get #sqlDir(): string {

        return path.join(
            this.#state.projectRoot,
            this.#state.settings.paths?.sql ?? 'sql',
        );

    }

    get #kysely(): Kysely<unknown> {

        if (!this.#state.connection) {

            throw new Error('Not connected. Call connect() first.');

        }

        return this.#state.connection.db;

    }

    #createChangeContext(): ChangeContext {

        const state = getStateManager(this.#state.projectRoot);

        return {
            db: this.#kysely as unknown as Kysely<NoormDatabase>,
            configName: this.#state.config.name,
            identity: this.#state.identity,
            projectRoot: this.#state.projectRoot,
            changesDir: this.#changesDir,
            sqlDir: this.#sqlDir,
            config: this.#state.config as unknown as Record<string, unknown>,
            secrets: state.getAllSecrets(this.#state.config.name),
            globalSecrets: state.getAllGlobalSecrets(),
        };

    }

    #getManager(): ChangeManager {

        if (!this.#manager) {

            this.#manager = new ChangeManager(this.#createChangeContext());

        }

        return this.#manager;

    }

}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/sdk/namespaces/changes.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sdk/namespaces/changes.ts tests/sdk/namespaces/changes.test.ts
```

Message: `feat(sdk): add ChangesNamespace with scaffold, execution, and history`

---

### Task 2: Create `RunNamespace`

Runner operations — file execution, build, preview, discovery.

**Files:**
- Create: `src/sdk/namespaces/run.ts`
- Test: `tests/sdk/namespaces/run.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/sdk/namespaces/run.test.ts
import { describe, it, expect } from 'bun:test';

import { RunNamespace } from '../../../src/sdk/namespaces/run.js';
import type { ContextState } from '../../../src/sdk/state.js';
import type { Config } from '../../../src/core/config/types.js';
import type { Identity } from '../../../src/core/identity/types.js';

function createMockState(overrides: Partial<ContextState> = {}): ContextState {

    return {
        connection: null,
        config: {
            name: 'test',
            type: 'local',
            isTest: true,
            protected: false,
            connection: { dialect: 'postgres', database: 'testdb' },
        } as Config,
        settings: {},
        identity: { name: 'tester', source: 'system' } as Identity,
        options: {},
        projectRoot: '/tmp/test-project',
        changeManager: null,
        ...overrides,
    };

}

describe('sdk: RunNamespace', () => {

    it('should be constructable', () => {

        const ns = new RunNamespace(createMockState());

        expect(ns).toBeDefined();

    });

    it('should throw on connected methods when not connected', async () => {

        const ns = new RunNamespace(createMockState());

        expect(() => ns.file('test.sql')).toThrow('Not connected');

    });

});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/sdk/namespaces/run.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// src/sdk/namespaces/run.ts
/**
 * Run namespace — SQL file execution, build, preview, discovery.
 *
 * Mirrors [r] run in the TUI. Discovery works offline,
 * execution and preview require a database connection.
 */
import path from 'node:path';

import type { Kysely } from 'kysely';

import type { NoormDatabase } from '../../core/shared/index.js';
import type {
    RunContext,
    RunOptions,
    FileResult,
    BatchResult,
} from '../../core/runner/index.js';
import {
    runBuild,
    runFile as coreRunFile,
    runDir as coreRunDir,
    runFiles as coreRunFiles,
    preview as corePreview,
    discoverFiles as coreDiscoverFiles,
} from '../../core/runner/index.js';
import { getStateManager } from '../../core/state/index.js';

import type { ContextState } from '../state.js';
import type { BuildOptions } from '../types.js';

export class RunNamespace {

    #state: ContextState;

    constructor(state: ContextState) {

        this.#state = state;

    }

    // ─────────────────────────────────────────────────────
    // Discovery (offline)
    // ─────────────────────────────────────────────────────

    /**
     * Discover SQL files in a directory.
     *
     * @example
     * ```typescript
     * const files = await ctx.noorm.run.discover('sql/')
     * ```
     */
    async discover(dirpath?: string): Promise<string[]> {

        const absolutePath = this.#resolvePath(
            dirpath ?? this.#state.settings.paths?.sql ?? 'sql',
        );

        return coreDiscoverFiles(absolutePath);

    }

    // ─────────────────────────────────────────────────────
    // Preview (connected)
    // ─────────────────────────────────────────────────────

    /**
     * Preview SQL files — render templates without executing.
     *
     * @example
     * ```typescript
     * const results = await ctx.noorm.run.preview(['sql/001.sql', 'sql/002.sql'])
     * ```
     */
    async preview(
        filepaths: string[],
        output?: string | null,
    ): Promise<FileResult[]> {

        const context = this.#createRunContext();
        const absolutePaths = filepaths.map((fp) => this.#resolvePath(fp));

        return corePreview(context, absolutePaths, output);

    }

    // ─────────────────────────────────────────────────────
    // Execution (connected)
    // ─────────────────────────────────────────────────────

    /**
     * Execute a single SQL file.
     *
     * @example
     * ```typescript
     * await ctx.noorm.run.file('seeds/test-data.sql')
     * ```
     */
    async file(filepath: string, options?: RunOptions): Promise<FileResult> {

        const context = this.#createRunContext();
        const absolutePath = this.#resolvePath(filepath);

        return coreRunFile(context, absolutePath, options);

    }

    /**
     * Execute multiple SQL files sequentially.
     *
     * @example
     * ```typescript
     * await ctx.noorm.run.files(['functions/utils.sql', 'triggers/audit.sql'])
     * ```
     */
    async files(filepaths: string[], options?: RunOptions): Promise<BatchResult> {

        const context = this.#createRunContext();
        const absolutePaths = filepaths.map((fp) => this.#resolvePath(fp));

        return coreRunFiles(context, absolutePaths, options);

    }

    /**
     * Execute all SQL files in a directory.
     *
     * @example
     * ```typescript
     * await ctx.noorm.run.dir('seeds/')
     * ```
     */
    async dir(dirpath: string, options?: RunOptions): Promise<BatchResult> {

        const context = this.#createRunContext();
        const absolutePath = this.#resolvePath(dirpath);

        return coreRunDir(context, absolutePath, options);

    }

    /**
     * Execute all SQL files in the schema directory.
     *
     * @example
     * ```typescript
     * await ctx.noorm.run.build({ force: true })
     * ```
     */
    async build(options?: BuildOptions): Promise<BatchResult> {

        const context = this.#createRunContext();
        const sqlPath = path.join(
            this.#state.projectRoot,
            this.#state.settings.paths?.sql ?? 'sql',
        );

        return runBuild(context, sqlPath, { force: options?.force });

    }

    // ─────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────

    get #kysely(): Kysely<unknown> {

        if (!this.#state.connection) {

            throw new Error('Not connected. Call connect() first.');

        }

        return this.#state.connection.db;

    }

    #resolvePath(filepath: string): string {

        return path.isAbsolute(filepath)
            ? filepath
            : path.join(this.#state.projectRoot, filepath);

    }

    #createRunContext(): RunContext {

        const state = getStateManager(this.#state.projectRoot);

        return {
            db: this.#kysely as unknown as Kysely<NoormDatabase>,
            configName: this.#state.config.name,
            identity: this.#state.identity,
            projectRoot: this.#state.projectRoot,
            config: this.#state.config as unknown as Record<string, unknown>,
            secrets: state.getAllSecrets(this.#state.config.name),
            globalSecrets: state.getAllGlobalSecrets(),
        };

    }

}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/sdk/namespaces/run.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sdk/namespaces/run.ts tests/sdk/namespaces/run.test.ts
```

Message: `feat(sdk): add RunNamespace with file execution, build, preview, discovery`

---

### Task 3: Create `DbNamespace`

Database exploration and destructive schema operations.

**Files:**
- Create: `src/sdk/namespaces/db.ts`
- Test: `tests/sdk/namespaces/db.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/sdk/namespaces/db.test.ts
import { describe, it, expect } from 'bun:test';

import { DbNamespace } from '../../../src/sdk/namespaces/db.js';
import type { ContextState } from '../../../src/sdk/state.js';
import type { Config } from '../../../src/core/config/types.js';
import type { Identity } from '../../../src/core/identity/types.js';

function createMockState(overrides: Partial<ContextState> = {}): ContextState {

    return {
        connection: null,
        config: {
            name: 'test',
            type: 'local',
            isTest: true,
            protected: false,
            connection: { dialect: 'postgres', database: 'testdb' },
        } as Config,
        settings: {},
        identity: { name: 'tester', source: 'system' } as Identity,
        options: {},
        projectRoot: '/tmp/test-project',
        changeManager: null,
        ...overrides,
    };

}

describe('sdk: DbNamespace', () => {

    it('should be constructable', () => {

        const ns = new DbNamespace(createMockState());

        expect(ns).toBeDefined();

    });

    it('should throw on connected methods when not connected', async () => {

        const ns = new DbNamespace(createMockState());

        expect(() => ns.listTables()).toThrow('Not connected');

    });

    it('should throw on protected ops when config is protected', () => {

        const state = createMockState({
            config: {
                name: 'prod',
                type: 'local',
                isTest: false,
                protected: true,
                connection: { dialect: 'postgres', database: 'proddb' },
            } as Config,
            options: { allowProtected: false },
        });
        const ns = new DbNamespace(state);

        expect(() => ns.truncate()).toThrow('Cannot truncate');

    });

});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/sdk/namespaces/db.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// src/sdk/namespaces/db.ts
/**
 * Db namespace — database exploration and schema operations.
 *
 * Mirrors [d] db in the TUI. All operations require a connection.
 * Destructive operations respect the allowProtected guard.
 */
import type { Kysely } from 'kysely';

import type { Dialect } from '../../core/connection/index.js';
import type {
    TableSummary,
    TableDetail,
    ExploreOverview,
} from '../../core/explore/index.js';
import { fetchOverview, fetchList, fetchDetail } from '../../core/explore/index.js';
import type { TruncateResult, TeardownResult, TeardownPreview } from '../../core/teardown/index.js';
import { truncateData, teardownSchema, previewTeardown } from '../../core/teardown/index.js';
import { formatIdentity } from '../../core/identity/index.js';

import type { ContextState } from '../state.js';
import type { BuildOptions } from '../types.js';
import { checkProtectedConfig } from '../guards.js';

export class DbNamespace {

    #state: ContextState;

    constructor(state: ContextState) {

        this.#state = state;

    }

    // ─────────────────────────────────────────────────────
    // Explore
    // ─────────────────────────────────────────────────────

    /**
     * List all tables in the database.
     *
     * @example
     * ```typescript
     * const tables = await ctx.noorm.db.listTables()
     * ```
     */
    async listTables(): Promise<TableSummary[]> {

        return fetchList(this.#kysely, this.#dialect, 'tables');

    }

    /**
     * Get detailed information about a table.
     *
     * @example
     * ```typescript
     * const detail = await ctx.noorm.db.describeTable('users')
     * ```
     */
    async describeTable(name: string, schema?: string): Promise<TableDetail | null> {

        return fetchDetail(this.#kysely, this.#dialect, 'tables', name, schema);

    }

    /**
     * Get database overview with counts of all object types.
     *
     * @example
     * ```typescript
     * const overview = await ctx.noorm.db.overview()
     * ```
     */
    async overview(): Promise<ExploreOverview> {

        return fetchOverview(this.#kysely, this.#dialect);

    }

    // ─────────────────────────────────────────────────────
    // Preview
    // ─────────────────────────────────────────────────────

    /**
     * Preview what teardown would drop without executing.
     *
     * @example
     * ```typescript
     * const preview = await ctx.noorm.db.previewTeardown()
     * ```
     */
    async previewTeardown(): Promise<TeardownPreview> {

        return previewTeardown(this.#kysely, this.#dialect);

    }

    // ─────────────────────────────────────────────────────
    // Destructive operations
    // ─────────────────────────────────────────────────────

    /**
     * Wipe all data, keeping the schema intact.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.db.truncate()
     * ```
     */
    async truncate(): Promise<TruncateResult> {

        checkProtectedConfig(this.#state.config, 'truncate', this.#state.options);

        return truncateData(this.#kysely, this.#dialect);

    }

    /**
     * Drop all database objects except noorm tracking tables.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.db.teardown()
     * ```
     */
    async teardown(): Promise<TeardownResult> {

        checkProtectedConfig(this.#state.config, 'teardown', this.#state.options);

        return teardownSchema(this.#kysely, this.#dialect, {
            configName: this.#state.config.name,
            executedBy: formatIdentity(this.#state.identity),
        });

    }

    /**
     * Full rebuild: teardown + build.
     *
     * Requires the RunNamespace for the build step.
     * This is injected via the setter to avoid circular deps.
     *
     * @example
     * ```typescript
     * await ctx.noorm.db.reset()
     * ```
     */
    async reset(): Promise<void> {

        checkProtectedConfig(this.#state.config, 'reset', this.#state.options);

        await this.teardown();

        if (this.#buildFn) {

            await this.#buildFn({ force: true });

        }

    }

    // ─────────────────────────────────────────────────────
    // Build injection (for reset)
    // ─────────────────────────────────────────────────────

    #buildFn: ((opts?: BuildOptions) => Promise<unknown>) | null = null;

    /** @internal Used by NoormOps to wire up reset -> build. */
    set _buildFn(fn: (opts?: BuildOptions) => Promise<unknown>) {

        this.#buildFn = fn;

    }

    // ─────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────

    get #kysely(): Kysely<unknown> {

        if (!this.#state.connection) {

            throw new Error('Not connected. Call connect() first.');

        }

        return this.#state.connection.db;

    }

    get #dialect(): Dialect {

        return this.#state.config.connection.dialect;

    }

}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/sdk/namespaces/db.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sdk/namespaces/db.ts tests/sdk/namespaces/db.test.ts
```

Message: `feat(sdk): add DbNamespace with explore, teardown, preview`

---

### Task 4: Create `LockNamespace`

**Files:**
- Create: `src/sdk/namespaces/lock.ts`
- Test: `tests/sdk/namespaces/lock.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/sdk/namespaces/lock.test.ts
import { describe, it, expect } from 'bun:test';

import { LockNamespace } from '../../../src/sdk/namespaces/lock.js';
import type { ContextState } from '../../../src/sdk/state.js';
import type { Config } from '../../../src/core/config/types.js';
import type { Identity } from '../../../src/core/identity/types.js';

function createMockState(): ContextState {

    return {
        connection: null,
        config: {
            name: 'test',
            type: 'local',
            isTest: true,
            protected: false,
            connection: { dialect: 'postgres', database: 'testdb' },
        } as Config,
        settings: {},
        identity: { name: 'tester', source: 'system' } as Identity,
        options: {},
        projectRoot: '/tmp/test-project',
        changeManager: null,
    };

}

describe('sdk: LockNamespace', () => {

    it('should be constructable', () => {

        const ns = new LockNamespace(createMockState());

        expect(ns).toBeDefined();

    });

    it('should throw on connected methods when not connected', async () => {

        const ns = new LockNamespace(createMockState());

        expect(() => ns.acquire()).toThrow('Not connected');

    });

});
```

**Step 2: Run test — should fail**

**Step 3: Write the implementation**

```typescript
// src/sdk/namespaces/lock.ts
/**
 * Lock namespace — database lock management.
 *
 * Mirrors [l] lock in the TUI. All operations require a connection.
 */
import type { Kysely } from 'kysely';

import type { NoormDatabase } from '../../core/shared/index.js';
import type { Lock, LockStatus, LockOptions } from '../../core/lock/index.js';
import { getLockManager } from '../../core/lock/index.js';
import { formatIdentity } from '../../core/identity/index.js';

import type { ContextState } from '../state.js';

export class LockNamespace {

    #state: ContextState;

    constructor(state: ContextState) {

        this.#state = state;

    }

    /**
     * Acquire a database lock.
     *
     * @example
     * ```typescript
     * const lock = await ctx.noorm.lock.acquire({ timeout: 60000 })
     * ```
     */
    async acquire(options?: LockOptions): Promise<Lock> {

        const lockManager = getLockManager();
        const identityStr = formatIdentity(this.#state.identity);

        return lockManager.acquire(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#state.config.name,
            identityStr,
            { ...options, dialect: this.#state.config.connection.dialect },
        );

    }

    /**
     * Release the current lock.
     *
     * @example
     * ```typescript
     * await ctx.noorm.lock.release()
     * ```
     */
    async release(): Promise<void> {

        const lockManager = getLockManager();
        const identityStr = formatIdentity(this.#state.identity);

        await lockManager.release(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#state.config.name,
            identityStr,
        );

    }

    /**
     * Get current lock status.
     *
     * @example
     * ```typescript
     * const status = await ctx.noorm.lock.status()
     * ```
     */
    async status(): Promise<LockStatus> {

        const lockManager = getLockManager();

        return lockManager.status(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#state.config.name,
            this.#state.config.connection.dialect,
        );

    }

    /**
     * Execute an operation with automatic lock acquisition and release.
     *
     * @example
     * ```typescript
     * await ctx.noorm.lock.withLock(async () => {
     *     await ctx.noorm.run.build()
     * })
     * ```
     */
    async withLock<T>(fn: () => Promise<T>, options?: LockOptions): Promise<T> {

        const lockManager = getLockManager();
        const identityStr = formatIdentity(this.#state.identity);

        return lockManager.withLock(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#state.config.name,
            identityStr,
            fn,
            { ...options, dialect: this.#state.config.connection.dialect },
        );

    }

    /**
     * Force release any database lock regardless of ownership.
     *
     * @example
     * ```typescript
     * await ctx.noorm.lock.forceRelease()
     * ```
     */
    async forceRelease(): Promise<boolean> {

        const lockManager = getLockManager();

        return lockManager.forceRelease(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#state.config.name,
        );

    }

    // ─────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────

    get #kysely(): Kysely<unknown> {

        if (!this.#state.connection) {

            throw new Error('Not connected. Call connect() first.');

        }

        return this.#state.connection.db;

    }

}
```

**Step 4: Run test — should pass**

**Step 5: Commit**

Message: `feat(sdk): add LockNamespace`

---

### Task 5: Create `VaultNamespace`

**Files:**
- Create: `src/sdk/namespaces/vault.ts`
- Test: `tests/sdk/namespaces/vault.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/sdk/namespaces/vault.test.ts
import { describe, it, expect } from 'bun:test';

import { VaultNamespace } from '../../../src/sdk/namespaces/vault.js';
import type { ContextState } from '../../../src/sdk/state.js';
import type { Config } from '../../../src/core/config/types.js';
import type { Identity } from '../../../src/core/identity/types.js';

function createMockState(): ContextState {

    return {
        connection: null,
        config: {
            name: 'test',
            type: 'local',
            isTest: true,
            protected: false,
            connection: { dialect: 'postgres', database: 'testdb' },
        } as Config,
        settings: {},
        identity: {
            name: 'tester',
            source: 'system',
            identityHash: 'abc123',
            publicKey: 'pubkey-hex',
        } as Identity,
        options: {},
        projectRoot: '/tmp/test-project',
        changeManager: null,
    };

}

describe('sdk: VaultNamespace', () => {

    it('should be constructable', () => {

        const ns = new VaultNamespace(createMockState());

        expect(ns).toBeDefined();

    });

    it('should throw on connected methods when not connected', async () => {

        const ns = new VaultNamespace(createMockState());

        expect(() => ns.status()).toThrow('Not connected');

    });

});
```

**Step 2: Run test — should fail**

**Step 3: Write the implementation**

The vault namespace requires the user's private key for decryption. Since private keys are sensitive and shouldn't be stored in state, vault methods that need decryption accept a `privateKey` parameter. The `init`, `list`, `delete`, and `status` methods don't need the private key.

```typescript
// src/sdk/namespaces/vault.ts
/**
 * Vault namespace — encrypted team secrets stored in the database.
 *
 * Not directly on the TUI home screen, accessible via vault screens.
 * All operations require a connection. Operations that decrypt secrets
 * require the user's privateKey parameter.
 */
import type { Kysely } from 'kysely';

import type { NoormDatabase } from '../../core/shared/index.js';
import type { Config } from '../../core/config/types.js';
import type {
    VaultSecret,
    VaultStatus,
    VaultCopyResult,
    VaultPropagationResult,
} from '../../core/vault/index.js';
import {
    initializeVault,
    getVaultKey,
    getVaultStatus,
    setVaultSecret,
    getVaultSecret,
    getAllVaultSecrets,
    listVaultSecretKeys,
    deleteVaultSecret,
    vaultSecretExists,
    propagateVaultKey,
    copyVaultSecrets,
} from '../../core/vault/index.js';
import { formatIdentity } from '../../core/identity/index.js';

import type { ContextState } from '../state.js';

export interface VaultCopyOptions {
    force?: boolean;
}

export class VaultNamespace {

    #state: ContextState;

    constructor(state: ContextState) {

        this.#state = state;

    }

    // ─────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────

    /**
     * Initialize the vault for this database.
     *
     * @example
     * ```typescript
     * const [vaultKey, err] = await ctx.noorm.vault.init()
     * ```
     */
    async init(): Promise<[Buffer | null, Error | null]> {

        return initializeVault(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#identityHash,
            this.#publicKey,
        );

    }

    /**
     * Get vault status.
     *
     * @example
     * ```typescript
     * const status = await ctx.noorm.vault.status()
     * ```
     */
    async status(): Promise<VaultStatus> {

        return getVaultStatus(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#identityHash,
        );

    }

    // ─────────────────────────────────────────────────────
    // CRUD (require privateKey for encryption/decryption)
    // ─────────────────────────────────────────────────────

    /**
     * Set a vault secret.
     *
     * @example
     * ```typescript
     * const [, err] = await ctx.noorm.vault.set('API_KEY', 'sk-live-...', privateKey)
     * ```
     */
    async set(
        key: string,
        value: string,
        privateKey: string,
    ): Promise<[void, Error | null]> {

        const vaultKey = await this.#getVaultKey(privateKey);

        if (!vaultKey) return [undefined, new Error('No vault access')];

        return setVaultSecret(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            vaultKey,
            key,
            value,
            formatIdentity(this.#state.identity),
        );

    }

    /**
     * Get a vault secret by key.
     *
     * @example
     * ```typescript
     * const value = await ctx.noorm.vault.get('API_KEY', privateKey)
     * ```
     */
    async get(key: string, privateKey: string): Promise<string | null> {

        const vaultKey = await this.#getVaultKey(privateKey);

        if (!vaultKey) return null;

        return getVaultSecret(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            vaultKey,
            key,
        );

    }

    /**
     * Get all vault secrets.
     *
     * @example
     * ```typescript
     * const all = await ctx.noorm.vault.getAll(privateKey)
     * ```
     */
    async getAll(privateKey: string): Promise<Record<string, VaultSecret>> {

        const vaultKey = await this.#getVaultKey(privateKey);

        if (!vaultKey) return {};

        return getAllVaultSecrets(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            vaultKey,
        );

    }

    /**
     * List all vault secret keys (without decrypting values).
     *
     * @example
     * ```typescript
     * const keys = await ctx.noorm.vault.list()
     * ```
     */
    async list(): Promise<string[]> {

        return listVaultSecretKeys(
            this.#kysely as unknown as Kysely<NoormDatabase>,
        );

    }

    /**
     * Delete a vault secret.
     *
     * @example
     * ```typescript
     * const [deleted, err] = await ctx.noorm.vault.delete('OLD_KEY')
     * ```
     */
    async delete(key: string): Promise<[boolean, Error | null]> {

        return deleteVaultSecret(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            key,
        );

    }

    /**
     * Check if a vault secret exists.
     *
     * @example
     * ```typescript
     * const exists = await ctx.noorm.vault.exists('API_KEY')
     * ```
     */
    async exists(key: string): Promise<boolean> {

        return vaultSecretExists(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            key,
        );

    }

    // ─────────────────────────────────────────────────────
    // Team
    // ─────────────────────────────────────────────────────

    /**
     * Propagate vault key to all users without access.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.vault.propagate(privateKey)
     * ```
     */
    async propagate(privateKey: string): Promise<VaultPropagationResult> {

        const vaultKey = await this.#getVaultKey(privateKey);

        if (!vaultKey) {

            return { propagatedTo: [], alreadyHadAccess: 0 };

        }

        return propagateVaultKey(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            vaultKey,
        );

    }

    /**
     * Copy vault secrets to another config's database.
     *
     * @example
     * ```typescript
     * const [result, err] = await ctx.noorm.vault.copy(destConfig, privateKey)
     * ```
     */
    async copy(
        destConfig: Config,
        keys: string[] | 'all',
        privateKey: string,
        options?: VaultCopyOptions,
    ): Promise<[VaultCopyResult | null, Error | null]> {

        return copyVaultSecrets(
            this.#state.config,
            destConfig,
            keys,
            this.#identityHash,
            privateKey,
            this.#publicKey,
            options,
        );

    }

    // ─────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────

    get #kysely(): Kysely<unknown> {

        if (!this.#state.connection) {

            throw new Error('Not connected. Call connect() first.');

        }

        return this.#state.connection.db;

    }

    get #identityHash(): string {

        const identity = this.#state.identity as Record<string, unknown>;

        return (identity.identityHash as string) ?? '';

    }

    get #publicKey(): string {

        const identity = this.#state.identity as Record<string, unknown>;

        return (identity.publicKey as string) ?? '';

    }

    async #getVaultKey(privateKey: string): Promise<Buffer | null> {

        return getVaultKey(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#identityHash,
            privateKey,
        );

    }

}
```

**Step 4: Run test — should pass**

**Step 5: Commit**

Message: `feat(sdk): add VaultNamespace with init, CRUD, propagate, copy`

---

### Task 6: Create remaining small namespaces (`SecretsNamespace`, `TemplatesNamespace`, `TransferNamespace`, `DtNamespace`, `UtilsNamespace`)

These are 1-3 method classes. Implement all five in one task.

**Files:**
- Create: `src/sdk/namespaces/secrets.ts`
- Create: `src/sdk/namespaces/templates.ts`
- Create: `src/sdk/namespaces/transfer.ts`
- Create: `src/sdk/namespaces/dt.ts`
- Create: `src/sdk/namespaces/utils.ts`
- Test: `tests/sdk/namespaces/small-namespaces.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/sdk/namespaces/small-namespaces.test.ts
import { describe, it, expect } from 'bun:test';

import { SecretsNamespace } from '../../../src/sdk/namespaces/secrets.js';
import { TemplatesNamespace } from '../../../src/sdk/namespaces/templates.js';
import { TransferNamespace } from '../../../src/sdk/namespaces/transfer.js';
import { DtNamespace } from '../../../src/sdk/namespaces/dt.js';
import { UtilsNamespace } from '../../../src/sdk/namespaces/utils.js';
import type { ContextState } from '../../../src/sdk/state.js';
import type { Config } from '../../../src/core/config/types.js';
import type { Identity } from '../../../src/core/identity/types.js';

function createMockState(): ContextState {

    return {
        connection: null,
        config: {
            name: 'test',
            type: 'local',
            isTest: true,
            protected: false,
            connection: { dialect: 'postgres', database: 'testdb' },
        } as Config,
        settings: {},
        identity: { name: 'tester', source: 'system' } as Identity,
        options: {},
        projectRoot: '/tmp/test-project',
        changeManager: null,
    };

}

describe('sdk: SecretsNamespace', () => {

    it('should be constructable', () => {

        expect(new SecretsNamespace(createMockState())).toBeDefined();

    });

});

describe('sdk: TemplatesNamespace', () => {

    it('should be constructable', () => {

        expect(new TemplatesNamespace(createMockState())).toBeDefined();

    });

});

describe('sdk: TransferNamespace', () => {

    it('should be constructable', () => {

        expect(new TransferNamespace(createMockState())).toBeDefined();

    });

});

describe('sdk: DtNamespace', () => {

    it('should be constructable', () => {

        expect(new DtNamespace(createMockState())).toBeDefined();

    });

});

describe('sdk: UtilsNamespace', () => {

    it('should be constructable', () => {

        expect(new UtilsNamespace(createMockState())).toBeDefined();

    });

});
```

**Step 2: Run test — should fail**

**Step 3: Write all five implementations**

Each follows the same pattern — take `ContextState`, delegate to core. Refer to the current `noorm-ops.ts` lines:
- `SecretsNamespace`: wraps `getStateManager(...).getSecret(configName, key)` (line 418-426)
- `TemplatesNamespace`: wraps `processFile(...)` (line 552-567)
- `TransferNamespace`: wraps `transferData(...)` and `getTransferPlan(...)` (lines 641-665)
- `DtNamespace`: wraps `coreExportTable(...)` and `importDtFile(...)` (lines 679-722)
- `UtilsNamespace`: wraps `coreComputeChecksum(...)` and `coreTestConnection(...)` (lines 599-621)

Implementation code for each follows the exact same structure as Tasks 1-5 — constructor takes `ContextState`, connected methods check `#state.connection`, path methods resolve via `#state.projectRoot`. Copy the method bodies directly from `noorm-ops.ts`.

**Step 4: Run test — should pass**

**Step 5: Commit**

Message: `feat(sdk): add SecretsNamespace, TemplatesNamespace, TransferNamespace, DtNamespace, UtilsNamespace`

---

### Task 7: Create barrel export for namespaces

**Files:**
- Create: `src/sdk/namespaces/index.ts`

**Step 1: Write the barrel**

```typescript
// src/sdk/namespaces/index.ts
export { ChangesNamespace } from './changes.js';
export { RunNamespace } from './run.js';
export { DbNamespace } from './db.js';
export { LockNamespace } from './lock.js';
export { VaultNamespace } from './vault.js';
export { SecretsNamespace } from './secrets.js';
export { TemplatesNamespace } from './templates.js';
export { TransferNamespace } from './transfer.js';
export { DtNamespace } from './dt.js';
export { UtilsNamespace } from './utils.js';
```

**Step 2: Commit**

Message: `chore(sdk): add namespaces barrel export`

---

### Task 8: Rewrite `NoormOps` as thin shell

Replace the 774-line `noorm-ops.ts` with a thin shell that lazily instantiates namespace classes.

**Files:**
- Modify: `src/sdk/noorm-ops.ts` (full rewrite)
- Modify: `tests/sdk/noorm-ops.test.ts` (update to test new structure)

**Step 1: Update the test**

```typescript
// tests/sdk/noorm-ops.test.ts
import { describe, it, expect } from 'bun:test';

import { Context } from '../../src/sdk/context.js';
import { NoormOps } from '../../src/sdk/noorm-ops.js';
import { ChangesNamespace } from '../../src/sdk/namespaces/changes.js';
import { RunNamespace } from '../../src/sdk/namespaces/run.js';
import { DbNamespace } from '../../src/sdk/namespaces/db.js';
import { LockNamespace } from '../../src/sdk/namespaces/lock.js';
import { VaultNamespace } from '../../src/sdk/namespaces/vault.js';
import { SecretsNamespace } from '../../src/sdk/namespaces/secrets.js';
import { TemplatesNamespace } from '../../src/sdk/namespaces/templates.js';
import { TransferNamespace } from '../../src/sdk/namespaces/transfer.js';
import { DtNamespace } from '../../src/sdk/namespaces/dt.js';
import { UtilsNamespace } from '../../src/sdk/namespaces/utils.js';

import type { Config } from '../../src/core/config/types.js';
import type { Settings } from '../../src/core/settings/types.js';
import type { Identity } from '../../src/core/identity/types.js';

function createContext() {

    return new Context(
        {
            name: 'test',
            type: 'local',
            isTest: true,
            protected: false,
            connection: { dialect: 'postgres', database: 'testdb' },
        } as Config,
        {} as Settings,
        { name: 'tester', source: 'system' } as Identity,
        {},
        '/tmp/test-project',
    );

}

describe('sdk: NoormOps', () => {

    describe('lazy singleton namespaces', () => {

        it('should return a NoormOps instance', () => {

            const ctx = createContext();

            expect(ctx.noorm).toBeInstanceOf(NoormOps);

        });

        it('should return the same NoormOps on repeated access', () => {

            const ctx = createContext();

            expect(ctx.noorm).toBe(ctx.noorm);

        });

        it('should lazily create ChangesNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.changes).toBeInstanceOf(ChangesNamespace);
            expect(ctx.noorm.changes).toBe(ctx.noorm.changes);

        });

        it('should lazily create RunNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.run).toBeInstanceOf(RunNamespace);
            expect(ctx.noorm.run).toBe(ctx.noorm.run);

        });

        it('should lazily create DbNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.db).toBeInstanceOf(DbNamespace);
            expect(ctx.noorm.db).toBe(ctx.noorm.db);

        });

        it('should lazily create LockNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.lock).toBeInstanceOf(LockNamespace);
            expect(ctx.noorm.lock).toBe(ctx.noorm.lock);

        });

        it('should lazily create VaultNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.vault).toBeInstanceOf(VaultNamespace);
            expect(ctx.noorm.vault).toBe(ctx.noorm.vault);

        });

        it('should lazily create SecretsNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.secrets).toBeInstanceOf(SecretsNamespace);
            expect(ctx.noorm.secrets).toBe(ctx.noorm.secrets);

        });

        it('should lazily create TemplatesNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.templates).toBeInstanceOf(TemplatesNamespace);
            expect(ctx.noorm.templates).toBe(ctx.noorm.templates);

        });

        it('should lazily create TransferNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.transfer).toBeInstanceOf(TransferNamespace);
            expect(ctx.noorm.transfer).toBe(ctx.noorm.transfer);

        });

        it('should lazily create DtNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.dt).toBeInstanceOf(DtNamespace);
            expect(ctx.noorm.dt).toBe(ctx.noorm.dt);

        });

        it('should lazily create UtilsNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.utils).toBeInstanceOf(UtilsNamespace);
            expect(ctx.noorm.utils).toBe(ctx.noorm.utils);

        });

    });

    describe('read-only properties', () => {

        it('should expose config', () => {

            const ctx = createContext();

            expect(ctx.noorm.config.name).toBe('test');

        });

        it('should expose settings', () => {

            const ctx = createContext();

            expect(ctx.noorm.settings).toBeDefined();

        });

        it('should expose identity', () => {

            const ctx = createContext();

            expect(ctx.noorm.identity.name).toBe('tester');

        });

        it('should expose observer', () => {

            const ctx = createContext();

            expect(ctx.noorm.observer).toBeDefined();

        });

    });

});
```

**Step 2: Run test — should fail (old NoormOps has no namespace getters)**

**Step 3: Rewrite `noorm-ops.ts`**

```typescript
// src/sdk/noorm-ops.ts
/**
 * NoormOps — thin shell with lazy namespace getters.
 *
 * Each domain lives in its own namespace class under src/sdk/namespaces/.
 * NoormOps instantiates them lazily and wires cross-namespace dependencies
 * (e.g., db.reset needs run.build).
 */
import type { Config } from '../core/config/types.js';
import type { Settings } from '../core/settings/index.js';
import type { Identity } from '../core/identity/index.js';
import { observer } from '../core/observer.js';

import type { ContextState } from './state.js';
import {
    ChangesNamespace,
    RunNamespace,
    DbNamespace,
    LockNamespace,
    VaultNamespace,
    SecretsNamespace,
    TemplatesNamespace,
    TransferNamespace,
    DtNamespace,
    UtilsNamespace,
} from './namespaces/index.js';

export class NoormOps {

    #state: ContextState;

    // Lazy namespace instances
    #changes: ChangesNamespace | null = null;
    #run: RunNamespace | null = null;
    #db: DbNamespace | null = null;
    #lock: LockNamespace | null = null;
    #vault: VaultNamespace | null = null;
    #secrets: SecretsNamespace | null = null;
    #templates: TemplatesNamespace | null = null;
    #transfer: TransferNamespace | null = null;
    #dt: DtNamespace | null = null;
    #utils: UtilsNamespace | null = null;

    constructor(state: ContextState) {

        this.#state = state;

    }

    // ─────────────────────────────────────────────────────
    // Read-only Properties
    // ─────────────────────────────────────────────────────

    get config(): Config {

        return this.#state.config;

    }

    get settings(): Settings {

        return this.#state.settings;

    }

    get identity(): Identity {

        return this.#state.identity;

    }

    get observer() {

        return observer;

    }

    // ─────────────────────────────────────────────────────
    // Namespace Getters (lazy)
    // ─────────────────────────────────────────────────────

    get changes(): ChangesNamespace {

        if (!this.#changes) this.#changes = new ChangesNamespace(this.#state);

        return this.#changes;

    }

    get run(): RunNamespace {

        if (!this.#run) this.#run = new RunNamespace(this.#state);

        return this.#run;

    }

    get db(): DbNamespace {

        if (!this.#db) {

            this.#db = new DbNamespace(this.#state);
            // Wire db.reset -> run.build
            this.#db._buildFn = (opts) => this.run.build(opts);

        }

        return this.#db;

    }

    get lock(): LockNamespace {

        if (!this.#lock) this.#lock = new LockNamespace(this.#state);

        return this.#lock;

    }

    get vault(): VaultNamespace {

        if (!this.#vault) this.#vault = new VaultNamespace(this.#state);

        return this.#vault;

    }

    get secrets(): SecretsNamespace {

        if (!this.#secrets) this.#secrets = new SecretsNamespace(this.#state);

        return this.#secrets;

    }

    get templates(): TemplatesNamespace {

        if (!this.#templates) this.#templates = new TemplatesNamespace(this.#state);

        return this.#templates;

    }

    get transfer(): TransferNamespace {

        if (!this.#transfer) this.#transfer = new TransferNamespace(this.#state);

        return this.#transfer;

    }

    get dt(): DtNamespace {

        if (!this.#dt) this.#dt = new DtNamespace(this.#state);

        return this.#dt;

    }

    get utils(): UtilsNamespace {

        if (!this.#utils) this.#utils = new UtilsNamespace(this.#state);

        return this.#utils;

    }

}
```

**Step 4: Run test — should pass**

Run: `bun test tests/sdk/noorm-ops.test.ts`

**Step 5: Commit**

Message: `refactor(sdk): rewrite NoormOps as thin shell with namespace getters`

---

### Task 9: Update `index.ts` re-exports

Add new type exports for change scaffold, teardown preview, vault, and change errors.

**Files:**
- Modify: `src/sdk/index.ts`

**Step 1: Update re-exports**

Add these exports to `src/sdk/index.ts`:

```typescript
// Namespace classes (for instanceof checks)
export {
    ChangesNamespace,
    RunNamespace,
    DbNamespace,
    LockNamespace,
    VaultNamespace,
    SecretsNamespace,
    TemplatesNamespace,
    TransferNamespace,
    DtNamespace,
    UtilsNamespace,
} from './namespaces/index.js';

// Change scaffold types
export type {
    Change,
    ChangeFile,
    ChangeFileType,
    CreateChangeOptions,
    AddFileOptions,
} from '../core/change/types.js';

// Teardown preview
export type { TeardownPreview } from '../core/teardown/index.js';

// Vault types
export type {
    VaultSecret,
    VaultStatus,
    VaultCopyResult,
    VaultPropagationResult,
} from '../core/vault/index.js';

// Change errors (for catching)
export {
    ChangeValidationError,
    ChangeNotFoundError,
    ChangeAlreadyAppliedError,
    ChangeNotAppliedError,
    ChangeOrphanedError,
    ManifestReferenceError,
} from '../core/change/types.js';
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Commit**

Message: `feat(sdk): export namespace classes, scaffold types, vault types, change errors`

---

### Task 10: Update headless CLI commands

The 18 headless commands in `src/cli/headless/` reference the old flat API (`ctx.noorm.applyChange(...)`, `ctx.noorm.build()`, etc.). Update each one to use the new namespace paths.

**Files to modify** (use the breaking changes table from the design doc):
- `src/cli/headless/change.ts` — `getChangeStatus` -> `changes.status`
- `src/cli/headless/change-ff.ts` — `fastForward` -> `changes.ff`
- `src/cli/headless/change-history.ts` — `getHistory` -> `changes.history`
- `src/cli/headless/change-revert.ts` — `revertChange` -> `changes.revert`
- `src/cli/headless/change-run.ts` — `applyChange` -> `changes.apply`
- `src/cli/headless/run-build.ts` — `build` -> `run.build`
- `src/cli/headless/run-dir.ts` — `runDir` -> `run.dir`
- `src/cli/headless/run-file.ts` — `runFile` -> `run.file`
- `src/cli/headless/db-explore.ts` — `overview` -> `db.overview`
- `src/cli/headless/db-explore-tables.ts` — `listTables` -> `db.listTables`
- `src/cli/headless/db-explore-tables-detail.ts` — `describeTable` -> `db.describeTable`
- `src/cli/headless/db-truncate.ts` — `truncate` -> `db.truncate`
- `src/cli/headless/db-teardown.ts` — `teardown` -> `db.teardown`
- `src/cli/headless/db-transfer.ts` — `transferTo`/`transferPlan` -> `transfer.to`/`transfer.plan`
- `src/cli/headless/lock-acquire.ts` — `acquireLock` -> `lock.acquire`
- `src/cli/headless/lock-release.ts` — `releaseLock` -> `lock.release`
- `src/cli/headless/lock-status.ts` — `getLockStatus` -> `lock.status`
- `src/cli/headless/lock-force.ts` — `forceReleaseLock` -> `lock.forceRelease`

**Step 1: Read each file, apply the rename**

For each file, the change is mechanical — insert the namespace between `.noorm.` and the method name. Example:

```typescript
// Before
const result = await ctx.noorm.fastForward();

// After
const result = await ctx.noorm.changes.ff();
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Commit**

Message: `refactor(cli): update headless commands to use SDK namespaces`

---

### Task 11: Run full test suite and fix

**Step 1: Run all SDK tests**

Run: `bun test tests/sdk/`
Expected: All PASS

**Step 2: Run full test suite**

Run: `bun test`
Expected: Known failures only (better-sqlite3 native module mismatch — pre-existing)

**Step 3: Run typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS

**Step 4: Fix any issues found**

**Step 5: Commit**

Message: `fix(sdk): resolve any issues from namespace migration`

---

Plan complete and saved to `docs/plans/2026-02-21-sdk-namespace-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints

Which approach?
