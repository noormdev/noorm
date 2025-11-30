# Changeset


## Overview

Changesets are versioned database modifications applied after the initial schema build. They support:

- **Forward migrations** (change/) - Apply modifications
- **Rollback** (revert/) - Undo modifications
- **Tracking** - History of what's been applied

Unlike "migrations", changesets acknowledge that you're modifying state, not moving data between locations.


## Dependencies

```json
{
    "kysely": "^0.27.0",
    "@logosdx/observer": "^x.x.x",
    "@logosdx/utils": "^x.x.x"
}
```


## File Structure

```
src/core/
├── changeset/
│   ├── index.ts           # Public exports
│   ├── manager.ts         # High-level changeset operations
│   ├── parser.ts          # Parse changeset structure
│   ├── executor.ts        # Execute changesets
│   ├── history.ts         # Changeset history tracking
│   └── types.ts           # Changeset interfaces
```


## Changeset Directory Structure

```
changesets/
├── 2024-01-15_add-email-verification/
│   ├── change/
│   │   ├── 001_alter_users.sql
│   │   └── 002_create_tokens.sql
│   └── revert/
│       ├── 001_drop_tokens.sql
│       └── 002_revert_users.sql
│
├── 2024-01-20_add-user-roles/
│   ├── change/
│   │   └── 001_create_roles.sql
│   └── revert/
│       └── 001_drop_roles.sql
│
└── 2024-02-01_optimize-indexes/
    ├── change/
    │   └── 001_add_indexes.sql
    └── revert/
        └── 001_drop_indexes.sql
```


## Types

```typescript
// src/core/changeset/types.ts

import { Identity } from '../identity/types';
import { FileResult } from '../runner/types';

export type Direction = 'change' | 'revert';

export interface Changeset {
    /** Unique name (folder name) */
    name: string;

    /** Full path to changeset directory */
    path: string;

    /** Files in change/ directory */
    changeFiles: string[];

    /** Files in revert/ directory */
    revertFiles: string[];

    /** Parsed date from name (if present) */
    date: Date | null;

    /** Description from name (after date) */
    description: string;
}

export interface ChangesetStatus {
    /** Changeset name */
    name: string;

    /** Whether this changeset has been applied */
    applied: boolean;

    /** When it was applied (if applied) */
    appliedAt: Date | null;

    /** Who applied it */
    appliedBy: string | null;

    /** Whether it was later reverted */
    reverted: boolean;

    /** When it was reverted (if reverted) */
    revertedAt: Date | null;
}

export interface ChangesetRecord {
    id: number;
    changesetName: string;
    direction: Direction;
    executedAt: Date;
    executedBy: string;
    identitySource: string;
    configName: string;
    status: 'success' | 'failed';
    errorMessage: string | null;
    filesExecuted: FileExecutionInfo[];
    durationMs: number;
}

export interface FileExecutionInfo {
    filepath: string;
    checksum: string;
    status: 'success' | 'failed';
    error?: string;
}

export interface ExecuteResult {
    name: string;
    direction: Direction;
    status: 'success' | 'failed';
    filesExecuted: number;
    durationMs: number;
    error?: string;
    fileResults: FileResult[];
}

export interface ChangesetRunOptions {
    /** Stop on first file failure */
    abortOnError?: boolean;

    /** Dry run - report what would happen */
    dryRun?: boolean;
}
```


## Parser

Parses changeset directories and structures.

```typescript
// src/core/changeset/parser.ts

import { readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import { attempt } from '@logosdx/utils';
import { Changeset } from './types';
import { observer } from '../observer';

/**
 * Parse a changeset name into date and description.
 *
 * Expected format: YYYY-MM-DD_description-here
 * Example: 2024-01-15_add-email-verification
 */
function parseChangesetName(name: string): { date: Date | null; description: string } {

    // Match YYYY-MM-DD at start
    const dateMatch = name.match(/^(\d{4}-\d{2}-\d{2})_(.+)$/);

    if (dateMatch) {

        const date = new Date(dateMatch[1]);
        const description = dateMatch[2].replace(/-/g, ' ');

        return {
            date: isNaN(date.getTime()) ? null : date,
            description
        };
    }

    return {
        date: null,
        description: name.replace(/-/g, ' ')
    };
}

/**
 * Get sorted SQL files from a directory.
 */
async function getSqlFiles(dirPath: string): Promise<string[]> {

    const [entries, err] = await attempt(() => readdir(dirPath, { withFileTypes: true }));

    if (err) {

        // Directory doesn't exist
        return [];
    }

    const files = entries!
        .filter(e => e.isFile() && (e.name.endsWith('.sql') || e.name.endsWith('.sql.eta')))
        .map(e => join(dirPath, e.name))
        .sort((a, b) => basename(a).localeCompare(basename(b)));

    return files;
}

/**
 * Parse a single changeset directory.
 */
export async function parseChangeset(changesetPath: string): Promise<Changeset> {

    const name = basename(changesetPath);
    const { date, description } = parseChangesetName(name);

    const changePath = join(changesetPath, 'change');
    const revertPath = join(changesetPath, 'revert');

    const [changeFiles, revertFiles] = await Promise.all([
        getSqlFiles(changePath),
        getSqlFiles(revertPath)
    ]);

    return {
        name,
        path: changesetPath,
        changeFiles,
        revertFiles,
        date,
        description,
    };
}

/**
 * Discover all changesets in a directory.
 */
export async function discoverChangesets(changesetsPath: string): Promise<Changeset[]> {

    const [entries, err] = await attempt(() => readdir(changesetsPath, { withFileTypes: true }));

    if (err) {

        observer.emit('error', { source: 'changeset', error: err, context: { path: changesetsPath } });
        return [];
    }

    const changesets: Changeset[] = [];

    for (const entry of entries!) {

        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;  // Skip hidden

        const changesetPath = join(changesetsPath, entry.name);
        const changeset = await parseChangeset(changesetPath);

        changesets.push(changeset);
    }

    // Sort by date (oldest first), then by name
    return changesets.sort((a, b) => {

        if (a.date && b.date) {

            return a.date.getTime() - b.date.getTime();
        }

        if (a.date) return -1;
        if (b.date) return 1;

        return a.name.localeCompare(b.name);
    });
}

/**
 * Validate a changeset structure.
 */
export function validateChangeset(changeset: Changeset): { valid: boolean; errors: string[] } {

    const errors: string[] = [];

    if (changeset.changeFiles.length === 0) {

        errors.push(`No SQL files in change/ directory`);
    }

    // Revert is optional but recommended
    if (changeset.revertFiles.length === 0) {

        // This is a warning, not an error
        observer.emit('error', {
            source: 'changeset',
            error: new Error(`No revert files in ${changeset.name} - rollback will not be possible`),
            context: { changeset: changeset.name }
        });
    }

    return {
        valid: errors.length === 0,
        errors
    };
}
```


## History

Manages the `__change_version__` tracking table.

```typescript
// src/core/changeset/history.ts

import { Kysely, sql } from 'kysely';
import { attempt } from '@logosdx/utils';
import { Direction, ChangesetRecord, ChangesetStatus, FileExecutionInfo } from './types';
import { Identity, identityToString } from '../identity';
import { observer } from '../observer';

export class ChangesetHistory {

    constructor(
        private db: Kysely<any>,
        private configName: string
    ) {}

    /**
     * Ensure history table exists (call during bootstrap).
     */
    async ensureTable(): Promise<void> {

        await sql`
            CREATE TABLE IF NOT EXISTS __change_version__ (
                id SERIAL PRIMARY KEY,
                changeset_name VARCHAR(255) NOT NULL,
                direction VARCHAR(10) NOT NULL,
                executed_at TIMESTAMP DEFAULT NOW(),
                executed_by VARCHAR(255) NOT NULL,
                identity_source VARCHAR(20),
                config_name VARCHAR(100) NOT NULL,
                status VARCHAR(20) NOT NULL,
                error_message TEXT,
                files_executed TEXT,
                duration_ms INTEGER,
                UNIQUE(changeset_name, config_name, direction)
            )
        `.execute(this.db);
    }

    /**
     * Record a changeset execution.
     */
    async recordExecution(
        changesetName: string,
        direction: Direction,
        identity: Identity,
        status: 'success' | 'failed',
        durationMs: number,
        filesExecuted: FileExecutionInfo[],
        errorMessage?: string
    ): Promise<void> {

        const values = {
            changeset_name: changesetName,
            direction,
            executed_at: new Date(),
            executed_by: identityToString(identity),
            identity_source: identity.source,
            config_name: this.configName,
            status,
            error_message: errorMessage ?? null,
            files_executed: JSON.stringify(filesExecuted),
            duration_ms: durationMs,
        };

        const [, err] = await attempt(async () => {

            // Try delete first to allow re-running
            await this.db
                .deleteFrom('__change_version__')
                .where('changeset_name', '=', changesetName)
                .where('config_name', '=', this.configName)
                .where('direction', '=', direction)
                .execute();

            // Insert new record
            await this.db
                .insertInto('__change_version__')
                .values(values)
                .execute();
        });

        if (err) {

            observer.emit('error', { source: 'changeset-history', error: err });
            throw err;
        }
    }

    /**
     * Get the status of a specific changeset.
     */
    async getStatus(changesetName: string): Promise<ChangesetStatus> {

        const [records, err] = await attempt(() =>
            this.db
                .selectFrom('__change_version__')
                .selectAll()
                .where('changeset_name', '=', changesetName)
                .where('config_name', '=', this.configName)
                .orderBy('executed_at', 'desc')
                .execute()
        );

        if (err || !records || records.length === 0) {

            return {
                name: changesetName,
                applied: false,
                appliedAt: null,
                appliedBy: null,
                reverted: false,
                revertedAt: null,
            };
        }

        const changeRecord = records.find(r => r.direction === 'change' && r.status === 'success');
        const revertRecord = records.find(r => r.direction === 'revert' && r.status === 'success');

        // If reverted after being applied, it's not currently applied
        const wasReverted = revertRecord &&
            changeRecord &&
            new Date(revertRecord.executed_at) > new Date(changeRecord.executed_at);

        return {
            name: changesetName,
            applied: !!changeRecord && !wasReverted,
            appliedAt: changeRecord ? new Date(changeRecord.executed_at) : null,
            appliedBy: changeRecord?.executed_by ?? null,
            reverted: wasReverted ?? false,
            revertedAt: revertRecord ? new Date(revertRecord.executed_at) : null,
        };
    }

    /**
     * Get all changeset records for this config.
     */
    async getAllRecords(): Promise<ChangesetRecord[]> {

        const [results, err] = await attempt(() =>
            this.db
                .selectFrom('__change_version__')
                .selectAll()
                .where('config_name', '=', this.configName)
                .orderBy('executed_at', 'desc')
                .execute()
        );

        if (err) {

            observer.emit('error', { source: 'changeset-history', error: err });
            return [];
        }

        return results!.map(r => ({
            id: r.id,
            changesetName: r.changeset_name,
            direction: r.direction as Direction,
            executedAt: new Date(r.executed_at),
            executedBy: r.executed_by,
            identitySource: r.identity_source,
            configName: r.config_name,
            status: r.status,
            errorMessage: r.error_message,
            filesExecuted: JSON.parse(r.files_executed || '[]'),
            durationMs: r.duration_ms,
        }));
    }

    /**
     * Get the most recently applied changeset.
     */
    async getLatestApplied(): Promise<string | null> {

        const [result, err] = await attempt(() =>
            this.db
                .selectFrom('__change_version__')
                .select('changeset_name')
                .where('config_name', '=', this.configName)
                .where('direction', '=', 'change')
                .where('status', '=', 'success')
                .orderBy('executed_at', 'desc')
                .limit(1)
                .executeTakeFirst()
        );

        if (err || !result) {

            return null;
        }

        return result.changeset_name;
    }

    /**
     * Get list of applied changesets (in order).
     */
    async getAppliedChangesets(): Promise<string[]> {

        const [results, err] = await attempt(() =>
            this.db
                .selectFrom('__change_version__')
                .select('changeset_name')
                .distinct()
                .where('config_name', '=', this.configName)
                .where('direction', '=', 'change')
                .where('status', '=', 'success')
                .orderBy('executed_at', 'asc')
                .execute()
        );

        if (err) {

            return [];
        }

        // Filter out reverted ones
        const applied: string[] = [];

        for (const r of results!) {

            const status = await this.getStatus(r.changeset_name);
            if (status.applied) {

                applied.push(r.changeset_name);
            }
        }

        return applied;
    }
}
```


## Executor

Executes changeset operations.

```typescript
// src/core/changeset/executor.ts

import { Kysely } from 'kysely';
import { batch, attempt } from '@logosdx/utils';
import { Config } from '../config/types';
import { Identity, resolveIdentity } from '../identity';
import { Runner } from '../runner';
import { LockManager } from '../lock';
import { Changeset, Direction, ExecuteResult, ChangesetRunOptions, FileExecutionInfo } from './types';
import { ChangesetHistory } from './history';
import { observer } from '../observer';

export class ChangesetExecutor {

    private runner: Runner;
    private history: ChangesetHistory;
    private lockManager: LockManager;
    private identity: Identity;

    constructor(
        private db: Kysely<any>,
        private config: Config
    ) {

        this.runner = new Runner(db, config);
        this.history = new ChangesetHistory(db, config.name);
        this.lockManager = new LockManager(db, config.connection.dialect, config.name);
        this.identity = resolveIdentity({ configIdentity: config.identity });
    }

    /**
     * Execute a changeset in a given direction.
     */
    async execute(
        changeset: Changeset,
        direction: Direction,
        options: ChangesetRunOptions = {}
    ): Promise<ExecuteResult> {

        const files = direction === 'change' ? changeset.changeFiles : changeset.revertFiles;
        const start = performance.now();

        observer.emit('changeset:start', {
            name: changeset.name,
            direction,
            files: files.map(f => f)
        });

        // Validate
        if (files.length === 0) {

            const error = `No ${direction} files found in changeset ${changeset.name}`;
            observer.emit('error', { source: 'changeset', error: new Error(error) });

            return {
                name: changeset.name,
                direction,
                status: 'failed',
                filesExecuted: 0,
                durationMs: performance.now() - start,
                error,
                fileResults: [],
            };
        }

        // Check current status
        const status = await this.history.getStatus(changeset.name);

        if (direction === 'change' && status.applied) {

            const error = `Changeset ${changeset.name} is already applied`;
            observer.emit('error', { source: 'changeset', error: new Error(error) });

            return {
                name: changeset.name,
                direction,
                status: 'failed',
                filesExecuted: 0,
                durationMs: performance.now() - start,
                error,
                fileResults: [],
            };
        }

        if (direction === 'revert' && !status.applied) {

            const error = `Changeset ${changeset.name} is not applied, cannot revert`;
            observer.emit('error', { source: 'changeset', error: new Error(error) });

            return {
                name: changeset.name,
                direction,
                status: 'failed',
                filesExecuted: 0,
                durationMs: performance.now() - start,
                error,
                fileResults: [],
            };
        }

        // Dry run
        if (options.dryRun) {

            return {
                name: changeset.name,
                direction,
                status: 'success',
                filesExecuted: files.length,
                durationMs: performance.now() - start,
                fileResults: files.map(f => ({
                    filepath: f,
                    checksum: '',
                    status: 'success' as const,
                    skipped: false,
                })),
            };
        }

        // Execute files sequentially
        const fileResults = await batch(
            async (filepath: string, index: number) => {

                observer.emit('changeset:file', {
                    changeset: changeset.name,
                    filepath,
                    index,
                    total: files.length
                });

                return this.runner.runFile(filepath, {
                    force: true,  // Always run changeset files
                    abortOnError: options.abortOnError ?? true,
                });
            },
            {
                items: files,
                concurrency: 1,  // Always sequential for changesets
                failureMode: (options.abortOnError ?? true) ? 'abort' : 'continue',
            }
        );

        const results = fileResults.map(r => r.result!).filter(Boolean);
        const filesExecuted = results.filter(r => r.status === 'success').length;
        const failed = results.some(r => r.status === 'failed');
        const durationMs = performance.now() - start;

        // Prepare file info for history
        const filesInfo: FileExecutionInfo[] = results.map(r => ({
            filepath: r.filepath,
            checksum: r.checksum,
            status: r.status === 'skipped' ? 'success' : r.status,
            error: r.error,
        }));

        // Record in history
        const firstError = results.find(r => r.error)?.error;

        await this.history.recordExecution(
            changeset.name,
            direction,
            this.identity,
            failed ? 'failed' : 'success',
            durationMs,
            filesInfo,
            firstError
        );

        observer.emit('changeset:complete', {
            name: changeset.name,
            direction,
            status: failed ? 'failed' : 'success',
            durationMs
        });

        return {
            name: changeset.name,
            direction,
            status: failed ? 'failed' : 'success',
            filesExecuted,
            durationMs,
            error: firstError,
            fileResults: results,
        };
    }

    /**
     * Execute with lock protection.
     */
    async executeWithLock(
        changeset: Changeset,
        direction: Direction,
        options: ChangesetRunOptions = {}
    ): Promise<ExecuteResult> {

        return this.lockManager.withLock(this.identity, async () => {

            return this.execute(changeset, direction, options);
        });
    }

    /**
     * Get the history manager.
     */
    getHistory(): ChangesetHistory {

        return this.history;
    }
}
```


## Manager

High-level changeset operations.

```typescript
// src/core/changeset/manager.ts

import { Kysely } from 'kysely';
import { resolve } from 'path';
import { batch, attempt } from '@logosdx/utils';
import { Config } from '../config/types';
import { Identity, resolveIdentity } from '../identity';
import { LockManager } from '../lock';
import { Changeset, ChangesetStatus, ExecuteResult, ChangesetRunOptions } from './types';
import { discoverChangesets, parseChangeset, validateChangeset } from './parser';
import { ChangesetExecutor } from './executor';
import { ChangesetHistory } from './history';
import { observer } from '../observer';

export class ChangesetManager {

    private executor: ChangesetExecutor;
    private history: ChangesetHistory;
    private lockManager: LockManager;
    private identity: Identity;
    private changesetsPath: string;

    constructor(
        private db: Kysely<any>,
        private config: Config
    ) {

        this.executor = new ChangesetExecutor(db, config);
        this.history = new ChangesetHistory(db, config.name);
        this.lockManager = new LockManager(db, config.connection.dialect, config.name);
        this.identity = resolveIdentity({ configIdentity: config.identity });
        this.changesetsPath = resolve(config.paths.changesets);
    }

    /**
     * Discover all changesets and their status.
     */
    async list(): Promise<Array<Changeset & { status: ChangesetStatus }>> {

        const changesets = await discoverChangesets(this.changesetsPath);
        const result: Array<Changeset & { status: ChangesetStatus }> = [];

        for (const changeset of changesets) {

            const status = await this.history.getStatus(changeset.name);
            result.push({ ...changeset, status });
        }

        return result;
    }

    /**
     * Get pending (unapplied) changesets.
     */
    async getPending(): Promise<Changeset[]> {

        const all = await this.list();
        return all.filter(c => !c.status.applied);
    }

    /**
     * Get applied changesets in order.
     */
    async getApplied(): Promise<Changeset[]> {

        const all = await this.list();
        return all.filter(c => c.status.applied);
    }

    /**
     * Run a specific changeset by name.
     */
    async run(name: string, options: ChangesetRunOptions = {}): Promise<ExecuteResult> {

        const changesetPath = resolve(this.changesetsPath, name);
        const changeset = await parseChangeset(changesetPath);

        const validation = validateChangeset(changeset);
        if (!validation.valid) {

            return {
                name,
                direction: 'change',
                status: 'failed',
                filesExecuted: 0,
                durationMs: 0,
                error: validation.errors.join(', '),
                fileResults: [],
            };
        }

        return this.executor.executeWithLock(changeset, 'change', options);
    }

    /**
     * Revert a specific changeset by name.
     */
    async revert(name: string, options: ChangesetRunOptions = {}): Promise<ExecuteResult> {

        const changesetPath = resolve(this.changesetsPath, name);
        const changeset = await parseChangeset(changesetPath);

        if (changeset.revertFiles.length === 0) {

            return {
                name,
                direction: 'revert',
                status: 'failed',
                filesExecuted: 0,
                durationMs: 0,
                error: `No revert files found in changeset ${name}`,
                fileResults: [],
            };
        }

        return this.executor.executeWithLock(changeset, 'revert', options);
    }

    /**
     * Apply next N pending changesets (default: 1).
     */
    async next(count: number = 1, options: ChangesetRunOptions = {}): Promise<ExecuteResult[]> {

        const pending = await this.getPending();
        const toApply = pending.slice(0, count);

        if (toApply.length === 0) {

            return [];
        }

        return this.lockManager.withLock(this.identity, async () => {

            const results: ExecuteResult[] = [];

            for (const changeset of toApply) {

                const result = await this.executor.execute(changeset, 'change', options);
                results.push(result);

                // Stop on failure unless continue mode
                if (result.status === 'failed' && options.abortOnError !== false) {

                    break;
                }
            }

            return results;
        });
    }

    /**
     * Fast-forward: apply ALL pending changesets.
     */
    async fastForward(options: ChangesetRunOptions = {}): Promise<ExecuteResult[]> {

        const pending = await this.getPending();

        if (pending.length === 0) {

            return [];
        }

        return this.lockManager.withLock(this.identity, async () => {

            const results: ExecuteResult[] = [];

            for (const changeset of pending) {

                const result = await this.executor.execute(changeset, 'change', options);
                results.push(result);

                if (result.status === 'failed' && options.abortOnError !== false) {

                    break;
                }
            }

            return results;
        });
    }

    /**
     * Get the status of a specific changeset.
     */
    async getStatus(name: string): Promise<ChangesetStatus> {

        return this.history.getStatus(name);
    }

    /**
     * Get full execution history.
     */
    async getFullHistory() {

        return this.history.getAllRecords();
    }

    /**
     * Ensure tracking tables exist.
     */
    async ensureTables(): Promise<void> {

        await this.history.ensureTable();
    }
}
```


## Public Exports

```typescript
// src/core/changeset/index.ts

export { ChangesetManager } from './manager';
export { ChangesetExecutor } from './executor';
export { ChangesetHistory } from './history';
export { discoverChangesets, parseChangeset, validateChangeset } from './parser';
export * from './types';
```


## Usage Examples


### List All Changesets

```typescript
import { ChangesetManager } from './core/changeset';
import { createConnection } from './core/connection';

const conn = await createConnection(config.connection, config.name);
const manager = new ChangesetManager(conn.db, config);

await manager.ensureTables();

const changesets = await manager.list();

for (const cs of changesets) {

    const statusIcon = cs.status.applied ? '✓' : '○';
    console.log(`${statusIcon} ${cs.name}`);

    if (cs.status.applied) {

        console.log(`    Applied: ${cs.status.appliedAt?.toISOString()}`);
        console.log(`    By: ${cs.status.appliedBy}`);
    }
}
```


### Run a Specific Changeset

```typescript
const result = await manager.run('2024-01-15_add-email-verification');

if (result.status === 'success') {

    console.log(`Applied ${result.filesExecuted} files in ${result.durationMs}ms`);
}
else {

    console.error(`Failed: ${result.error}`);
}
```


### Revert a Changeset

```typescript
const result = await manager.revert('2024-01-15_add-email-verification');

if (result.status === 'success') {

    console.log('Reverted successfully');
}
```


### Apply Next Pending

```typescript
// Apply next 1
const [result] = await manager.next();

// Apply next 3
const results = await manager.next(3);

console.log(`Applied ${results.filter(r => r.status === 'success').length} changesets`);
```


### Fast Forward (Apply All Pending)

```typescript
const results = await manager.fastForward();

const success = results.filter(r => r.status === 'success').length;
const failed = results.filter(r => r.status === 'failed').length;

console.log(`Fast forward complete: ${success} applied, ${failed} failed`);
```


### Check Pending

```typescript
const pending = await manager.getPending();

if (pending.length === 0) {

    console.log('All changesets applied');
}
else {

    console.log(`${pending.length} pending changesets:`);

    for (const cs of pending) {

        console.log(`  - ${cs.name}`);
    }
}
```


### Dry Run

```typescript
const pending = await manager.getPending();

for (const cs of pending) {

    const result = await manager.run(cs.name, { dryRun: true });
    console.log(`Would apply ${cs.name}: ${result.filesExecuted} files`);
}
```


## Observer Events

| Event | When |
|-------|------|
| `changeset:start` | Beginning changeset execution |
| `changeset:file` | About to execute a file within changeset |
| `changeset:complete` | Changeset execution finished |
| `error` | Any error during execution |


## Tracking Table Schema

```sql
CREATE TABLE __change_version__ (
    id SERIAL PRIMARY KEY,
    changeset_name VARCHAR(255) NOT NULL,     -- e.g., "2024-01-15_add-email"
    direction VARCHAR(10) NOT NULL,            -- 'change' or 'revert'
    executed_at TIMESTAMP DEFAULT NOW(),
    executed_by VARCHAR(255) NOT NULL,         -- Identity string
    identity_source VARCHAR(20),               -- 'git', 'system', 'config', 'env'
    config_name VARCHAR(100) NOT NULL,         -- Which config was used
    status VARCHAR(20) NOT NULL,               -- 'success' or 'failed'
    error_message TEXT,                        -- Error details if failed
    files_executed TEXT,                       -- JSON array of file info
    duration_ms INTEGER,                       -- Total execution time
    UNIQUE(changeset_name, config_name, direction)
);
```


## Changeset Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                      DISCOVERED                              │
│  changesets/2024-01-15_add-email/                           │
│    ├── change/                                               │
│    │   ├── 001_alter_users.sql                              │
│    │   └── 002_create_tokens.sql                            │
│    └── revert/                                               │
│        ├── 001_drop_tokens.sql                              │
│        └── 002_revert_users.sql                             │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                       PENDING                                │
│  status.applied = false                                      │
│  Can run: change                                             │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ manager.run('2024-01-15_add-email')
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                       APPLIED                                │
│  status.applied = true                                       │
│  status.appliedAt = 2024-01-15T10:30:00Z                    │
│  status.appliedBy = "john <john@example.com>"               │
│  Can run: revert                                             │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ manager.revert('2024-01-15_add-email')
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                       REVERTED                               │
│  status.applied = false                                      │
│  status.reverted = true                                      │
│  status.revertedAt = 2024-01-16T09:00:00Z                   │
│  Can run: change (re-apply)                                  │
└─────────────────────────────────────────────────────────────┘
```


## Testing

```typescript
import { ChangesetManager, discoverChangesets, parseChangeset } from './core/changeset';
import { createConnection } from './core/connection';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { observer } from './core/observer';

describe('Changeset', () => {

    let tempDir: string;
    let conn: ConnectionResult;
    let manager: ChangesetManager;

    const mockConfig = {
        name: 'test',
        type: 'local' as const,
        isTest: true,
        protected: false,
        connection: { dialect: 'sqlite' as const, database: ':memory:' },
        paths: { schema: '', changesets: '' },
    };

    beforeEach(async () => {

        tempDir = mkdtempSync(join(tmpdir(), 'noorm-changeset-'));
        mockConfig.paths.changesets = join(tempDir, 'changesets');
        mkdirSync(mockConfig.paths.changesets);

        conn = await createConnection(mockConfig.connection);
        manager = new ChangesetManager(conn.db, mockConfig);

        // Create test table
        await conn.db.executeQuery(
            conn.db.raw('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)').compile(conn.db)
        );

        await manager.ensureTables();
    });

    afterEach(async () => {

        await conn.destroy();
        rmSync(tempDir, { recursive: true });
    });

    function createChangeset(name: string, changeSql: string, revertSql: string) {

        const csPath = join(mockConfig.paths.changesets, name);
        mkdirSync(csPath);
        mkdirSync(join(csPath, 'change'));
        mkdirSync(join(csPath, 'revert'));

        writeFileSync(join(csPath, 'change', '001.sql'), changeSql);
        writeFileSync(join(csPath, 'revert', '001.sql'), revertSql);
    }

    it('should discover changesets', async () => {

        createChangeset('2024-01-15_test', 'SELECT 1;', 'SELECT 1;');

        const changesets = await discoverChangesets(mockConfig.paths.changesets);

        expect(changesets).toHaveLength(1);
        expect(changesets[0].name).toBe('2024-01-15_test');
        expect(changesets[0].date).toBeDefined();
    });

    it('should parse changeset name', async () => {

        createChangeset('2024-01-15_add-email-verification', 'SELECT 1;', 'SELECT 1;');

        const changeset = await parseChangeset(
            join(mockConfig.paths.changesets, '2024-01-15_add-email-verification')
        );

        expect(changeset.date?.toISOString()).toContain('2024-01-15');
        expect(changeset.description).toBe('add email verification');
    });

    it('should run a changeset', async () => {

        createChangeset('2024-01-15_test', 'ALTER TABLE users ADD COLUMN name TEXT;', 'SELECT 1;');

        const result = await manager.run('2024-01-15_test');

        expect(result.status).toBe('success');
        expect(result.filesExecuted).toBe(1);
    });

    it('should track applied changesets', async () => {

        createChangeset('2024-01-15_test', 'SELECT 1;', 'SELECT 1;');

        await manager.run('2024-01-15_test');
        const status = await manager.getStatus('2024-01-15_test');

        expect(status.applied).toBe(true);
        expect(status.appliedAt).toBeDefined();
    });

    it('should not allow re-running applied changeset', async () => {

        createChangeset('2024-01-15_test', 'SELECT 1;', 'SELECT 1;');

        await manager.run('2024-01-15_test');
        const result = await manager.run('2024-01-15_test');

        expect(result.status).toBe('failed');
        expect(result.error).toContain('already applied');
    });

    it('should revert a changeset', async () => {

        createChangeset('2024-01-15_test', 'SELECT 1;', 'SELECT 2;');

        await manager.run('2024-01-15_test');
        const result = await manager.revert('2024-01-15_test');

        expect(result.status).toBe('success');

        const status = await manager.getStatus('2024-01-15_test');
        expect(status.applied).toBe(false);
        expect(status.reverted).toBe(true);
    });

    it('should get pending changesets', async () => {

        createChangeset('2024-01-15_first', 'SELECT 1;', 'SELECT 1;');
        createChangeset('2024-01-16_second', 'SELECT 2;', 'SELECT 2;');

        await manager.run('2024-01-15_first');

        const pending = await manager.getPending();

        expect(pending).toHaveLength(1);
        expect(pending[0].name).toBe('2024-01-16_second');
    });

    it('should apply next N changesets', async () => {

        createChangeset('2024-01-15_first', 'SELECT 1;', 'SELECT 1;');
        createChangeset('2024-01-16_second', 'SELECT 2;', 'SELECT 2;');
        createChangeset('2024-01-17_third', 'SELECT 3;', 'SELECT 3;');

        const results = await manager.next(2);

        expect(results).toHaveLength(2);
        expect(results[0].name).toBe('2024-01-15_first');
        expect(results[1].name).toBe('2024-01-16_second');

        const pending = await manager.getPending();
        expect(pending).toHaveLength(1);
    });

    it('should fast forward all pending', async () => {

        createChangeset('2024-01-15_first', 'SELECT 1;', 'SELECT 1;');
        createChangeset('2024-01-16_second', 'SELECT 2;', 'SELECT 2;');

        const results = await manager.fastForward();

        expect(results).toHaveLength(2);

        const pending = await manager.getPending();
        expect(pending).toHaveLength(0);
    });

    it('should emit observer events', async () => {

        const events: string[] = [];
        const cleanup = observer.on(/^changeset:/, ({ event }) => {
            events.push(event);
        });

        createChangeset('2024-01-15_test', 'SELECT 1;', 'SELECT 1;');
        await manager.run('2024-01-15_test');

        cleanup();

        expect(events).toContain('changeset:start');
        expect(events).toContain('changeset:file');
        expect(events).toContain('changeset:complete');
    });

    it('should handle dry run', async () => {

        createChangeset('2024-01-15_test', 'SELECT 1;', 'SELECT 1;');

        const result = await manager.run('2024-01-15_test', { dryRun: true });

        expect(result.status).toBe('success');

        // Should not be recorded
        const status = await manager.getStatus('2024-01-15_test');
        expect(status.applied).toBe(false);
    });
});
```


## Error Handling

| Error | Cause | Resolution |
|-------|-------|------------|
| `already applied` | Trying to run an applied changeset | Revert first, or skip |
| `not applied, cannot revert` | Trying to revert non-applied changeset | Run it first |
| `No revert files` | Missing revert/ directory | Add revert scripts |
| SQL error | Invalid SQL in changeset | Fix the SQL |


## Best Practices

1. **Date-prefix your changesets** - Use `YYYY-MM-DD_description` format for ordering
2. **Always write revert scripts** - Even if they're just DROP statements
3. **One logical change per changeset** - Don't bundle unrelated changes
4. **Test changesets locally first** - Use a test database before production
5. **Number files within changesets** - Use `001_`, `002_` for execution order
6. **Keep changesets small** - Easier to debug and revert
7. **Document complex changes** - Add comments in SQL files


## CLI Commands

### `noorm change list`

```
Changesets:
  ✓ 2024-01-15_add-email-verification
      Applied: 2024-01-15T10:30:00Z by john@example.com
  ✓ 2024-01-20_add-user-roles
      Applied: 2024-01-20T14:00:00Z by jane@example.com
  ○ 2024-02-01_optimize-indexes
      Pending
```

### `noorm change run <name>`

```
Running changeset: 2024-02-01_optimize-indexes
  ✓ 001_add_indexes.sql (45ms)

Changeset applied successfully in 48ms
```

### `noorm change revert <name>`

```
Reverting changeset: 2024-01-20_add-user-roles
  ✓ 001_drop_roles.sql (12ms)

Changeset reverted successfully in 15ms
```

### `noorm change next [n]`

```
Applying next 2 changesets...
  ✓ 2024-02-01_optimize-indexes (48ms)
  ✓ 2024-02-15_add-audit-logs (35ms)

Applied 2 changesets in 85ms
```

### `noorm change ff`

```
Fast-forwarding 3 pending changesets...
  ✓ 2024-02-01_optimize-indexes (48ms)
  ✓ 2024-02-15_add-audit-logs (35ms)
  ✓ 2024-03-01_add-user-preferences (22ms)

Fast-forward complete: 3 applied in 108ms
```
