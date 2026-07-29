/**
 * Reported-count fidelity.
 *
 * `rowsTransferred` counted every insert that did not throw. `ON CONFLICT DO
 * NOTHING` does not throw when it writes nothing, so a transfer into a
 * destination that already held the data reported the full row count with
 * zero skipped — indistinguishable from a transfer that did the work.
 *
 * Every assertion here cross-checks the destination. Uses dedicated tables so
 * it does not race the shared fixture schema.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { sql } from 'kysely';

import type { Kysely } from 'kysely';

import { transferData } from '../../../src/core/transfer/index.js';
import {
    createTestConnection,
    skipIfNoContainer,
    makeTestConfig,
    TEST_CONNECTIONS,
} from '../../utils/db.js';
import { createConnection } from '../../../src/core/connection/factory.js';

const ROWS = 6;

describe('transfer: reported counts', () => {

    let sourceDb: Kysely<unknown>;
    let destDb: Kysely<unknown>;
    let sourceDestroy: () => Promise<void>;
    let destDestroy: () => Promise<void>;

    const sourceConfig = makeTestConfig('counts_source', { ...TEST_CONNECTIONS.postgres });
    const destConfig = makeTestConfig('counts_dest', {
        ...TEST_CONNECTIONS.postgres,
        database: process.env['TEST_POSTGRES_DATABASE_DEST'] ?? 'noorm_test_dest',
    });

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        const conn = await createTestConnection('postgres');
        sourceDb = conn.db;
        sourceDestroy = conn.destroy;

        const destConn = await createConnection(destConfig.connection, 'counts_dest');
        destDb = destConn.db;
        destDestroy = destConn.destroy;

        for (const db of [sourceDb, destDb]) {

            await sql.raw('DROP TABLE IF EXISTS countcheck').execute(db);
            await sql.raw('CREATE TABLE countcheck (id int PRIMARY KEY, label text NOT NULL)').execute(db);

        }

    });

    afterAll(async () => {

        for (const db of [sourceDb, destDb]) {

            if (!db) continue;

            await sql.raw('DROP TABLE IF EXISTS countcheck').execute(db).catch(() => undefined);

        }

        if (destDestroy) await destDestroy();
        if (sourceDestroy) await sourceDestroy();

    });

    beforeEach(async () => {

        const values = Array.from({ length: ROWS }, (_, i) => `(${i + 1}, 'row-${i + 1}')`).join(', ');

        await sql.raw('TRUNCATE TABLE countcheck').execute(sourceDb);
        await sql.raw('TRUNCATE TABLE countcheck').execute(destDb);
        await sql.raw(`INSERT INTO countcheck (id, label) VALUES ${values}`).execute(sourceDb);

    });

    /**
     * Pull the result for the table under test out of a transfer result.
     */
    async function transferCountcheck(onConflict: 'skip' | 'update') {

        const [result, err] = await transferData(sourceConfig, destConfig, {
            tables: ['countcheck'],
            onConflict,
        });

        expect(err).toBeNull();

        return result!.tables.find((t) => t.table === 'countcheck')!;

    }

    it('should report skipped rows as skipped, not transferred', async () => {

        // Destination already holds every row, so the transfer writes nothing.
        const values = Array.from({ length: ROWS }, (_, i) => `(${i + 1}, 'row-${i + 1}')`).join(', ');
        await sql.raw(`INSERT INTO countcheck (id, label) VALUES ${values}`).execute(destDb);

        const table = await transferCountcheck('skip');

        expect(table.rowsTransferred).toBe(0);
        expect(table.rowsSkipped).toBe(ROWS);

    });

    it('should report a partially populated destination accurately', async () => {

        await sql.raw('INSERT INTO countcheck (id, label) VALUES (1, \'row-1\'), (2, \'row-2\')').execute(destDb);

        const table = await transferCountcheck('skip');

        expect(table.rowsTransferred).toBe(ROWS - 2);
        expect(table.rowsSkipped).toBe(2);

        const landed = await sql<{ count: string }>`SELECT COUNT(*) as count FROM countcheck`.execute(destDb);

        expect(parseInt(landed.rows[0]!.count, 10)).toBe(ROWS);

    });

    it('should report every row transferred into an empty destination', async () => {

        const table = await transferCountcheck('skip');

        expect(table.rowsTransferred).toBe(ROWS);
        expect(table.rowsSkipped).toBe(0);

        const landed = await sql<{ count: string }>`SELECT COUNT(*) as count FROM countcheck`.execute(destDb);

        expect(parseInt(landed.rows[0]!.count, 10)).toBe(ROWS);

    });

    it('should count rewritten rows under onConflict update', async () => {

        const values = Array.from({ length: ROWS }, (_, i) => `(${i + 1}, 'stale')`).join(', ');
        await sql.raw(`INSERT INTO countcheck (id, label) VALUES ${values}`).execute(destDb);

        const table = await transferCountcheck('update');

        expect(table.rowsTransferred).toBe(ROWS);

        const stale = await sql<{ count: string }>`
            SELECT COUNT(*) as count FROM countcheck WHERE label = 'stale'
        `.execute(destDb);

        expect(parseInt(stale.rows[0]!.count, 10)).toBe(0);

    });

});
