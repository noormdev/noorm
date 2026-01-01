/**
 * Test Database Utilities.
 *
 * Provides helpers for integration tests that require live database connections.
 * Uses non-default ports to avoid conflicts with local databases.
 */
import { sql, type Kysely } from 'kysely';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createConnection } from '../../src/core/connection/factory.js';
import type { ConnectionConfig, ConnectionResult, Dialect } from '../../src/core/connection/types.js';

/**
 * Test connection configurations with non-default ports.
 *
 * These match the docker-compose.test.yml configuration.
 */
export const TEST_CONNECTIONS: Record<Dialect, ConnectionConfig> = {

    postgres: {
        dialect: 'postgres',
        host: 'localhost',
        port: 15432,
        user: 'noorm_test',
        password: 'noorm_test',
        database: 'noorm_test',
    },

    mysql: {
        dialect: 'mysql',
        host: 'localhost',
        port: 13306,
        user: 'noorm_test',
        password: 'noorm_test',
        database: 'noorm_test',
    },

    mssql: {
        dialect: 'mssql',
        host: 'localhost',
        port: 11433,
        user: 'sa',
        password: 'NoOrm_Test123!',
        database: 'noorm_test',
    },

    sqlite: {
        dialect: 'sqlite',
        database: ':memory:',
    },

};

/**
 * Directory containing fixture schema files.
 */
const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'schema');

/**
 * Create a test database connection.
 *
 * @param dialect - Database dialect to connect to
 * @returns Connection result with db instance and destroy function
 *
 * @example
 * ```typescript
 * const conn = await createTestConnection('postgres')
 * try {
 *     await deployTestSchema(conn.db, 'postgres')
 *     // run tests
 * } finally {
 *     await conn.destroy()
 * }
 * ```
 */
export async function createTestConnection(dialect: Dialect): Promise<ConnectionResult> {

    const config = TEST_CONNECTIONS[dialect];

    return createConnection(config, `__test_${dialect}__`);

}

/**
 * Execute a SQL file against the database.
 *
 * @param db - Kysely database instance
 * @param filePath - Path to SQL file
 */
async function executeSqlFile(db: Kysely<unknown>, filePath: string): Promise<void> {

    const content = await readFile(filePath, 'utf-8');

    // Remove comment lines before splitting
    const cleanedContent = content
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');

    // Split on semicolons followed by newline (handles triggers/procedures with internal semicolons)
    // This works because well-formatted SQL has statement terminators on their own line or followed by newline
    const statements = cleanedContent
        .split(/;[\s]*\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

    for (const statement of statements) {

        await sql.raw(statement).execute(db);

    }

}

/**
 * Deploy the test schema to a database.
 *
 * Applies the fixture SQL files for the given dialect.
 * Creates tables, views, functions/procedures.
 *
 * @param db - Kysely database instance
 * @param dialect - Database dialect
 */
export async function deployTestSchema(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

    const dialectDir = join(FIXTURES_DIR, dialect);

    // Order matters: tables first, then views, then functions/procedures, then triggers
    const files = [
        '001_tables.sql',
        '002_views.sql',
    ];

    // Dialect-specific extras
    if (dialect === 'postgres') {

        files.push('003_functions.sql');
        // TODO: Triggers disabled - SQL splitter can't handle BEGIN...END blocks with internal semicolons
        // files.push('004_triggers.sql');

    }
    else if (dialect === 'mysql') {

        files.push('003_procedures.sql');
        // TODO: Triggers disabled - SQL splitter can't handle BEGIN...END blocks with internal semicolons
        // files.push('004_triggers.sql');

    }
    else if (dialect === 'mssql') {

        // MSSQL has types before tables
        files.unshift('001_types.sql');
        files.push('004_functions.sql');
        files.push('005_procedures.sql');
        // TODO: Triggers disabled - SQL splitter can't handle BEGIN...END blocks with internal semicolons
        // files.push('006_triggers.sql');

    }
    else if (dialect === 'sqlite') {

        // TODO: Triggers disabled - SQL splitter can't handle BEGIN...END blocks with internal semicolons
        // files.push('003_triggers.sql');

    }

    for (const file of files) {

        const filePath = join(dialectDir, file);
        await executeSqlFile(db, filePath);

    }

}

/**
 * Seed test data into the database.
 *
 * Inserts sample users, todo_lists, and todo_items for testing queries.
 *
 * @param db - Kysely database instance
 * @param dialect - Database dialect
 */
export async function seedTestData(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

    // UUID generation varies by dialect
    const uuid = (value: string): string => {

        switch (dialect) {

        case 'mssql':
            return `'${value}'`; // UNIQUEIDENTIFIER as string literal

        case 'mysql':
        case 'sqlite':
        case 'postgres':
        default:
            return `'${value}'`;

        }

    };

    // Insert test users
    const userIds = [
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333',
    ];

    for (const [i, id] of userIds.entries()) {

        await sql.raw(`
            INSERT INTO users (id, email, username, password_hash, display_name)
            VALUES (${uuid(id)}, 'user${i + 1}@test.com', 'user${i + 1}', 'hash${i + 1}', 'Test User ${i + 1}')
        `).execute(db);

    }

    // Insert test todo_lists
    const listIds = [
        '44444444-4444-4444-4444-444444444444',
        '55555555-5555-5555-5555-555555555555',
    ];

    await sql.raw(`
        INSERT INTO todo_lists (id, user_id, title, description, color, position)
        VALUES (${uuid(listIds[0]!)}, ${uuid(userIds[0]!)}, 'Work Tasks', 'Tasks for work', '#FF5733', 0)
    `).execute(db);

    await sql.raw(`
        INSERT INTO todo_lists (id, user_id, title, description, color, position)
        VALUES (${uuid(listIds[1]!)}, ${uuid(userIds[0]!)}, 'Personal Tasks', 'Personal items', '#33FF57', 1)
    `).execute(db);

    // Insert test todo_items
    const itemIds = [
        '66666666-6666-6666-6666-666666666666',
        '77777777-7777-7777-7777-777777777777',
        '88888888-8888-8888-8888-888888888888',
    ];

    await sql.raw(`
        INSERT INTO todo_items (id, list_id, title, description, is_completed, priority, position)
        VALUES (${uuid(itemIds[0]!)}, ${uuid(listIds[0]!)}, 'Complete report', 'Finish Q4 report', false, 2, 0)
    `).execute(db);

    await sql.raw(`
        INSERT INTO todo_items (id, list_id, title, description, is_completed, priority, position)
        VALUES (${uuid(itemIds[1]!)}, ${uuid(listIds[0]!)}, 'Review PRs', 'Review pending pull requests', true, 1, 1)
    `).execute(db);

    await sql.raw(`
        INSERT INTO todo_items (id, list_id, title, description, is_completed, priority, position)
        VALUES (${uuid(itemIds[2]!)}, ${uuid(listIds[1]!)}, 'Buy groceries', 'Weekly shopping', false, 0, 0)
    `).execute(db);

}

/**
 * Reset test data by truncating all tables.
 *
 * Fast reset between tests without dropping schema.
 *
 * @param db - Kysely database instance
 * @param dialect - Database dialect
 */
export async function resetTestData(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

    // Order matters: delete from child tables first due to FK constraints
    const tables = ['todo_items', 'todo_lists', 'users'];

    switch (dialect) {

    case 'postgres':
        // PostgreSQL supports TRUNCATE CASCADE
        for (const table of tables) {

            await sql.raw(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`).execute(db);

        }
        break;

    case 'mysql':
        // MySQL needs FK checks disabled
        await sql.raw('SET FOREIGN_KEY_CHECKS = 0').execute(db);
        for (const table of tables) {

            await sql.raw(`TRUNCATE TABLE ${table}`).execute(db);

        }
        await sql.raw('SET FOREIGN_KEY_CHECKS = 1').execute(db);
        break;

    case 'mssql':
        // MSSQL needs DELETE in order (no TRUNCATE with FK)
        for (const table of tables) {

            await sql.raw(`DELETE FROM ${table}`).execute(db);

        }
        break;

    case 'sqlite':
        // SQLite needs DELETE in order
        for (const table of tables) {

            await sql.raw(`DELETE FROM ${table}`).execute(db);

        }
        break;

    }

}

/**
 * Teardown test schema by dropping all objects.
 *
 * Completely removes all schema objects for fresh deployment.
 *
 * @param db - Kysely database instance
 * @param dialect - Database dialect
 */
export async function teardownTestSchema(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

    // Views first, then tables (reverse of creation order)
    const views = ['v_active_todo_items', 'v_todo_lists_with_counts', 'v_active_users'];
    const tables = ['todo_items', 'todo_lists', 'users'];

    // Drop views
    for (const view of views) {

        await sql.raw(`DROP VIEW IF EXISTS ${view}`).execute(db);

    }

    // Drop dialect-specific objects
    if (dialect === 'postgres') {

        // Drop functions (names from fixtures)
        const functions = [
            'create_user', 'get_user_by_id', 'get_user_by_email', 'update_user', 'delete_user',
            'create_todo_list', 'get_todo_list_by_id', 'get_todo_lists_by_user', 'update_todo_list', 'delete_todo_list',
            'create_todo_item', 'get_todo_item_by_id', 'get_todo_items_by_list', 'update_todo_item', 'toggle_todo_item', 'delete_todo_item',
        ];

        for (const fn of functions) {

            await sql.raw(`DROP FUNCTION IF EXISTS ${fn} CASCADE`).execute(db);

        }

    }
    else if (dialect === 'mysql') {

        // Drop procedures
        const procedures = [
            'create_user', 'get_user_by_id', 'get_user_by_email', 'update_user', 'delete_user',
            'create_todo_list', 'get_todo_list_by_id', 'get_todo_lists_by_user', 'update_todo_list', 'delete_todo_list',
            'create_todo_item', 'get_todo_item_by_id', 'get_todo_items_by_list', 'update_todo_item', 'toggle_todo_item', 'delete_todo_item',
        ];

        for (const proc of procedures) {

            await sql.raw(`DROP PROCEDURE IF EXISTS ${proc}`).execute(db);

        }

    }
    else if (dialect === 'mssql') {

        // Drop procedures and functions
        const procedures = [
            'create_user', 'get_user_by_id', 'get_user_by_email', 'update_user', 'delete_user',
            'create_todo_list', 'get_todo_list_by_id', 'get_todo_lists_by_user', 'update_todo_list', 'delete_todo_list',
            'create_todo_item', 'get_todo_item_by_id', 'get_todo_items_by_list', 'update_todo_item', 'toggle_todo_item', 'delete_todo_item',
        ];

        for (const proc of procedures) {

            await sql.raw(`DROP PROCEDURE IF EXISTS ${proc}`).execute(db);

        }

        const functions = ['fn_IsValidEmail', 'fn_IsValidHexColor', 'fn_GetPriorityLabel'];

        for (const fn of functions) {

            await sql.raw(`DROP FUNCTION IF EXISTS ${fn}`).execute(db);

        }

    }

    // Drop tables (FK order)
    for (const table of tables) {

        await sql.raw(`DROP TABLE IF EXISTS ${table} CASCADE`).execute(db);

    }

    // Drop MSSQL custom types (after tables that use them)
    if (dialect === 'mssql') {

        const types = ['EmailAddress', 'Username', 'HexColor', 'Priority', 'SoftDeleteDate'];

        for (const type of types) {

            await sql.raw(`DROP TYPE IF EXISTS ${type}`).execute(db);

        }

    }

}

/**
 * Check if test containers are running.
 *
 * @param dialect - Database dialect to check
 * @returns True if container is available
 */
export async function isContainerRunning(dialect: Dialect): Promise<boolean> {

    if (dialect === 'sqlite') return true; // No container needed

    try {

        const conn = await createTestConnection(dialect);
        await conn.destroy();

        return true;

    }
    catch {

        return false;

    }

}

/**
 * Skip test if container is not running.
 *
 * Use as a guard at the beginning of integration test files.
 *
 * @param dialect - Database dialect
 */
export async function skipIfNoContainer(dialect: Dialect): Promise<void> {

    const running = await isContainerRunning(dialect);

    if (!running) {

        throw new Error(
            `${dialect} container not running. Start with: docker compose -f docker-compose.test.yml up -d`,
        );

    }

}
