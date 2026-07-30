/**
 * Integration tests for Postgres whole-change transactional rollback
 * (CP2 of v1-17-change-retry).
 *
 * Requires a live Postgres (CI group 4 / docker-compose.yml, port 15432).
 * Verifies that a change that fails mid-execution on Postgres leaves no
 * partial state: neither the DDL nor the operation/file history rows
 * persist, and a retry reruns the whole change fresh.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type Kysely } from 'kysely';
import { attempt } from '@logosdx/utils';

import { executeChange } from '../../../src/core/change/executor.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import { v2 } from '../../../src/core/version/schema/migrations/v2.js';
import { resetLockManager } from '../../../src/core/lock/index.js';
import { createTestConnection, skipIfNoContainer } from '../../utils/db.js';
import { noormDb, getNoormTables } from '../../../src/core/shared/index.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { Change, ChangeContext } from '../../../src/core/change/types.js';

/**
 * Reset noorm tracking state to a clean slate on Postgres.
 *
 * Drops the `noorm` schema (created by v2) and any leftover v1-era
 * `__noorm_*__` public tables, so a shared CI database can't carry state
 * between runs. Ordered schema-first: v2 moves the public tables into
 * `noorm`, so a prior run leaves them there, not in public.
 */
async function resetNoormState(db: Kysely<unknown>): Promise<void> {

    await attempt(() => sql`DROP SCHEMA IF EXISTS noorm CASCADE`.execute(db));

    for (const table of [
        '__noorm_vault__',
        '__noorm_identities__',
        '__noorm_lock__',
        '__noorm_executions__',
        '__noorm_change__',
        '__noorm_version__',
    ]) {

        await attempt(() => sql`${sql.raw(`DROP TABLE IF EXISTS ${table}`)}`.execute(db));

    }

}

describe('integration: postgres change transaction', () => {

    let db: Kysely<NoormDatabase>;
    let ndb: Kysely<NoormDatabase>;
    let destroy: () => Promise<void>;
    let tempDir: string;
    let changesDir: string;
    let sqlDir: string;

    // Clean schema-qualified table names (postgres) used with noormDb's
    // withSchema('noorm') — mirrors how production ChangeHistory queries.
    const tables = getNoormTables('postgres');

    const testIdentity = { name: 'Test User', email: 'test@example.com', source: 'config' as const };

    /**
     * Create a test change on disk.
     *
     * Mirrors tests/core/change/executor-retry.test.ts's createTestChange,
     * with a live Postgres connection wired through buildContext below
     * instead of in-memory SQLite.
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
     * Build a test context wired to the live Postgres connection.
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
            dialect: 'postgres',
        };

    }

    /**
     * Whether a table exists in the public schema.
     *
     * Uses `to_regclass` rather than information_schema so a rolled-back
     * CREATE TABLE (never committed) reliably reports absent. Change SQL
     * runs against the connection's default search_path (public), not the
     * noorm schema, so user tables land in public.
     */
    async function tableExists(tableName: string): Promise<boolean> {

        const { rows } = await sql<{ reg: string | null }>`SELECT to_regclass(${`public.${tableName}`}) AS reg`.execute(db);

        return rows[0]?.reg != null;

    }

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        const conn = await createTestConnection('postgres');
        db = conn.db as Kysely<NoormDatabase>;
        ndb = noormDb(db, 'postgres');
        destroy = conn.destroy;

        // Bootstrap the noorm tracking tables. On postgres the lock manager
        // and ChangeHistory resolve to the `noorm` schema (noormDb ->
        // withSchema('noorm')), which only exists after v2 creates it and
        // moves the v1 tables into it — v1 alone leaves them in public as
        // `__noorm_*__` and every noorm.* reference 42P01s.
        await resetNoormState(db as Kysely<unknown>);
        await v1.up(db as Kysely<unknown>, 'postgres');
        await v2.up(db as Kysely<unknown>, 'postgres');

    }, 30_000);

    afterAll(async () => {

        if (destroy) {

            await resetNoormState(db as Kysely<unknown>).catch(() => {});
            await destroy();

        }

    });

    beforeEach(async () => {

        resetLockManager();

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-pg-txn-test-'));
        changesDir = join(tempDir, 'changes');
        sqlDir = join(tempDir, 'sql');

        await mkdir(changesDir, { recursive: true });
        await mkdir(sqlDir, { recursive: true });

    });

    afterEach(async () => {

        resetLockManager();

        await rm(tempDir, { recursive: true, force: true });

    });

    it('failed change leaves no trace', async () => {

        // Unique per-run so this test is self-isolating against a shared
        // CI database — no cross-run table name collisions.
        const token = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        const tableA = `pg_txn_test_a_${token}`;
        const changeName = `pg-txn-fail-${token}`;

        const change = await createTestChange(changeName, [
            { name: '001_a.sql', content: `CREATE TABLE ${tableA} (id INTEGER PRIMARY KEY)` },
            { name: '002_b.sql', content: 'CREATE TALBE this_is_a_syntax_error (id INTEGER PRIMARY KEY)' },
        ]);

        const context = buildContext();

        const result = await executeChange(context, change);

        expect(result.status).toBe('failed');
        expect(result.operationId).toBeUndefined();

        // File A's CREATE TABLE never committed — rolled back with the
        // rest of the transaction.
        expect(await tableExists(tableA)).toBe(false);

        // No operation or file history rows persist for this change.
        const changeRows = await ndb
            .selectFrom(tables.change)
            .selectAll()
            .where('name', '=', changeName)
            .execute();

        expect(changeRows).toHaveLength(0);

        const execRows = await sql<{ n: number }>`
            SELECT COUNT(*)::int AS n
            FROM noorm."executions" e
            JOIN noorm."change" c ON c.id = e.change_id
            WHERE c.name = ${changeName}
        `.execute(db);

        expect(execRows.rows[0]?.n).toBe(0);

    });

    it('retry after rollback runs the whole change fresh', async () => {

        const token = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        const tableA = `pg_txn_test_a2_${token}`;
        const tableB = `pg_txn_test_b2_${token}`;
        const changeName = `pg-txn-retry-${token}`;

        const change = await createTestChange(changeName, [
            { name: '001_a.sql', content: `CREATE TABLE ${tableA} (id INTEGER PRIMARY KEY)` },
            { name: '002_b.sql', content: 'CREATE TALBE this_is_a_syntax_error (id INTEGER PRIMARY KEY)' },
        ]);

        const context = buildContext();

        const failedResult = await executeChange(context, change);
        expect(failedResult.status).toBe('failed');

        // Fix B on disk — nothing from the failed attempt persisted, so
        // the retry below reruns the whole change (including A), not
        // just B.
        const fileB = change.changeFiles[1]!;
        await writeFile(fileB.path, `CREATE TABLE ${tableB} (id INTEGER PRIMARY KEY)`);

        const retryResult = await executeChange(context, change);

        expect(retryResult.status).toBe('success');
        expect(await tableExists(tableA)).toBe(true);
        expect(await tableExists(tableB)).toBe(true);

        const changeRows = await ndb
            .selectFrom(tables.change)
            .selectAll()
            .where('name', '=', changeName)
            .where('status', '=', 'success')
            .execute();

        expect(changeRows).toHaveLength(1);

        await attempt(() => sql`${sql.raw(`DROP TABLE IF EXISTS ${tableA}`)}`.execute(db));
        await attempt(() => sql`${sql.raw(`DROP TABLE IF EXISTS ${tableB}`)}`.execute(db));

    });

});
