# Runner


## Overview

The runner executes SQL files against a database. It supports three modes:

1. **Build** - Execute all files in the schema directory (for fresh DB setup)
2. **File** - Execute a single SQL file
3. **Dir** - Execute all SQL files in a directory

All executions are tracked in `__change_files__` for idempotency and audit trails.


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
├── runner/
│   ├── index.ts           # Public exports
│   ├── runner.ts          # Main runner class
│   ├── tracker.ts         # File execution tracking
│   ├── checksum.ts        # File hashing
│   └── types.ts           # Runner interfaces
```


## Types

```typescript
// src/core/runner/types.ts

import { Identity } from '../identity/types';

export interface FileResult {
    filepath: string;
    checksum: string;
    status: 'success' | 'failed' | 'skipped';
    skipped: boolean;
    skipReason?: 'unchanged' | 'already-run';
    durationMs?: number;
    error?: string;
}

export interface BuildResult {
    schemaPath: string;
    filesRun: number;
    filesSkipped: number;
    filesFailed: number;
    totalFiles: number;
    durationMs: number;
    status: 'success' | 'failed';
    results: FileResult[];
}

export interface DirResult {
    dirPath: string;
    filesRun: number;
    filesSkipped: number;
    filesFailed: number;
    totalFiles: number;
    durationMs: number;
    status: 'success' | 'failed';
    results: FileResult[];
}

export interface RunOptions {
    /** Force re-run even if unchanged */
    force?: boolean;

    /** Concurrency for file execution (default: 1 for DDL safety) */
    concurrency?: number;

    /** Stop on first failure */
    abortOnError?: boolean;

    /** Dry run - don't execute, just report */
    dryRun?: boolean;
}

export interface TrackedFile {
    id: number;
    filepath: string;
    checksum: string;
    sizeBytes: number | null;
    executedAt: Date;
    executedBy: string;
    identitySource: string;
    configName: string;
    status: 'success' | 'failed';
    errorMessage: string | null;
    durationMs: number | null;
}
```


## Checksum

```typescript
// src/core/runner/checksum.ts

import { createHash } from 'crypto';
import { readFile, stat } from 'fs/promises';
import { attempt } from '@logosdx/utils';

/**
 * Compute SHA-256 checksum of a file.
 */
export async function computeChecksum(filepath: string): Promise<string> {

    const [content, err] = await attempt(() => readFile(filepath, 'utf8'));

    if (err) {

        throw new Error(`Failed to read file for checksum: ${filepath}`);
    }

    return createHash('sha256').update(content!).digest('hex');
}

/**
 * Get file size in bytes.
 */
export async function getFileSize(filepath: string): Promise<number | null> {

    const [stats, err] = await attempt(() => stat(filepath));

    if (err) {

        return null;
    }

    return stats!.size;
}
```


## Tracker

Manages the `__change_files__` table for tracking executions.

```typescript
// src/core/runner/tracker.ts

import { Kysely, sql } from 'kysely';
import { attempt } from '@logosdx/utils';
import { TrackedFile } from './types';
import { Identity, identityToString } from '../identity';
import { observer } from '../observer';

export class FileTracker {

    constructor(
        private db: Kysely<any>,
        private configName: string
    ) {}

    /**
     * Ensure tracking table exists (call during bootstrap).
     */
    async ensureTable(): Promise<void> {

        await sql`
            CREATE TABLE IF NOT EXISTS __change_files__ (
                id SERIAL PRIMARY KEY,
                filepath VARCHAR(500) NOT NULL,
                checksum VARCHAR(64) NOT NULL,
                size_bytes INTEGER,
                executed_at TIMESTAMP DEFAULT NOW(),
                executed_by VARCHAR(255) NOT NULL,
                identity_source VARCHAR(20),
                config_name VARCHAR(100) NOT NULL,
                status VARCHAR(20) NOT NULL,
                error_message TEXT,
                duration_ms INTEGER,
                UNIQUE(filepath, config_name)
            )
        `.execute(this.db);
    }

    /**
     * Get tracking record for a file.
     */
    async getRecord(filepath: string): Promise<TrackedFile | null> {

        const [result, err] = await attempt(() =>
            this.db
                .selectFrom('__change_files__')
                .selectAll()
                .where('filepath', '=', filepath)
                .where('config_name', '=', this.configName)
                .executeTakeFirst()
        );

        if (err || !result) {

            return null;
        }

        return {
            id: result.id,
            filepath: result.filepath,
            checksum: result.checksum,
            sizeBytes: result.size_bytes,
            executedAt: new Date(result.executed_at),
            executedBy: result.executed_by,
            identitySource: result.identity_source,
            configName: result.config_name,
            status: result.status,
            errorMessage: result.error_message,
            durationMs: result.duration_ms,
        };
    }

    /**
     * Record a file execution (insert or update).
     */
    async recordExecution(
        filepath: string,
        checksum: string,
        sizeBytes: number | null,
        identity: Identity,
        status: 'success' | 'failed',
        durationMs: number,
        errorMessage?: string
    ): Promise<void> {

        const values = {
            filepath,
            checksum,
            size_bytes: sizeBytes,
            executed_at: new Date(),
            executed_by: identityToString(identity),
            identity_source: identity.source,
            config_name: this.configName,
            status,
            duration_ms: durationMs,
            error_message: errorMessage ?? null,
        };

        // Upsert - insert or update on conflict
        const [, err] = await attempt(async () => {

            // Try insert first
            try {

                await this.db
                    .insertInto('__change_files__')
                    .values(values)
                    .execute();
            }
            catch {

                // Update on conflict
                await this.db
                    .updateTable('__change_files__')
                    .set({
                        checksum: values.checksum,
                        size_bytes: values.size_bytes,
                        executed_at: values.executed_at,
                        executed_by: values.executed_by,
                        identity_source: values.identity_source,
                        status: values.status,
                        duration_ms: values.duration_ms,
                        error_message: values.error_message,
                    })
                    .where('filepath', '=', filepath)
                    .where('config_name', '=', this.configName)
                    .execute();
            }
        });

        if (err) {

            observer.emit('error', { source: 'tracker', error: err, context: { filepath } });
            throw err;
        }
    }

    /**
     * Check if a file needs to run based on checksum.
     */
    async needsRun(filepath: string, checksum: string, force: boolean = false): Promise<{
        needsRun: boolean;
        reason?: 'new' | 'changed' | 'force' | 'failed';
    }> {

        if (force) {

            return { needsRun: true, reason: 'force' };
        }

        const record = await this.getRecord(filepath);

        if (!record) {

            return { needsRun: true, reason: 'new' };
        }

        // Re-run failed files
        if (record.status === 'failed') {

            return { needsRun: true, reason: 'failed' };
        }

        // Check if changed
        if (record.checksum !== checksum) {

            return { needsRun: true, reason: 'changed' };
        }

        return { needsRun: false };
    }

    /**
     * Get all tracked files for this config.
     */
    async getAllRecords(): Promise<TrackedFile[]> {

        const [results, err] = await attempt(() =>
            this.db
                .selectFrom('__change_files__')
                .selectAll()
                .where('config_name', '=', this.configName)
                .orderBy('filepath', 'asc')
                .execute()
        );

        if (err) {

            observer.emit('error', { source: 'tracker', error: err });
            return [];
        }

        return results!.map(r => ({
            id: r.id,
            filepath: r.filepath,
            checksum: r.checksum,
            sizeBytes: r.size_bytes,
            executedAt: new Date(r.executed_at),
            executedBy: r.executed_by,
            identitySource: r.identity_source,
            configName: r.config_name,
            status: r.status,
            errorMessage: r.error_message,
            durationMs: r.duration_ms,
        }));
    }

    /**
     * Clear all tracking records for this config.
     */
    async clearAll(): Promise<void> {

        await this.db
            .deleteFrom('__change_files__')
            .where('config_name', '=', this.configName)
            .execute();
    }
}
```


## Runner

Main runner class that orchestrates file execution.

```typescript
// src/core/runner/runner.ts

import { Kysely, sql } from 'kysely';
import { readdir, stat } from 'fs/promises';
import { join, resolve, extname } from 'path';
import { batch, attempt } from '@logosdx/utils';
import { Config } from '../config/types';
import { Identity, resolveIdentity } from '../identity';
import { getTemplateEngine } from '../template';
import { FileTracker } from './tracker';
import { computeChecksum, getFileSize } from './checksum';
import { FileResult, BuildResult, DirResult, RunOptions } from './types';
import { observer } from '../observer';

export class Runner {

    private tracker: FileTracker;
    private identity: Identity;

    constructor(
        private db: Kysely<any>,
        private config: Config
    ) {

        this.tracker = new FileTracker(db, config.name);
        this.identity = resolveIdentity({ configIdentity: config.identity });
    }

    /**
     * Execute all files in the schema directory (build command).
     */
    async build(options: RunOptions = {}): Promise<BuildResult> {

        const schemaPath = resolve(this.config.paths.schema);
        const start = performance.now();

        // Get all SQL files
        const [files, filesErr] = await attempt(() => this.getSqlFiles(schemaPath));

        if (filesErr) {

            observer.emit('error', { source: 'runner', error: filesErr, context: { schemaPath } });
            throw filesErr;
        }

        observer.emit('build:start', { schemaPath, fileCount: files!.length });

        // Execute files
        const results = await this.executeFiles(files!, options);

        const filesRun = results.filter(r => r.status === 'success' && !r.skipped).length;
        const filesSkipped = results.filter(r => r.skipped).length;
        const filesFailed = results.filter(r => r.status === 'failed').length;
        const durationMs = performance.now() - start;

        const buildResult: BuildResult = {
            schemaPath,
            filesRun,
            filesSkipped,
            filesFailed,
            totalFiles: files!.length,
            durationMs,
            status: filesFailed > 0 ? 'failed' : 'success',
            results,
        };

        observer.emit('build:complete', {
            status: buildResult.status,
            filesRun,
            filesSkipped,
            durationMs
        });

        return buildResult;
    }

    /**
     * Execute a single SQL file.
     */
    async runFile(filepath: string, options: RunOptions = {}): Promise<FileResult> {

        const absolutePath = resolve(filepath);
        const configName = this.config.name;

        observer.emit('run:file', { filepath: absolutePath, configName });

        return this.executeFile(absolutePath, options);
    }

    /**
     * Execute all SQL files in a directory.
     */
    async runDir(dirPath: string, options: RunOptions = {}): Promise<DirResult> {

        const absolutePath = resolve(dirPath);
        const start = performance.now();

        const [files, filesErr] = await attempt(() => this.getSqlFiles(absolutePath));

        if (filesErr) {

            observer.emit('error', { source: 'runner', error: filesErr, context: { dirPath: absolutePath } });
            throw filesErr;
        }

        observer.emit('run:dir', {
            dirpath: absolutePath,
            fileCount: files!.length,
            configName: this.config.name
        });

        const results = await this.executeFiles(files!, options);

        const filesRun = results.filter(r => r.status === 'success' && !r.skipped).length;
        const filesSkipped = results.filter(r => r.skipped).length;
        const filesFailed = results.filter(r => r.status === 'failed').length;
        const durationMs = performance.now() - start;

        return {
            dirPath: absolutePath,
            filesRun,
            filesSkipped,
            filesFailed,
            totalFiles: files!.length,
            durationMs,
            status: filesFailed > 0 ? 'failed' : 'success',
            results,
        };
    }

    /**
     * Execute a batch of files with concurrency control.
     */
    private async executeFiles(files: string[], options: RunOptions): Promise<FileResult[]> {

        const { concurrency = 1, abortOnError = true } = options;

        const results = await batch(
            async (filepath: string) => {

                return this.executeFile(filepath, options);
            },
            {
                items: files,
                concurrency,
                failureMode: abortOnError ? 'abort' : 'continue',
                onError: (err, filepath) => {

                    observer.emit('error', {
                        source: 'runner',
                        error: err,
                        context: { filepath }
                    });
                }
            }
        );

        return results.map(r => r.result ?? {
            filepath: r.item,
            checksum: '',
            status: 'failed' as const,
            skipped: false,
            error: r.error?.message ?? 'Unknown error'
        });
    }

    /**
     * Execute a single file with tracking.
     */
    private async executeFile(filepath: string, options: RunOptions): Promise<FileResult> {

        const start = performance.now();

        // Compute checksum
        const [checksum, checksumErr] = await attempt(() => computeChecksum(filepath));

        if (checksumErr) {

            observer.emit('file:after', {
                filepath,
                status: 'failed',
                durationMs: performance.now() - start,
                error: checksumErr.message
            });

            return {
                filepath,
                checksum: '',
                status: 'failed',
                skipped: false,
                error: checksumErr.message,
                durationMs: performance.now() - start,
            };
        }

        // Check if needs to run
        const needsRun = await this.tracker.needsRun(filepath, checksum!, options.force);

        if (!needsRun.needsRun) {

            observer.emit('file:skip', { filepath, reason: 'unchanged' });

            return {
                filepath,
                checksum: checksum!,
                status: 'skipped',
                skipped: true,
                skipReason: 'unchanged',
            };
        }

        // Dry run check
        if (options.dryRun) {

            return {
                filepath,
                checksum: checksum!,
                status: 'success',
                skipped: false,
            };
        }

        observer.emit('file:before', {
            filepath,
            checksum: checksum!,
            configName: this.config.name
        });

        // Get file content (render if template)
        const [sql, sqlErr] = await attempt(() => this.getFileContent(filepath));

        if (sqlErr) {

            const durationMs = performance.now() - start;

            observer.emit('file:after', {
                filepath,
                status: 'failed',
                durationMs,
                error: sqlErr.message
            });

            return {
                filepath,
                checksum: checksum!,
                status: 'failed',
                skipped: false,
                error: sqlErr.message,
                durationMs,
            };
        }

        // Execute SQL
        const [, execErr] = await attempt(() => this.executeSql(sql!));

        const durationMs = performance.now() - start;
        const sizeBytes = await getFileSize(filepath);

        if (execErr) {

            // Record failure
            await this.tracker.recordExecution(
                filepath,
                checksum!,
                sizeBytes,
                this.identity,
                'failed',
                durationMs,
                execErr.message
            );

            observer.emit('file:after', {
                filepath,
                status: 'failed',
                durationMs,
                error: execErr.message
            });

            return {
                filepath,
                checksum: checksum!,
                status: 'failed',
                skipped: false,
                error: execErr.message,
                durationMs,
            };
        }

        // Record success
        await this.tracker.recordExecution(
            filepath,
            checksum!,
            sizeBytes,
            this.identity,
            'success',
            durationMs
        );

        observer.emit('file:after', {
            filepath,
            status: 'success',
            durationMs
        });

        return {
            filepath,
            checksum: checksum!,
            status: 'success',
            skipped: false,
            durationMs,
        };
    }

    /**
     * Get file content, rendering template if necessary.
     */
    private async getFileContent(filepath: string): Promise<string> {

        const engine = getTemplateEngine();

        return engine.processFile(filepath, {
            basePath: resolve(filepath, '..'),
            config: this.config,
            secrets: {}, // TODO: Get from state manager
        });
    }

    /**
     * Execute raw SQL against the database.
     */
    private async executeSql(sqlContent: string): Promise<void> {

        // Split by semicolons and execute each statement
        const statements = this.splitStatements(sqlContent);

        for (const statement of statements) {

            const trimmed = statement.trim();
            if (!trimmed || trimmed === '') continue;

            await sql.raw(trimmed).execute(this.db);
        }
    }

    /**
     * Split SQL content into individual statements.
     *
     * Handles basic cases but not all edge cases (e.g., semicolons in strings).
     * For complex SQL, use single-statement files.
     */
    private splitStatements(content: string): string[] {

        // Simple split - for more robust handling, users should use single-statement files
        return content.split(';').filter(s => s.trim().length > 0);
    }

    /**
     * Get all SQL files from a directory, sorted by name.
     */
    private async getSqlFiles(dirPath: string): Promise<string[]> {

        const entries = await readdir(dirPath, { withFileTypes: true });
        const files: string[] = [];

        for (const entry of entries) {

            const fullPath = join(dirPath, entry.name);

            if (entry.isDirectory()) {

                // Recurse into subdirectories
                const subFiles = await this.getSqlFiles(fullPath);
                files.push(...subFiles);
            }
            else if (this.isSqlFile(entry.name)) {

                files.push(fullPath);
            }
        }

        // Sort by filename for deterministic order
        return files.sort((a, b) => a.localeCompare(b));
    }

    /**
     * Check if a file is a SQL file.
     */
    private isSqlFile(filename: string): boolean {

        return filename.endsWith('.sql') || filename.endsWith('.sql.eta');
    }

    /**
     * Get the file tracker instance.
     */
    getTracker(): FileTracker {

        return this.tracker;
    }
}
```


## Public Exports

```typescript
// src/core/runner/index.ts

export { Runner } from './runner';
export { FileTracker } from './tracker';
export { computeChecksum, getFileSize } from './checksum';
export * from './types';
```


## Usage Examples

### Build Schema

```typescript
import { Runner } from './core/runner';
import { createConnection } from './core/connection';
import { getStateManager } from './core/state';

const state = await getStateManager();
const config = state.getActiveConfig();

if (!config) {

    throw new Error('No active config');
}

const conn = await createConnection(config.connection, config.name);
const runner = new Runner(conn.db, config);

// Ensure tracking table exists
await runner.getTracker().ensureTable();

// Build schema
const result = await runner.build();

console.log(`Build ${result.status}`);
console.log(`  Files run: ${result.filesRun}`);
console.log(`  Files skipped: ${result.filesSkipped}`);
console.log(`  Duration: ${result.durationMs}ms`);

await conn.destroy();
```

### Run Single File

```typescript
const result = await runner.runFile('changesets/2024-01-15_add_users/change/001_alter_users.sql');

if (result.status === 'failed') {

    console.error(`Failed: ${result.error}`);
}
```

### Run Directory

```typescript
const result = await runner.runDir('changesets/2024-01-15_add_users/change');

console.log(`Ran ${result.filesRun} files, skipped ${result.filesSkipped}`);
```

### Force Re-run

```typescript
// Force re-run even if unchanged
const result = await runner.build({ force: true });
```

### Dry Run

```typescript
// See what would run without executing
const result = await runner.build({ dryRun: true });

for (const file of result.results) {

    console.log(`Would run: ${file.filepath}`);
}
```


## Observer Events

| Event | When |
|-------|------|
| `build:start` | Beginning schema build |
| `build:complete` | Schema build finished |
| `run:file` | Single file execution started |
| `run:dir` | Directory execution started |
| `file:before` | About to execute a file |
| `file:after` | File execution completed |
| `file:skip` | File skipped (unchanged) |
| `error` | Any error during execution |


## Tracking Table Schema

```sql
CREATE TABLE __change_files__ (
    id SERIAL PRIMARY KEY,
    filepath VARCHAR(500) NOT NULL,          -- Relative or absolute path
    checksum VARCHAR(64) NOT NULL,           -- SHA-256 of content
    size_bytes INTEGER,                       -- File size
    executed_at TIMESTAMP DEFAULT NOW(),      -- When executed
    executed_by VARCHAR(255) NOT NULL,        -- Identity string
    identity_source VARCHAR(20),              -- 'git', 'system', 'config', 'env'
    config_name VARCHAR(100) NOT NULL,        -- Which config was used
    status VARCHAR(20) NOT NULL,              -- 'success' or 'failed'
    error_message TEXT,                       -- Error details if failed
    duration_ms INTEGER,                      -- Execution time
    UNIQUE(filepath, config_name)             -- One record per file per config
);
```


## File Execution Logic

```
┌──────────────────────────────────────────────────┐
│                  executeFile()                    │
└──────────────────────────┬───────────────────────┘
                           │
                           ▼
               ┌───────────────────────┐
               │  Compute checksum     │
               └───────────┬───────────┘
                           │
                           ▼
               ┌───────────────────────┐
               │  Check tracking DB    │
               │  needsRun()?          │
               └───────────┬───────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
     ┌─────────┐    ┌─────────────┐   ┌─────────┐
     │ new     │    │ changed     │   │ same    │
     │ file    │    │ checksum    │   │ checksum│
     └────┬────┘    └──────┬──────┘   └────┬────┘
          │                │               │
          ▼                ▼               ▼
     ┌────────────────────────┐      ┌─────────┐
     │      EXECUTE SQL       │      │  SKIP   │
     └───────────┬────────────┘      └────┬────┘
                 │                        │
                 ▼                        │
     ┌───────────────────────┐            │
     │  Record in tracking   │            │
     │  table                │            │
     └───────────┬───────────┘            │
                 │                        │
                 ▼                        ▼
     ┌─────────────────────────────────────────┐
     │              Return result               │
     └─────────────────────────────────────────┘
```


## Testing

```typescript
import { Runner, FileTracker } from './core/runner';
import { createConnection } from './core/connection';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { observer } from './core/observer';

describe('Runner', () => {

    let tempDir: string;
    let conn: ConnectionResult;
    let runner: Runner;

    const mockConfig = {
        name: 'test',
        type: 'local' as const,
        isTest: true,
        protected: false,
        connection: { dialect: 'sqlite' as const, database: ':memory:' },
        paths: { schema: '', changesets: '' },
    };

    beforeEach(async () => {

        tempDir = mkdtempSync(join(tmpdir(), 'noorm-runner-'));
        mockConfig.paths.schema = join(tempDir, 'schema');
        mkdirSync(mockConfig.paths.schema);

        conn = await createConnection(mockConfig.connection);
        runner = new Runner(conn.db, mockConfig);
        await runner.getTracker().ensureTable();
    });

    afterEach(async () => {

        await conn.destroy();
        rmSync(tempDir, { recursive: true });
    });

    it('should build schema from directory', async () => {

        writeFileSync(join(mockConfig.paths.schema, '001_create.sql'), 'CREATE TABLE test (id INTEGER);');
        writeFileSync(join(mockConfig.paths.schema, '002_insert.sql'), "INSERT INTO test VALUES (1);");

        const result = await runner.build();

        expect(result.status).toBe('success');
        expect(result.filesRun).toBe(2);
        expect(result.filesSkipped).toBe(0);
    });

    it('should skip unchanged files on second run', async () => {

        writeFileSync(join(mockConfig.paths.schema, '001_create.sql'), 'CREATE TABLE test (id INTEGER);');

        await runner.build();
        const result = await runner.build();

        expect(result.filesSkipped).toBe(1);
        expect(result.filesRun).toBe(0);
    });

    it('should re-run changed files', async () => {

        const filepath = join(mockConfig.paths.schema, '001_create.sql');
        writeFileSync(filepath, 'CREATE TABLE test (id INTEGER);');

        await runner.build();

        // Modify file
        writeFileSync(filepath, 'CREATE TABLE test2 (id INTEGER);');

        const result = await runner.build();

        expect(result.filesRun).toBe(1);
    });

    it('should force re-run all files', async () => {

        writeFileSync(join(mockConfig.paths.schema, '001_create.sql'), 'SELECT 1;');

        await runner.build();
        const result = await runner.build({ force: true });

        expect(result.filesRun).toBe(1);
        expect(result.filesSkipped).toBe(0);
    });

    it('should handle dry run', async () => {

        writeFileSync(join(mockConfig.paths.schema, '001_create.sql'), 'CREATE TABLE test (id INTEGER);');

        const result = await runner.build({ dryRun: true });

        expect(result.status).toBe('success');

        // Verify table wasn't actually created
        const [, err] = await attempt(() =>
            conn.db.selectFrom('test').selectAll().execute()
        );
        expect(err).toBeDefined();
    });

    it('should emit observer events', async () => {

        const events: string[] = [];
        const cleanup = observer.on(/^(build|file):/, ({ event }) => {
            events.push(event);
        });

        writeFileSync(join(mockConfig.paths.schema, '001.sql'), 'SELECT 1;');
        await runner.build();

        cleanup();

        expect(events).toContain('build:start');
        expect(events).toContain('file:before');
        expect(events).toContain('file:after');
        expect(events).toContain('build:complete');
    });

    it('should render .eta templates', async () => {

        writeFileSync(
            join(mockConfig.paths.schema, '001.sql.eta'),
            "INSERT INTO config (name) VALUES ('<%= it.config.name %>');"
        );

        // First create the table
        writeFileSync(
            join(mockConfig.paths.schema, '000_setup.sql'),
            'CREATE TABLE config (name TEXT);'
        );

        await runner.build();

        const result = await conn.db
            .selectFrom('config')
            .selectAll()
            .execute();

        expect(result[0].name).toBe('test');
    });
});
```


## Error Handling

| Error | Cause | Resolution |
|-------|-------|------------|
| `ENOENT` | File not found | Check path |
| `SQLITE_ERROR` | Invalid SQL | Fix SQL syntax |
| Template error | Eta rendering failed | Check template syntax |
| Permission error | Can't read file | Check file permissions |


## Best Practices

1. **Number files for ordering** - Use `001_`, `002_` prefixes for deterministic execution order
2. **One DDL per file** - Complex statements should be in separate files
3. **Use templates for dynamic content** - Seeds, environment-specific config
4. **Don't modify executed files** - If you need changes, create a new changeset
5. **Check tracking table** - Use `noorm run status` to see what's been executed
