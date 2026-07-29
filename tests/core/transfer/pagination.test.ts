/**
 * Pagination stability tests.
 *
 * Export and db-to-db transfer both paged with `LIMIT/OFFSET` and no
 * `ORDER BY`. No engine guarantees row order across two such statements, so a
 * write to the source between pages shifted the window and rows were silently
 * dropped and duplicated — while the operation reported the full row count.
 *
 * These tests therefore assert **set equality against what actually landed**,
 * never counts: every bug in this area preserved the count exactly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { sql } from 'kysely';

import type { Kysely } from 'kysely';

import { exportTable } from '../../../src/core/dt/index.js';
import { DtReader } from '../../../src/core/dt/reader.js';
import { transferData } from '../../../src/core/transfer/index.js';
import {
    createTestConnection,
    skipIfNoContainer,
    makeTestConfig,
    TEST_CONNECTIONS,
} from '../../utils/db.js';
import { createConnection } from '../../../src/core/connection/factory.js';

const TMP_DIR = path.join(process.cwd(), 'tmp');
const ROW_COUNT = 4000;
const BATCH_SIZE = 100;

/** Wide-ish payload so an UPDATE relocates the tuple instead of updating in place. */
const PAYLOAD = 'x'.repeat(300);

/**
 * Rewrite large contiguous blocks of the table until `stop()` is called.
 *
 * This is the condition the old pager corrupted under: rows move in the heap,
 * so the next OFFSET window no longer lines up with the previous one.
 */
function startChurn(db: Kysely<unknown>, table: string): { stop: () => Promise<void> } {

    let running = true;

    const loop = (async () => {

        while (running) {

            const from = Math.floor(Math.random() * ROW_COUNT) + 1;
            const to = Math.min(from + 800, ROW_COUNT);

            // Errors are ignored on purpose: the churn is the test's weather,
            // not its subject. A lock timeout or a deadlock victim on a busy
            // server should not fail the assertion about row identity.
            await sql
                .raw(`UPDATE ${table} SET payload = payload || 'y' WHERE id BETWEEN ${from} AND ${to}`)
                .execute(db)
                .catch(() => undefined);

            // Yield between statements so the loop perturbs the read without
            // saturating a database this suite may be sharing.
            await new Promise((resolve) => setTimeout(resolve, 2));

        }

    })();

    return {
        async stop() {

            running = false;
            await loop;

        },
    };

}

describe('transfer: pagination under concurrent writes', () => {

    let sourceDb: Kysely<unknown>;
    let destDb: Kysely<unknown>;
    let churnDb: Kysely<unknown>;
    let sourceDestroy: () => Promise<void>;
    let destDestroy: () => Promise<void>;
    let churnDestroy: () => Promise<void>;
    let testDir: string;

    const sourceConfig = makeTestConfig('pagination_source', { ...TEST_CONNECTIONS.postgres });
    const destConfig = makeTestConfig('pagination_dest', {
        ...TEST_CONNECTIONS.postgres,
        database: process.env['TEST_POSTGRES_DATABASE_DEST'] ?? 'noorm_test_dest',
    });

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        const conn = await createTestConnection('postgres');
        sourceDb = conn.db;
        sourceDestroy = conn.destroy;

        // A separate connection so the churn genuinely runs alongside the
        // read, not behind it in the same pool slot.
        const churnConn = await createConnection(TEST_CONNECTIONS.postgres, 'pagination_churn');
        churnDb = churnConn.db;
        churnDestroy = churnConn.destroy;

        const destConn = await createConnection(destConfig.connection, 'pagination_dest');
        destDb = destConn.db;
        destDestroy = destConn.destroy;

        for (const db of [sourceDb, destDb]) {

            await sql.raw('DROP TABLE IF EXISTS pagerace').execute(db);
            await sql.raw('DROP TABLE IF EXISTS pagerace_nopk').execute(db);
            await sql.raw('CREATE TABLE pagerace (id int PRIMARY KEY, payload text NOT NULL)').execute(db);
            await sql.raw('CREATE TABLE pagerace_nopk (id int NOT NULL, payload text NOT NULL)').execute(db);

        }

        const values = Array.from(
            { length: ROW_COUNT },
            (_, i) => `(${i + 1}, '${PAYLOAD}')`,
        ).join(', ');

        await sql.raw(`INSERT INTO pagerace (id, payload) VALUES ${values}`).execute(sourceDb);
        await sql.raw(`INSERT INTO pagerace_nopk (id, payload) VALUES ${values}`).execute(sourceDb);

        testDir = path.join(TMP_DIR, `test-pagination-${randomBytes(4).toString('hex')}`);
        mkdirSync(testDir, { recursive: true });

    });

    afterAll(async () => {

        if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });

        for (const db of [sourceDb, destDb]) {

            if (!db) continue;

            await sql.raw('DROP TABLE IF EXISTS pagerace').execute(db).catch(() => undefined);
            await sql.raw('DROP TABLE IF EXISTS pagerace_nopk').execute(db).catch(() => undefined);

        }

        if (churnDestroy) await churnDestroy();
        if (destDestroy) await destDestroy();
        if (sourceDestroy) await sourceDestroy();

    });

    /**
     * Collect the `id` of every row written to a .dt file.
     */
    async function readExportedIds(filepath: string): Promise<number[]> {

        const reader = new DtReader({ filepath });
        await reader.open();

        const columns = reader.schema!.columns.map((c) => c.name);
        const idIndex = columns.indexOf('id');
        const ids: number[] = [];

        for await (const values of reader.rows()) {

            ids.push(Number(values[idIndex]));

        }

        reader.close();

        return ids;

    }

    it('should export every row exactly once while the source is being rewritten', async () => {

        const filepath = path.join(testDir, 'pagerace.dt');
        const churn = startChurn(churnDb, 'pagerace');

        const [result, err] = await exportTable({
            db: sourceDb,
            dialect: 'postgres',
            tableName: 'pagerace',
            filepath,
            batchSize: BATCH_SIZE,
        });

        await churn.stop();

        expect(err).toBeNull();

        const ids = await readExportedIds(filepath);
        const unique = new Set(ids);

        // Not `ids.length === ROW_COUNT`: the broken pager produced exactly
        // that while missing thousands of ids and repeating thousands more.
        expect(unique.size).toBe(ROW_COUNT);
        expect(ids.length).toBe(ROW_COUNT);
        expect(Math.min(...ids)).toBe(1);
        expect(Math.max(...ids)).toBe(ROW_COUNT);
        expect(result!.rowsWritten).toBe(ROW_COUNT);

    }, 120_000);

    it('should export a table with no primary key without dropping rows', async () => {

        const filepath = path.join(testDir, 'pagerace_nopk.dt');
        const churn = startChurn(churnDb, 'pagerace_nopk');

        const [, err] = await exportTable({
            db: sourceDb,
            dialect: 'postgres',
            tableName: 'pagerace_nopk',
            filepath,
            batchSize: BATCH_SIZE,
        });

        await churn.stop();

        expect(err).toBeNull();

        const ids = await readExportedIds(filepath);

        expect(new Set(ids).size).toBe(ROW_COUNT);
        expect(ids.length).toBe(ROW_COUNT);

    }, 120_000);

    it('should transfer every row exactly once while the source is being rewritten', async () => {

        await sql.raw('TRUNCATE TABLE pagerace').execute(destDb);

        const churn = startChurn(churnDb, 'pagerace');

        const [result, err] = await transferData(sourceConfig, destConfig, {
            tables: ['pagerace'],
            batchSize: BATCH_SIZE,
            onConflict: 'skip',
        });

        await churn.stop();

        expect(err).toBeNull();
        expect(result!.status).toBe('success');

        // The destination is the only honest witness — `rowsTransferred`
        // reported 50000 on a run that landed 30882 rows.
        const landed = await sql<{ count: string }>`SELECT COUNT(*) as count FROM pagerace`.execute(destDb);

        expect(parseInt(landed.rows[0]!.count, 10)).toBe(ROW_COUNT);

        const distinct = await sql<{ count: string }>`
            SELECT COUNT(DISTINCT id) as count FROM pagerace
        `.execute(destDb);

        expect(parseInt(distinct.rows[0]!.count, 10)).toBe(ROW_COUNT);

    }, 120_000);

});
