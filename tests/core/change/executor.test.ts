/**
 * Change executor tests.
 *
 * Integration tests for change execution with real SQLite database.
 * Tests the full flow: create operation → execute files → finalize.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';

import { executeChange } from '../../../src/core/change/executor.js';
import { ChangeHistory } from '../../../src/core/change/history.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import { resetLockManager } from '../../../src/core/lock/index.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { Change, ChangeContext } from '../../../src/core/change/types.js';

describe('change: executor', () => {

    let db: Kysely<NoormDatabase>;
    let tempDir: string;
    let changesDir: string;
    let sqlDir: string;

    const testIdentity = { name: 'Test User', email: 'test@example.com' };

    /**
     * Create a test change on disk.
     */
    async function createTestChange(
        name: string,
        files: Array<{ name: string; content: string }>,
    ): Promise<Change> {

        const changePath = join(changesDir, name);
        const changeFilesDir = join(changePath, 'change');
        await mkdir(changeFilesDir, { recursive: true });

        const changeFiles = [];

        for (const file of files) {

            const filePath = join(changeFilesDir, file.name);
            await writeFile(filePath, file.content);

            changeFiles.push({
                filename: file.name,
                path: filePath,
                type: 'sql' as const,
            });

        }

        return {
            name,
            path: changePath,
            date: null,
            description: name,
            changeFiles,
            revertFiles: [],
            hasChangelog: false,
        };

    }

    /**
     * Build a test context.
     */
    function buildContext(): ChangeContext {

        return {
            db,
            configName: 'test',
            identity: testIdentity,
            projectRoot: tempDir,
            changesDir,
            sqlDir,
            dialect: 'sqlite',
        };

    }

    beforeEach(async () => {

        // Reset singleton lock manager between tests
        resetLockManager();

        // Create temp directory for test fixtures
        tempDir = await mkdtemp(join(tmpdir(), 'noorm-executor-test-'));
        changesDir = join(tempDir, 'changes');
        sqlDir = join(tempDir, 'sql');

        await mkdir(changesDir, { recursive: true });
        await mkdir(sqlDir, { recursive: true });

        // Create in-memory SQLite database using Kysely directly
        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new Database(':memory:'),
            }),
        });

        // Bootstrap the noorm tracking tables
        await v1.up(db);

    });

    afterEach(async () => {

        // Reset lock manager
        resetLockManager();

        // Clean up database connection
        await db.destroy();

        // Clean up temp directory
        await rm(tempDir, { recursive: true, force: true });

    });

    describe('executeChange', () => {

        it('should be able to insert and return id from database', async () => {

            // Test different insert approaches for SQLite
            const { sql } = await import('kysely');

            // Method 1: Insert + select last_insert_rowid
            await db
                .insertInto('__noorm_change__')
                .values({
                    name: 'test-returning',
                    change_type: 'change',
                    direction: 'change',
                    status: 'pending',
                    config_name: 'test',
                    executed_by: 'test@example.com',
                })
                .execute();

            const lastId = await sql<{ id: number }>`SELECT last_insert_rowid() as id`.execute(db);
            console.log('Last insert rowid:', lastId.rows[0]?.id);

            expect(lastId.rows[0]?.id).toBeTypeOf('number');
            expect(lastId.rows[0]?.id).toBeGreaterThan(0);

        });

        it('should execute all files and mark change as success', async () => {

            // Create a test change with valid SQL
            const change = await createTestChange('test-add-table', [
                { name: '001_create.sql', content: 'CREATE TABLE test_users (id INTEGER PRIMARY KEY)' },
                { name: '002_insert.sql', content: 'INSERT INTO test_users (id) VALUES (1)' },
            ]);

            const context = buildContext();

            // Execute the change
            const result = await executeChange(context, change);

            // Verify result
            expect(result.status).toBe('success');
            expect(result.name).toBe('test-add-table');
            expect(result.files).toHaveLength(2);
            expect(result.files[0]?.status).toBe('success');
            expect(result.files[1]?.status).toBe('success');
            expect(result.error).toBeUndefined();

            // Verify database record is marked as success
            const history = new ChangeHistory(db, 'test');
            const statuses = await history.getAllStatuses();
            const status = statuses.get('test-add-table');

            expect(status).toBeDefined();
            expect(status?.status).toBe('success');

        });

        it('should mark remaining files as skipped when one fails', async () => {

            // Create a test change where file 2 will fail
            const change = await createTestChange('test-with-failure', [
                { name: '001_valid.sql', content: 'CREATE TABLE test_table1 (id INTEGER PRIMARY KEY)' },
                { name: '002_invalid.sql', content: 'INVALID SQL SYNTAX HERE' },
                { name: '003_never_runs.sql', content: 'CREATE TABLE test_table2 (id INTEGER PRIMARY KEY)' },
            ]);

            const context = buildContext();

            // Execute the change
            const result = await executeChange(context, change);

            // Verify overall result is failed
            expect(result.status).toBe('failed');
            expect(result.error).toBeDefined();

            // Verify file statuses in result (only processed files are returned)
            expect(result.files[0]?.status).toBe('success');
            expect(result.files[1]?.status).toBe('failed');

            // Verify database records
            const history = new ChangeHistory(db, 'test');
            const statuses = await history.getAllStatuses();
            const status = statuses.get('test-with-failure');

            expect(status).toBeDefined();
            expect(status?.status).toBe('failed');
            expect(status?.errorMessage).toBeDefined();

            // Verify skipped files in database
            const executions = await db
                .selectFrom('__noorm_executions__')
                .selectAll()
                .where('change_id', '=', result.operationId!)
                .orderBy('filepath')
                .execute();

            expect(executions).toHaveLength(3);
            expect(executions[0]?.status).toBe('success');
            expect(executions[1]?.status).toBe('failed');
            expect(executions[2]?.status).toBe('skipped');
            expect(executions[2]?.skip_reason).toBeDefined();

        });

        it('should skip already-applied change unless force is true', async () => {

            // Create and execute a change
            const change = await createTestChange('test-idempotent', [
                { name: '001_create.sql', content: 'CREATE TABLE idempotent_test (id INTEGER PRIMARY KEY)' },
            ]);

            const context = buildContext();

            // First execution
            const result1 = await executeChange(context, change);
            expect(result1.status).toBe('success');

            // Second execution without force - should skip
            const result2 = await executeChange(context, change);
            expect(result2.status).toBe('success');
            expect(result2.files).toHaveLength(0); // No files executed

            // Third execution with force - should re-run
            const result3 = await executeChange(context, change, { force: true });
            // Note: This will fail because table already exists, which is expected
            // The important thing is that it actually tried to run
            expect(result3.files.length).toBeGreaterThan(0);

        });

        it('should record error message in database when change fails', async () => {

            // Create a change that will fail with a specific error
            const change = await createTestChange('test-error-recording', [
                { name: '001_fail.sql', content: 'SELECT * FROM nonexistent_table_xyz' },
            ]);

            const context = buildContext();

            // Execute the change
            const result = await executeChange(context, change);

            expect(result.status).toBe('failed');

            // Verify error is recorded in database
            const history = new ChangeHistory(db, 'test');
            const statuses = await history.getAllStatuses();
            const status = statuses.get('test-error-recording');

            expect(status?.status).toBe('failed');
            expect(status?.errorMessage).toContain('001_fail.sql');

        });

        it('should allow querying history after execution', async () => {

            // Create and execute multiple changes
            const change1 = await createTestChange('change-001', [
                { name: '001.sql', content: 'CREATE TABLE history_test1 (id INTEGER)' },
            ]);

            const change2 = await createTestChange('change-002', [
                { name: '001.sql', content: 'CREATE TABLE history_test2 (id INTEGER)' },
            ]);

            const context = buildContext();

            await executeChange(context, change1);
            await executeChange(context, change2);

            // Query history
            const history = new ChangeHistory(db, 'test');
            const statuses = await history.getAllStatuses();

            expect(statuses.size).toBe(2);
            expect(statuses.has('change-001')).toBe(true);
            expect(statuses.has('change-002')).toBe(true);

        });

        it('should emit events during execution', async () => {

            // Import observer to track events
            const { observer } = await import('../../../src/core/observer.js');

            const events: string[] = [];

            const unsubStart = observer.on('change:start', () => events.push('start'));
            const unsubFile = observer.on('change:file', () => events.push('file'));
            const unsubComplete = observer.on('change:complete', () => events.push('complete'));

            const change = await createTestChange('test-events', [
                { name: '001.sql', content: 'CREATE TABLE events_test (id INTEGER)' },
            ]);

            const context = buildContext();
            await executeChange(context, change);

            // Clean up listeners
            unsubStart();
            unsubFile();
            unsubComplete();

            // Verify events were emitted in order
            expect(events).toContain('start');
            expect(events).toContain('file');
            expect(events).toContain('complete');
            expect(events.indexOf('start')).toBeLessThan(events.indexOf('complete'));

        });

    });

});
