/**
 * Transfer executor unit tests.
 *
 * Tests executor behavior: same-server vs cross-server paths,
 * identity handling, batch processing, conflict strategies.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'kysely';

import type { Kysely } from 'kysely';

import { transferData } from '../../../src/core/transfer/index.js';
import {
    createTestConnection,
    deployTestSchema,
    seedTestData,
    resetTestData,
    teardownTestSchema,
    skipIfNoContainer,
    makeTestConfig,
    TEST_CONNECTIONS,
} from '../../utils/db.js';
import { createConnection } from '../../../src/core/connection/factory.js';

/**
 * Create Config objects for source and destination.
 */
function makeConfigs() {

    const sourceConfig = makeTestConfig('executor_source', { ...TEST_CONNECTIONS.postgres });

    const destConfig = makeTestConfig('executor_dest', {
        ...TEST_CONNECTIONS.postgres,
        database: process.env['TEST_POSTGRES_DATABASE_DEST'] ?? 'noorm_test_dest',
    });

    return { sourceConfig, destConfig };

}

describe('transfer: executor', () => {

    let sourceDb: Kysely<unknown>;
    let destDb: Kysely<unknown>;
    let sourceDestroy: () => Promise<void>;
    let destDestroy: () => Promise<void>;

    const { sourceConfig, destConfig } = makeConfigs();

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        // Connect to source
        const conn = await createTestConnection('postgres');
        sourceDb = conn.db;
        sourceDestroy = conn.destroy;

        // Connect to postgres system database to create destination if needed
        const destDbName = destConfig.connection.database;
        const systemConn = await createConnection({
            ...TEST_CONNECTIONS.postgres,
            database: 'postgres',
        }, 'system');

        const dbCheck = await sql<{ exists: boolean }>`
            SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${destDbName}) as exists
        `.execute(systemConn.db);

        if (!dbCheck.rows[0]?.exists) {

            await sql.raw(`CREATE DATABASE "${destDbName}"`).execute(systemConn.db);

        }

        await systemConn.destroy();

        // Connect to destination
        const destConn = await createConnection(destConfig.connection, 'executor_dest');
        destDb = destConn.db;
        destDestroy = destConn.destroy;

        // Deploy schema
        await teardownTestSchema(sourceDb, 'postgres');
        await deployTestSchema(sourceDb, 'postgres');

        await teardownTestSchema(destDb, 'postgres');
        await deployTestSchema(destDb, 'postgres');

    });

    afterAll(async () => {

        if (destDestroy) await destDestroy();
        if (sourceDestroy) await sourceDestroy();

    });

    beforeEach(async () => {

        await resetTestData(sourceDb, 'postgres');
        await seedTestData(sourceDb, 'postgres');
        await resetTestData(destDb, 'postgres');

    });

    describe('cross-server path', () => {

        it('should batch rows correctly', async () => {

            // Add more rows to test batching
            for (let i = 10; i <= 20; i++) {

                const uuid = `00000000-0000-0000-0000-0000000000${i.toString().padStart(2, '0')}`;
                await sql.raw(`
                    INSERT INTO users (id, email, username, password_hash, display_name)
                    VALUES ('${uuid}', 'batch${i}@test.com', 'batch${i}', 'hash${i}', 'Batch User ${i}')
                `).execute(sourceDb);

            }

            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users'],
                batchSize: 5, // Small batch size to test batching
            });

            expect(err).toBeNull();
            expect(result!.status).toBe('success');

            // All rows should be transferred
            const destCount = await sql<{ count: string }>`SELECT COUNT(*) as count FROM users`.execute(destDb);
            const sourceCount = await sql<{ count: string }>`SELECT COUNT(*) as count FROM users`.execute(sourceDb);

            expect(parseInt(destCount.rows[0]!.count, 10)).toBe(parseInt(sourceCount.rows[0]!.count, 10));

        });

        it('should track progress accurately', async () => {

            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users', 'todo_lists', 'todo_items'],
            });

            expect(err).toBeNull();
            expect(result!.tables.length).toBe(3);

            // Each table should have result info
            for (const tableResult of result!.tables) {

                expect(tableResult.status).toBe('success');
                expect(typeof tableResult.rowsTransferred).toBe('number');
                expect(typeof tableResult.durationMs).toBe('number');

            }

            // Total rows should match sum of table results
            const totalFromTables = result!.tables.reduce((sum, t) => sum + t.rowsTransferred, 0);
            expect(result!.totalRows).toBe(totalFromTables);

        });

    });

    describe('conflict strategies', () => {

        it('should fail on conflict with onConflict: fail (default)', async () => {

            // First transfer
            const [firstResult, firstErr] = await transferData(sourceConfig, destConfig, {
                tables: ['users'],
            });

            expect(firstErr).toBeNull();
            expect(firstResult!.status).toBe('success');

            // Verify destination has data
            const destCount = await sql<{ count: string }>`SELECT COUNT(*) as count FROM users`.execute(destDb);
            expect(parseInt(destCount.rows[0]!.count, 10)).toBe(3);

            // Second transfer should fail on conflict
            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users'],
                onConflict: 'fail',
            });

            // Should fail due to duplicate key
            // If no error, check result has failures
            if (err === null) {

                // Result might show partial or failed status
                expect(result!.status).not.toBe('success');

            }
            else {

                expect(err.message).toMatch(/duplicate|unique|primary/i);

            }

        });

        it('should skip duplicates with onConflict: skip', async () => {

            // First transfer
            await transferData(sourceConfig, destConfig, {
                tables: ['users'],
            });

            // Add a new user to source
            await sql.raw(`
                INSERT INTO users (id, email, username, password_hash, display_name)
                VALUES ('99999999-9999-9999-9999-999999999999', 'new@test.com', 'newuser', 'hash', 'New User')
            `).execute(sourceDb);

            // Second transfer with skip
            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users'],
                onConflict: 'skip',
            });

            expect(err).toBeNull();
            expect(result!.status).toBe('success');

            // Destination should now have the new user
            const destCount = await sql<{ count: string }>`SELECT COUNT(*) as count FROM users`.execute(destDb);
            expect(parseInt(destCount.rows[0]!.count, 10)).toBe(4); // 3 original + 1 new

        });

        it('should update on conflict with onConflict: update', async () => {

            // First transfer
            await transferData(sourceConfig, destConfig, {
                tables: ['users'],
            });

            // Update source
            await sql.raw('UPDATE users SET display_name = \'Updated Name\' WHERE email = \'user1@test.com\'').execute(sourceDb);

            // Transfer with update
            const [, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users'],
                onConflict: 'update',
            });

            expect(err).toBeNull();

            // Check destination was updated
            const destUser = await sql<{ display_name: string }>`
                SELECT display_name FROM users WHERE email = 'user1@test.com'
            `.execute(destDb);

            expect(destUser.rows[0]!.display_name).toBe('Updated Name');

        });

    });

    describe('truncateTable', () => {

        it('should use CASCADE for PostgreSQL', async () => {

            // First transfer
            await transferData(sourceConfig, destConfig, {
                tables: ['users', 'todo_lists', 'todo_items'],
            });

            // Transfer with truncate (should use CASCADE)
            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users', 'todo_lists', 'todo_items'],
                truncateFirst: true,
            });

            expect(err).toBeNull();
            expect(result!.status).toBe('success');

            // Verify counts match source
            const srcUsers = await sql<{ count: string }>`SELECT COUNT(*) as count FROM users`.execute(sourceDb);
            const destUsers = await sql<{ count: string }>`SELECT COUNT(*) as count FROM users`.execute(destDb);

            expect(destUsers.rows[0]!.count).toBe(srcUsers.rows[0]!.count);

        });

    });

    describe('identity handling', () => {

        it('should preserve identity values by default', async () => {

            const [, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users'],
            });

            expect(err).toBeNull();

            // Get source and dest IDs
            const srcIds = await sql<{ id: string }>`SELECT id FROM users ORDER BY id`.execute(sourceDb);
            const destIds = await sql<{ id: string }>`SELECT id FROM users ORDER BY id`.execute(destDb);

            expect(destIds.rows.length).toBe(srcIds.rows.length);

            for (let i = 0; i < srcIds.rows.length; i++) {

                expect(destIds.rows[i]!.id).toBe(srcIds.rows[i]!.id);

            }

        });

    });

    describe('dry run', () => {

        it('should not modify destination in dry run', async () => {

            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users'],
                dryRun: true,
            });

            expect(err).toBeNull();
            expect(result!.totalRows).toBe(0);

            // Destination should be empty
            const destCount = await sql<{ count: string }>`SELECT COUNT(*) as count FROM users`.execute(destDb);
            expect(parseInt(destCount.rows[0]!.count, 10)).toBe(0);

        });

        it('should report tables as skipped in dry run', async () => {

            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users', 'todo_lists'],
                dryRun: true,
            });

            expect(err).toBeNull();

            for (const tableResult of result!.tables) {

                expect(tableResult.status).toBe('skipped');
                expect(tableResult.rowsTransferred).toBe(0);

            }

        });

    });

    describe('FK handling', () => {

        it('should disable FK checks by default', async () => {

            // This should work even with tables in wrong order
            // because FK checks are disabled
            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['todo_items', 'todo_lists', 'users'], // Wrong order
            });

            // With FK disabled, this might work
            // The planner reorders anyway, but disableForeignKeys helps
            expect(err).toBeNull();
            expect(result!.status).toBe('success');

        });

        it('should respect disableForeignKeys: false option', async () => {

            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users', 'todo_lists', 'todo_items'],
                disableForeignKeys: false,
            });

            // With proper ordering, this should still work
            expect(err).toBeNull();
            expect(result!.status).toBe('success');

        });

    });

    describe('result structure', () => {

        it('should include all required fields in result', async () => {

            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users'],
            });

            expect(err).toBeNull();
            expect(result).toMatchObject({
                status: expect.any(String),
                tables: expect.any(Array),
                totalRows: expect.any(Number),
                durationMs: expect.any(Number),
            });

        });

        it('should include table-level results', async () => {

            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users'],
            });

            expect(err).toBeNull();
            expect(result!.tables[0]).toMatchObject({
                table: 'users',
                status: expect.any(String),
                rowsTransferred: expect.any(Number),
                rowsSkipped: expect.any(Number),
                durationMs: expect.any(Number),
            });

        });

    });

});
