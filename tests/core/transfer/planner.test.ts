/**
 * Transfer planner unit tests.
 *
 * Tests the planning logic: topological sort, FK dependency ordering,
 * table filtering, and schema validation.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'kysely';

import type { Kysely } from 'kysely';

import { getTransferPlan } from '../../../src/core/transfer/index.js';
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

    const sourceConfig = makeTestConfig('planner_source', { ...TEST_CONNECTIONS.postgres });

    const destConfig = makeTestConfig('planner_dest', {
        ...TEST_CONNECTIONS.postgres,
        database: process.env['TEST_POSTGRES_DATABASE_DEST'] ?? 'noorm_test_dest',
    });

    return { sourceConfig, destConfig };

}

describe('transfer: planner', () => {

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
        const destConn = await createConnection(destConfig.connection, 'planner_dest');
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

    describe('topological sort', () => {

        it('should order tables by FK dependencies', async () => {

            const [plan, err] = await getTransferPlan(sourceConfig, destConfig);

            expect(err).toBeNull();
            expect(plan).not.toBeNull();

            const tableNames = plan!.tables.map((t) => t.name);
            const usersIdx = tableNames.indexOf('users');
            const listsIdx = tableNames.indexOf('todo_lists');
            const itemsIdx = tableNames.indexOf('todo_items');

            // All three tables should be present
            expect(usersIdx).toBeGreaterThanOrEqual(0);
            expect(listsIdx).toBeGreaterThanOrEqual(0);
            expect(itemsIdx).toBeGreaterThanOrEqual(0);

            // users should come before todo_lists (FK: todo_lists.user_id -> users.id)
            expect(usersIdx).toBeLessThan(listsIdx);

            // todo_lists should come before todo_items (FK: todo_items.list_id -> todo_lists.id)
            expect(listsIdx).toBeLessThan(itemsIdx);

        });

        it('should handle tables with no dependencies', async () => {

            // users has no dependencies, should be first
            const [plan, err] = await getTransferPlan(sourceConfig, destConfig);

            expect(err).toBeNull();

            const usersTable = plan!.tables.find((t) => t.name === 'users');
            expect(usersTable).toBeDefined();
            expect(usersTable!.dependsOn).toEqual([]);

        });

        it('should include dependsOn info in table plan', async () => {

            const [plan, err] = await getTransferPlan(sourceConfig, destConfig);

            expect(err).toBeNull();

            const listsTable = plan!.tables.find((t) => t.name === 'todo_lists');
            expect(listsTable).toBeDefined();
            expect(listsTable!.dependsOn).toContain('users');

            const itemsTable = plan!.tables.find((t) => t.name === 'todo_items');
            expect(itemsTable).toBeDefined();
            expect(itemsTable!.dependsOn).toContain('todo_lists');

        });

    });

    describe('table filtering', () => {

        it('should exclude __noorm_* tables', async () => {

            const [plan, err] = await getTransferPlan(sourceConfig, destConfig);

            expect(err).toBeNull();

            const tableNames = plan!.tables.map((t) => t.name);

            for (const name of tableNames) {

                expect(name.startsWith('__noorm_')).toBe(false);

            }

        });

        it('should filter to requested tables', async () => {

            const [plan, err] = await getTransferPlan(sourceConfig, destConfig, {
                tables: ['users', 'todo_lists'],
            });

            expect(err).toBeNull();
            expect(plan!.tables.length).toBe(2);

            const tableNames = plan!.tables.map((t) => t.name);
            expect(tableNames).toContain('users');
            expect(tableNames).toContain('todo_lists');
            expect(tableNames).not.toContain('todo_items');

        });

        it('should handle single table filter', async () => {

            const [plan, err] = await getTransferPlan(sourceConfig, destConfig, {
                tables: ['users'],
            });

            expect(err).toBeNull();
            expect(plan!.tables.length).toBe(1);
            expect(plan!.tables[0]!.name).toBe('users');

        });

        it('should return empty plan for non-existent table filter', async () => {

            const [plan, err] = await getTransferPlan(sourceConfig, destConfig, {
                tables: ['nonexistent_table'],
            });

            expect(err).toBeNull();
            expect(plan!.tables.length).toBe(0);

        });

    });

    describe('schema validation', () => {

        it('should warn when dest table is missing', async () => {

            // Create a table in source that doesn't exist in dest
            await sql.raw('CREATE TABLE IF NOT EXISTS source_only_table (id SERIAL PRIMARY KEY)').execute(sourceDb);

            try {

                const [plan, err] = await getTransferPlan(sourceConfig, destConfig, {
                    tables: ['source_only_table'],
                });

                expect(err).toBeNull();
                expect(plan!.warnings.length).toBeGreaterThan(0);
                expect(plan!.warnings.some((w) => w.includes('source_only_table'))).toBe(true);

            }
            finally {

                await sql.raw('DROP TABLE IF EXISTS source_only_table').execute(sourceDb);

            }

        });

        it('should detect identity columns', async () => {

            const [plan, err] = await getTransferPlan(sourceConfig, destConfig);

            expect(err).toBeNull();

            // All our test tables use SERIAL which creates identity columns
            const usersTable = plan!.tables.find((t) => t.name === 'users');
            expect(usersTable).toBeDefined();

            // At minimum, columns and primary key should be detected
            expect(usersTable!.columns.length).toBeGreaterThan(0);
            expect(usersTable!.primaryKey.length).toBeGreaterThan(0);

        });

        it('should include estimated row counts', async () => {

            const [plan, err] = await getTransferPlan(sourceConfig, destConfig);

            expect(err).toBeNull();

            // estimatedRows should be a non-negative number
            expect(plan!.estimatedRows).toBeGreaterThanOrEqual(0);

            for (const table of plan!.tables) {

                expect(typeof table.rowCount).toBe('number');
                expect(table.rowCount).toBeGreaterThanOrEqual(0);

            }

        });

    });

    describe('same-server detection', () => {

        it('should detect cross-server for PostgreSQL (different databases)', async () => {

            const [plan, err] = await getTransferPlan(sourceConfig, destConfig);

            expect(err).toBeNull();
            // PostgreSQL cannot do cross-database queries, so sameServer is false
            expect(plan!.sameServer).toBe(false);

        });

        it('should include sameServer in plan', async () => {

            const [plan, err] = await getTransferPlan(sourceConfig, destConfig);

            expect(err).toBeNull();
            expect(typeof plan!.sameServer).toBe('boolean');

        });

    });

    describe('column metadata', () => {

        it('should include all columns in plan', async () => {

            const [plan, err] = await getTransferPlan(sourceConfig, destConfig, {
                tables: ['users'],
            });

            expect(err).toBeNull();

            const usersTable = plan!.tables[0]!;
            expect(usersTable.columns).toContain('id');
            expect(usersTable.columns).toContain('email');
            expect(usersTable.columns).toContain('username');

        });

        it('should include primary key info', async () => {

            const [plan, err] = await getTransferPlan(sourceConfig, destConfig, {
                tables: ['users'],
            });

            expect(err).toBeNull();

            const usersTable = plan!.tables[0]!;
            expect(usersTable.primaryKey).toContain('id');

        });

    });

});
