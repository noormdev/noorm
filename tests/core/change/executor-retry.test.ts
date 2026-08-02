/**
 * Change executor retry tests.
 *
 * Verifies per-file skip on retry (CP1 of v1-17-change-retry): a change
 * that fails partway through can be fixed and retried without re-running
 * files that already succeeded. New file (not executor.test.ts) to avoid
 * a merge collision with tickets 08/34's parallel worktrees.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { Kysely, SqliteDialect } from 'kysely';
import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';

import { executeChange } from '../../../src/core/change/executor.js';
import { ChangeHistory } from '../../../src/core/change/history.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import { resetLockManager } from '../../../src/core/lock/index.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { Change, ChangeContext } from '../../../src/core/change/types.js';

describe('change: executor retry', () => {

    let db: Kysely<NoormDatabase>;
    let tempDir: string;
    let changesDir: string;
    let sqlDir: string;

    const testIdentity = { name: 'Test User', email: 'test@example.com', source: 'config' as const };

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
            access: { user: 'admin', agent: 'admin' },
            channel: 'user',
            dialect: 'sqlite',
        };

    }

    beforeEach(async () => {

        // Reset singleton lock manager between tests
        resetLockManager();

        // Create temp directory for test fixtures
        tempDir = await mkdtemp(join(tmpdir(), 'noorm-executor-retry-test-'));
        changesDir = join(tempDir, 'changes');
        sqlDir = join(tempDir, 'sql');

        await mkdir(changesDir, { recursive: true });
        await mkdir(sqlDir, { recursive: true });

        // Create in-memory SQLite database using Kysely directly
        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new BunSqliteDatabase(':memory:') as never,
            }),
        });

        // Bootstrap the noorm tracking tables
        await v1.up(db as Kysely<unknown>, 'sqlite');

    });

    afterEach(async () => {

        // Reset lock manager
        resetLockManager();

        // Clean up database connection
        await db.destroy();

        // Clean up temp directory
        await rm(tempDir, { recursive: true, force: true });

    });

    it('should execute only the fixed file on retry, leaving the succeeded file untouched', async () => {

        // File A always succeeds. File B has a syntactically invalid
        // statement (misspelled keyword) so it fails at parse time —
        // NOT a duplicate-CREATE-TABLE constraint violation, which is
        // documented as flaky in bun:sqlite on CI (see executor.test.ts).
        const change = await createTestChange('retry-fix-and-rerun', [
            { name: '001_a.sql', content: 'CREATE TABLE retry_test_a (id INTEGER PRIMARY KEY)' },
            { name: '002_b.sql', content: 'CREATE TALBE retry_test_b (id INTEGER PRIMARY KEY)' },
        ]);

        const context = buildContext();

        // First attempt: A succeeds, B fails with a syntax error
        const result1 = await executeChange(context, change);

        expect(result1.status).toBe('failed');
        expect(result1.files).toHaveLength(2);
        expect(result1.files[0]?.status).toBe('success');
        expect(result1.files[1]?.status).toBe('failed');

        // Fix B on disk
        const fileB = change.changeFiles[1]!;
        await writeFile(fileB.path, 'CREATE TABLE retry_test_b (id INTEGER PRIMARY KEY)');

        // Retry: only B should actually execute; A is skipped
        const result2 = await executeChange(context, change);

        expect(result2.status).toBe('success');
        expect(result2.files).toHaveLength(2);

        const fileA = change.changeFiles[0]!;
        const aResult = result2.files.find((f) => f.filepath === fileA.path);
        const bResult = result2.files.find((f) => f.filepath === fileB.path);

        expect(aResult?.status).toBe('skipped');
        expect(bResult?.status).toBe('success');

        // A's SQL was never re-submitted: exactly one success row for A
        // across both operations (op1: success, op2: skipped).
        const relA = relative(tempDir, fileA.path);
        const aExecutions = await db
            .selectFrom('__noorm_executions__')
            .selectAll()
            .where('filepath', '=', relA)
            .orderBy('id', 'asc')
            .execute();

        expect(aExecutions).toHaveLength(2);
        expect(aExecutions[0]?.status).toBe('success');
        expect(aExecutions[1]?.status).toBe('skipped');

        // Cross-check via ChangeHistory's own query surface
        const history = new ChangeHistory(db, 'test', 'sqlite');

        const op1Files = await history.getFileHistory(result1.operationId!);
        expect(op1Files.find((f) => f.filepath === relA)?.status).toBe('success');

        const op2Files = await history.getFileHistory(result2.operationId!);
        expect(op2Files.find((f) => f.filepath === relA)?.status).toBe('skipped');
        expect(op2Files.find((f) => f.filepath === relative(tempDir, fileB.path))?.status).toBe('success');

        const statuses = await history.getAllStatuses();
        expect(statuses.get('retry-fix-and-rerun')?.status).toBe('success');

    });

    it('should keep a succeeded file skipped across a THIRD attempt, not just a second', async () => {

        // File A always succeeds. File B fails on attempts 1 and 2 (syntax
        // error, not fixed yet), then is fixed before attempt 3. This
        // reproduces the third-attempt regression: needsRunFile must not
        // find attempt 2's `skipped` row for A (written by the per-file
        // skip path) and mistake it for a "never reached" skip that needs
        // re-running — A's real success is two operations back.
        const change = await createTestChange('retry-three-attempts', [
            { name: '001_a.sql', content: 'CREATE TABLE retry3_test_a (id INTEGER PRIMARY KEY)' },
            { name: '002_b.sql', content: 'CREATE TALBE retry3_test_b (id INTEGER PRIMARY KEY)' },
        ]);

        const context = buildContext();
        const fileB = change.changeFiles[1]!;

        // op1: A succeeds, B fails (syntax error)
        const result1 = await executeChange(context, change);
        expect(result1.status).toBe('failed');
        expect(result1.files[0]?.status).toBe('success');
        expect(result1.files[1]?.status).toBe('failed');

        // op2: retry with B still broken on disk — A must be skipped, B fails again
        const result2 = await executeChange(context, change);
        expect(result2.status).toBe('failed');
        expect(result2.files[0]?.status).toBe('skipped');
        expect(result2.files[1]?.status).toBe('failed');

        // Fix B on disk
        await writeFile(fileB.path, 'CREATE TABLE retry3_test_b (id INTEGER PRIMARY KEY)');

        // op3: retry — A must STILL be skipped (its success is two
        // operations back), B now succeeds
        const result3 = await executeChange(context, change);
        expect(result3.status).toBe('success');
        expect(result3.files[0]?.status).toBe('skipped');
        expect(result3.files[1]?.status).toBe('success');

        // A's SQL was submitted exactly once across all three attempts:
        // one success row, and every other row skipped. On the buggy
        // code, op3 re-runs A (finding op2's ambiguous `skipped` row),
        // producing a second success (or a failure) instead.
        const fileA = change.changeFiles[0]!;
        const relA = relative(tempDir, fileA.path);
        const aExecutions = await db
            .selectFrom('__noorm_executions__')
            .selectAll()
            .where('filepath', '=', relA)
            .orderBy('id', 'asc')
            .execute();

        expect(aExecutions).toHaveLength(3);
        expect(aExecutions.filter((e) => e.status === 'success')).toHaveLength(1);
        expect(aExecutions[0]?.status).toBe('success');
        expect(aExecutions[1]?.status).toBe('skipped');
        expect(aExecutions[2]?.status).toBe('skipped');

    });

    it('should re-run every file when force is true, bypassing per-file skip', async () => {

        // Idempotent statement — safe to execute twice without a
        // constraint violation, so the assertion doesn't depend on the
        // documented bun:sqlite error-propagation flakiness.
        const change = await createTestChange('retry-force', [
            { name: '001_idempotent.sql', content: 'CREATE TABLE IF NOT EXISTS retry_force_test (id INTEGER PRIMARY KEY)' },
        ]);

        const context = buildContext();

        // First run: succeeds, records a success row
        const result1 = await executeChange(context, change);
        expect(result1.status).toBe('success');
        expect(result1.files[0]?.status).toBe('success');

        // Second run without force: change-level needsRun already skips
        // the whole change (checksum unchanged, status success) before
        // executeFiles is even called
        const result2 = await executeChange(context, change);
        expect(result2.status).toBe('success');
        expect(result2.files).toHaveLength(0);

        // Third run with force: per-file skip must be bypassed even
        // though file A has a prior success record with a matching
        // checksum — force short-circuits needsRunFile before any DB
        // lookup, so the file actually re-runs (not 'skipped')
        const result3 = await executeChange(context, change, { force: true });
        expect(result3.files).toHaveLength(1);
        expect(result3.files[0]?.status).toBe('success');

    });

});
