/**
 * Integration tests for MySQL data transfer.
 *
 * Tests cross-database transfers with FK handling, AUTO_INCREMENT columns,
 * and conflict strategies against real MySQL databases.
 *
 * Requires docker-compose.test.yml containers to be running.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'kysely';

import type { Kysely } from 'kysely';
import type { ConnectionResult } from '../../../src/core/connection/types.js';

import { transferData, getTransferPlan } from '../../../src/core/transfer/index.js';
import { createConnection } from '../../../src/core/connection/factory.js';
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

/**
 * Create Config objects for source and destination.
 *
 * Uses TEST_MYSQL_DATABASE_DEST env var for destination, falls back to noorm_test_dest.
 */
function makeConfigs() {

    const sourceConfig = makeTestConfig('test_source', { ...TEST_CONNECTIONS.mysql });

    const destConfig = makeTestConfig('test_dest', {
        ...TEST_CONNECTIONS.mysql,
        database: process.env['TEST_MYSQL_DATABASE_DEST'] ?? 'noorm_test_dest',
    });

    return { sourceConfig, destConfig };

}

describe('integration: mysql transfer', () => {

    let sourceDb: Kysely<unknown>;
    let destDb: Kysely<unknown>;
    let sourceDestroy: () => Promise<void>;
    let destDestroy: () => Promise<void>;
    let destConn: ConnectionResult;

    const { sourceConfig, destConfig } = makeConfigs();

    beforeAll(async () => {

        await skipIfNoContainer('mysql');

        // Connect to source (main test database)
        const conn = await createTestConnection('mysql');
        sourceDb = conn.db;
        sourceDestroy = conn.destroy;

        // Connect as root to create destination database if needed
        const destDbName = destConfig.connection.database;
        const { database: _, ...mysqlNoDB } = TEST_CONNECTIONS.mysql;
        const systemConn = await createConnection({
            ...mysqlNoDB,
            user: 'root',
            database: 'information_schema',
        }, 'system');

        // Check if destination database exists and create if not
        const dbCheck = await sql<{ count: number }>`
            SELECT COUNT(*) as count FROM information_schema.schemata WHERE schema_name = ${destDbName}
        `.execute(systemConn.db);

        if (dbCheck.rows[0]?.count === 0) {

            try {

                await sql.raw(`CREATE DATABASE \`${destDbName}\``).execute(systemConn.db);

            }
            catch {

                await systemConn.destroy();
                throw new Error(
                    'MySQL destination database \'' + destDbName + '\' does not exist and cannot be created. ' +
                    'Either create it manually or grant CREATE DATABASE privileges to the test user.',
                );

            }

        }

        // Grant the test user full access to the destination database
        const testUser = TEST_CONNECTIONS.mysql.user;
        await sql.raw(`GRANT ALL PRIVILEGES ON \`${destDbName}\`.* TO '${testUser}'@'%'`).execute(systemConn.db);
        await sql.raw('FLUSH PRIVILEGES').execute(systemConn.db);

        await systemConn.destroy();

        // Connect to destination
        destConn = await createConnection(destConfig.connection, 'test_dest');
        destDb = destConn.db;
        destDestroy = destConn.destroy;

        // Deploy schema to both databases
        await teardownTestSchema(sourceDb, 'mysql');
        await deployTestSchema(sourceDb, 'mysql');

        await teardownTestSchema(destDb, 'mysql');
        await deployTestSchema(destDb, 'mysql');

    });

    afterAll(async () => {

        if (destDestroy) await destDestroy();
        if (sourceDestroy) await sourceDestroy();

    });

    beforeEach(async () => {

        // Reset and seed source data
        await resetTestData(sourceDb, 'mysql');
        await seedTestData(sourceDb, 'mysql');

        // Clear destination data
        await resetTestData(destDb, 'mysql');

    });

    describe('getTransferPlan', () => {

        it('should return a plan with all tables', async () => {

            const [plan, err] = await getTransferPlan(sourceConfig, destConfig);

            expect(err).toBeNull();
            expect(plan).not.toBeNull();
            expect(plan!.tables.length).toBeGreaterThanOrEqual(3);

            const tableNames = plan!.tables.map((t) => t.name);
            expect(tableNames).toContain('users');
            expect(tableNames).toContain('todo_lists');
            expect(tableNames).toContain('todo_items');

        });

        it('should detect same-server for different databases on same host', async () => {

            const [plan, err] = await getTransferPlan(sourceConfig, destConfig);

            expect(err).toBeNull();
            // MySQL CAN do cross-database queries on same server, so sameServer should be true
            expect(plan!.sameServer).toBe(true);

        });

        it('should order tables by FK dependencies', async () => {

            const [plan, err] = await getTransferPlan(sourceConfig, destConfig);

            expect(err).toBeNull();

            const tableNames = plan!.tables.map((t) => t.name);
            const usersIdx = tableNames.indexOf('users');
            const listsIdx = tableNames.indexOf('todo_lists');
            const itemsIdx = tableNames.indexOf('todo_items');

            // users should come before todo_lists (FK: todo_lists.user_id -> users.id)
            expect(usersIdx).toBeLessThan(listsIdx);

            // todo_lists should come before todo_items (FK: todo_items.list_id -> todo_lists.id)
            expect(listsIdx).toBeLessThan(itemsIdx);

        });

        it('should filter to specific tables', async () => {

            const [plan, err] = await getTransferPlan(sourceConfig, destConfig, {
                tables: ['users'],
            });

            expect(err).toBeNull();
            expect(plan!.tables.length).toBe(1);
            expect(plan!.tables[0]!.name).toBe('users');

        });

        it('should include AUTO_INCREMENT column info', async () => {

            const [plan, err] = await getTransferPlan(sourceConfig, destConfig);

            expect(err).toBeNull();

            const usersTable = plan!.tables.find((t) => t.name === 'users');
            expect(usersTable).toBeDefined();
            expect(usersTable!.columns).toContain('id');
            expect(usersTable!.primaryKey).toContain('id');

        });

    });

    describe('transferData', () => {

        it('should transfer all data from source to destination', async () => {

            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users', 'todo_lists', 'todo_items'],
            });

            expect(err).toBeNull();
            expect(result).not.toBeNull();
            expect(result!.status).toBe('success');
            expect(result!.totalRows).toBeGreaterThan(0);

            // Verify data in destination
            const destUsers = await sql<{ count: string }>`SELECT COUNT(*) as count FROM users`.execute(destDb);
            expect(parseInt(destUsers.rows[0]!.count, 10)).toBe(3);

            const destLists = await sql<{ count: string }>`SELECT COUNT(*) as count FROM todo_lists`.execute(destDb);
            expect(parseInt(destLists.rows[0]!.count, 10)).toBe(2);

            const destItems = await sql<{ count: string }>`SELECT COUNT(*) as count FROM todo_items`.execute(destDb);
            expect(parseInt(destItems.rows[0]!.count, 10)).toBe(3);

        });

        it('should preserve identity values', async () => {

            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users'],
            });

            expect(err).toBeNull();
            expect(result!.status).toBe('success');

            // Verify IDs match source
            const sourceUsers = await sql<{ id: string }>`SELECT id FROM users ORDER BY id`.execute(sourceDb);
            const destUsers = await sql<{ id: string }>`SELECT id FROM users ORDER BY id`.execute(destDb);

            expect(destUsers.rows.length).toBe(sourceUsers.rows.length);

            for (let i = 0; i < sourceUsers.rows.length; i++) {

                expect(destUsers.rows[i]!.id).toBe(sourceUsers.rows[i]!.id);

            }

        });

        it('should handle truncateFirst option', async () => {

            // First transfer
            await transferData(sourceConfig, destConfig, {
                tables: ['users'],
            });

            // Second transfer with truncateFirst
            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users'],
                truncateFirst: true,
            });

            expect(err).toBeNull();
            expect(result!.status).toBe('success');

            // Should have same count as source (not doubled)
            const destUsers = await sql<{ count: string }>`SELECT COUNT(*) as count FROM users`.execute(destDb);
            expect(parseInt(destUsers.rows[0]!.count, 10)).toBe(3);

        });

        it('should skip conflicts with onConflict: skip', async () => {

            // First transfer
            await transferData(sourceConfig, destConfig, {
                tables: ['users'],
            });

            // Second transfer with skip
            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users'],
                onConflict: 'skip',
            });

            expect(err).toBeNull();
            expect(result!.status).toBe('success');

            // Should still have original count
            const destUsers = await sql<{ count: string }>`SELECT COUNT(*) as count FROM users`.execute(destDb);
            expect(parseInt(destUsers.rows[0]!.count, 10)).toBe(3);

        });

        it('should update conflicts with onConflict: update', async () => {

            // First transfer
            await transferData(sourceConfig, destConfig, {
                tables: ['users'],
            });

            // Modify source data
            await sql.raw('UPDATE users SET display_name = \'Modified User 1\' WHERE email = \'user1@test.com\'').execute(sourceDb);

            // Second transfer with update
            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users'],
                onConflict: 'update',
            });

            expect(err).toBeNull();
            expect(result!.status).toBe('success');

            // Check update was applied
            const destUser = await sql<{ display_name: string }>`
                SELECT display_name FROM users WHERE email = 'user1@test.com'
            `.execute(destDb);

            expect(destUser.rows[0]!.display_name).toBe('Modified User 1');

        });

        it('should support dry run mode', async () => {

            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users'],
                dryRun: true,
            });

            expect(err).toBeNull();
            expect(result!.status).toBe('success');
            expect(result!.totalRows).toBe(0);

            // Destination should still be empty
            const destUsers = await sql<{ count: string }>`SELECT COUNT(*) as count FROM users`.execute(destDb);
            expect(parseInt(destUsers.rows[0]!.count, 10)).toBe(0);

        });

        it('should fail for dialect mismatch', async () => {

            const mismatchConfig = makeTestConfig('test_postgres', { ...TEST_CONNECTIONS.postgres });

            const [result, err] = await transferData(sourceConfig, mismatchConfig);

            expect(result).toBeNull();
            expect(err).not.toBeNull();
            expect(err!.message).toContain('Cross-dialect transfer not supported');

        });

    });

    describe('FK ordering', () => {

        it('should insert dependent tables in correct order', async () => {

            const [result, err] = await transferData(sourceConfig, destConfig, {
                tables: ['users', 'todo_lists', 'todo_items'],
                disableForeignKeys: false, // Force FK checks
            });

            // With FK checks disabled (default), this should work
            // With FK checks enabled, tables must be in order
            expect(err).toBeNull();
            expect(result!.status).toBe('success');

        });

    });

});
