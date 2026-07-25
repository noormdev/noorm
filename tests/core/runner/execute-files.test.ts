/**
 * executeFiles / runBuild / runFiles guards (v1/49-54 CP9).
 *
 * An RCA ruled out any mechanism that could actually double-execute a file
 * (kysely, tedious, discovery, the sequential loop). These tests instead
 * pin the invariants that make a recurrence self-diagnosing: discovery
 * uniqueness is enforced, not assumed, and each discovered file produces
 * exactly one result. Runs against a real in-memory SQLite database so the
 * duplicate guard is proven to fire before any SQL executes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';

import { runBuild, runFiles } from '../../../src/core/runner/runner.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { RunContext } from '../../../src/core/runner/types.js';

describe('runner: executeFiles — duplicate and exactly-once guards', () => {

    let db: Kysely<NoormDatabase>;
    let tempDir: string;
    let sqlDir: string;

    function buildContext(): RunContext {

        return {
            db,
            configName: 'test',
            identity: { name: 'Test User', email: 'test@example.com', source: 'config' },
            projectRoot: tempDir,
            access: { user: 'admin', mcp: 'admin' },
            channel: 'user',
            dialect: 'sqlite',
        };

    }

    beforeEach(async () => {

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-runner-cp9-test-'));
        sqlDir = join(tempDir, 'sql');
        await mkdir(sqlDir, { recursive: true });

        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new BunSqliteDatabase(':memory:') as never,
            }),
        });

        await v1.up(db as Kysely<unknown>, 'sqlite');

    });

    afterEach(async () => {

        await db.destroy();
        await rm(tempDir, { recursive: true, force: true });

    });

    it('should fail loudly instead of running a duplicated file twice', async () => {

        const filePath = join(sqlDir, '001_dup.sql');
        await writeFile(filePath, 'CREATE TABLE cp9_dup_test (id INTEGER PRIMARY KEY);\n', 'utf-8');

        const result = await runFiles(buildContext(), [filePath, filePath]);

        expect(result.status).toBe('failed');
        expect(result.error).toContain('Duplicate');
        expect(result.error).toContain('001_dup.sql');
        expect(result.filesRun).toBe(0);

        // The duplicate must be rejected before any SQL runs, not merely
        // reported after the fact.
        const tableCheck = await sql<{ name: string }>`
            SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cp9_dup_test'
        `.execute(db);
        expect(tableCheck.rows).toHaveLength(0);

    });

    it('should execute each discovered file exactly once', async () => {

        await writeFile(
            join(sqlDir, '001_a.sql'),
            'CREATE TABLE cp9_once_a (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );
        await writeFile(
            join(sqlDir, '002_b.sql'),
            'CREATE TABLE cp9_once_b (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );

        const result = await runBuild(buildContext(), sqlDir);

        expect(result.status).toBe('success');
        expect(result.filesRun).toBe(2);
        expect(result.files).toHaveLength(2);

        const filepaths = result.files.map((f) => f.filepath);
        expect(new Set(filepaths).size).toBe(filepaths.length);

    });

});
