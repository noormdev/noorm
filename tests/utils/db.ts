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
 * Directory containing fixture SQL files.
 */
const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'sql');

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
 * Split SQL content into individual statements.
 *
 * Handles:
 * - PostgreSQL dollar-quoted strings ($$...$$) which can contain semicolons
 * - MySQL/MSSQL BEGIN...END blocks which contain semicolons
 *
 * Uses the pattern of semicolon followed by whitespace and newline as statement separator,
 * but skips such patterns inside dollar-quoted strings or BEGIN...END blocks.
 *
 * @param content - SQL content to split
 * @returns Array of SQL statements
 */
export function splitSqlStatements(content: string): string[] {

    const statements: string[] = [];
    let current = '';
    let inDollarQuote = false;
    let dollarTag = '';
    let beginDepth = 0;
    let inString = false;
    let stringChar = '';
    let i = 0;

    // Helper to check for a keyword at position (case-insensitive, word boundary)
    const matchKeyword = (pos: number, keyword: string): boolean => {

        if (pos + keyword.length > content.length) return false;

        const slice = content.slice(pos, pos + keyword.length);

        if (slice.toLowerCase() !== keyword.toLowerCase()) return false;

        // Check word boundary before
        if (pos > 0) {

            const charBefore = content[pos - 1];

            if (/[a-zA-Z0-9_]/.test(charBefore!)) return false;

        }

        // Check word boundary after
        if (pos + keyword.length < content.length) {

            const charAfter = content[pos + keyword.length];

            if (/[a-zA-Z0-9_]/.test(charAfter!)) return false;

        }

        return true;

    };

    while (i < content.length) {

        const char = content[i]!;

        // Track string literals (single quotes)
        if (char === "'" && !inDollarQuote) {

            if (inString && stringChar === "'") {

                // Check for escaped quote ('')
                if (i + 1 < content.length && content[i + 1] === "'") {

                    current += "''";
                    i += 2;
                    continue;

                }

                inString = false;
                stringChar = '';

            }
            else if (!inString) {

                inString = true;
                stringChar = "'";

            }

            current += char;
            i++;
            continue;

        }

        // Skip processing if inside a string literal
        if (inString) {

            current += char;
            i++;
            continue;

        }

        // Check for dollar-quote start/end (PostgreSQL)
        if (char === '$' && !inString) {

            // Look for dollar-quote tag pattern: $tag$ or $$
            let j = i + 1;

            while (j < content.length && (content[j] === '_' || /[a-zA-Z0-9]/.test(content[j]!))) {

                j++;

            }

            if (j < content.length && content[j] === '$') {

                const tag = content.slice(i, j + 1);

                if (!inDollarQuote) {

                    // Starting a dollar-quoted string
                    inDollarQuote = true;
                    dollarTag = tag;
                    current += tag;
                    i = j + 1;
                    continue;

                }
                else if (tag === dollarTag) {

                    // Ending the dollar-quoted string
                    inDollarQuote = false;
                    dollarTag = '';
                    current += tag;
                    i = j + 1;
                    continue;

                }

            }

        }

        // Skip processing if inside a dollar-quote
        if (inDollarQuote) {

            current += char;
            i++;
            continue;

        }

        // Check for BEGIN keyword
        if (matchKeyword(i, 'BEGIN')) {

            beginDepth++;
            current += content.slice(i, i + 5);
            i += 5;
            continue;

        }

        // Check for END keyword that closes a BEGIN block
        // Only decrement depth if END is followed by ; (to avoid CASE...END expressions)
        // Skip END IF, END LOOP, END WHILE, END CASE, END REPEAT (these don't close BEGIN)
        if (matchKeyword(i, 'END') && beginDepth > 0) {

            // Look ahead to see what follows END
            let afterEnd = i + 3;

            // Skip whitespace (but not newlines for now)
            while (afterEnd < content.length && content[afterEnd] === ' ') {

                afterEnd++;

            }

            // Check for compound statement keywords (END IF, END LOOP, etc.)
            const compoundKeywords = ['IF', 'LOOP', 'WHILE', 'CASE', 'REPEAT'];
            let isCompoundEnd = false;

            for (const kw of compoundKeywords) {

                if (matchKeyword(afterEnd, kw)) {

                    isCompoundEnd = true;
                    break;

                }

            }

            // Only decrement if:
            // 1. Not a compound END (END IF, END LOOP, etc.)
            // 2. Followed by ; (to avoid CASE...END expressions where END is not followed by ;)
            const followedBySemicolon = content[afterEnd] === ';';

            if (!isCompoundEnd && followedBySemicolon) {

                beginDepth--;

            }

            current += content.slice(i, i + 3);
            i += 3;
            continue;

        }

        // Check for statement-ending semicolon (followed by whitespace+newline)
        if (char === ';' && beginDepth === 0) {

            // Look ahead for whitespace followed by newline
            let j = i + 1;

            while (j < content.length && content[j] !== '\n' && /\s/.test(content[j]!)) {

                j++;

            }

            // Statement ends if semicolon is at end of content or followed by whitespace+newline
            if (j >= content.length || content[j] === '\n') {

                current += content.slice(i, j + 1);
                const trimmed = current.trim();

                if (trimmed.length > 0 && !trimmed.startsWith('--')) {

                    statements.push(trimmed);

                }
                current = '';
                i = j + 1;
                continue;

            }

        }

        current += char;
        i++;

    }

    // Add final statement if any
    const trimmed = current.trim();

    if (trimmed.length > 0 && !trimmed.startsWith('--')) {

        statements.push(trimmed);

    }

    return statements;

}

/**
 * Preprocess MySQL DELIMITER syntax.
 *
 * MySQL uses DELIMITER to change the statement terminator for procedures.
 * This function converts DELIMITER-based files to standard semicolon-terminated statements.
 *
 * @param content - SQL file content
 * @returns Preprocessed content with DELIMITER syntax removed
 */
function preprocessMySqlDelimiter(content: string): string {

    // Check if this file uses DELIMITER
    if (!content.includes('DELIMITER')) {

        return content;

    }

    // Find all DELIMITER declarations
    const delimiterMatch = content.match(/DELIMITER\s+(\S+)/);

    if (!delimiterMatch) {

        return content;

    }

    const customDelimiter = delimiterMatch[1]!;

    // Remove DELIMITER lines
    let processed = content.replace(/DELIMITER\s+\S+[\r\n]*/g, '');

    // Replace custom delimiter with semicolon
    processed = processed.replace(new RegExp(customDelimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ';');

    return processed;

}

/**
 * Preprocess MSSQL GO batch separator.
 *
 * MSSQL uses GO to separate batches, not semicolons.
 * This function splits content by GO and returns individual batches.
 *
 * @param content - SQL file content
 * @returns Array of SQL batches
 */
function splitMssqlBatches(content: string): string[] {

    // Split by GO on its own line (case-insensitive)
    const batches = content.split(/^\s*GO\s*$/mi);

    return batches
        .map(b => b.trim())
        .filter(b => b.length > 0 && !b.startsWith('--'));

}

/**
 * Execute a SQL file against the database.
 *
 * @param db - Kysely database instance
 * @param filePath - Path to SQL file
 * @param dialect - Database dialect (for MSSQL GO handling)
 */
async function executeSqlFile(db: Kysely<unknown>, filePath: string, dialect?: Dialect): Promise<void> {

    let content = await readFile(filePath, 'utf-8');

    // Handle MySQL DELIMITER syntax
    content = preprocessMySqlDelimiter(content);

    // Remove comment lines before splitting
    const cleanedContent = content
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');

    // MSSQL uses GO as batch separator
    if (dialect === 'mssql') {

        const batches = splitMssqlBatches(cleanedContent);

        for (const batch of batches) {

            await sql.raw(batch).execute(db);

        }

        return;

    }

    const statements = splitSqlStatements(cleanedContent);

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

        // MSSQL uses different numbering: types → tables → views → functions → procedures
        files.length = 0; // Clear default files
        files.push('001_types.sql');
        files.push('002_tables.sql');
        files.push('003_views.sql');
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
        await executeSqlFile(db, filePath, dialect);

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

    // Boolean literals vary by dialect
    const bool = (value: boolean): string => {

        // MSSQL uses BIT (0/1), others use true/false
        if (dialect === 'mssql') {

            return value ? '1' : '0';

        }

        return value ? 'true' : 'false';

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
        VALUES (${uuid(itemIds[0]!)}, ${uuid(listIds[0]!)}, 'Complete report', 'Finish Q4 report', ${bool(false)}, 2, 0)
    `).execute(db);

    await sql.raw(`
        INSERT INTO todo_items (id, list_id, title, description, is_completed, priority, position)
        VALUES (${uuid(itemIds[1]!)}, ${uuid(listIds[0]!)}, 'Review PRs', 'Review pending pull requests', ${bool(true)}, 1, 1)
    `).execute(db);

    await sql.raw(`
        INSERT INTO todo_items (id, list_id, title, description, is_completed, priority, position)
        VALUES (${uuid(itemIds[2]!)}, ${uuid(listIds[1]!)}, 'Buy groceries', 'Weekly shopping', ${bool(false)}, 0, 0)
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

        if (dialect === 'mssql') {

            // MSSQL doesn't support CASCADE - drop FK constraints manually first
            // Get and drop all FK constraints referencing this table
            const fks = await sql.raw(`
                SELECT fk.name AS fk_name, OBJECT_NAME(fk.parent_object_id) AS table_name
                FROM sys.foreign_keys fk
                WHERE OBJECT_NAME(fk.referenced_object_id) = '${table}'
                   OR OBJECT_NAME(fk.parent_object_id) = '${table}'
            `).execute(db);

            for (const fk of fks.rows as Array<{ fk_name: string; table_name: string }>) {

                await sql.raw(`ALTER TABLE [${fk.table_name}] DROP CONSTRAINT [${fk.fk_name}]`).execute(db);

            }

            // Now drop the table
            await sql.raw(`DROP TABLE IF EXISTS [${table}]`).execute(db);

        }
        else {

            await sql.raw(`DROP TABLE IF EXISTS ${table} CASCADE`).execute(db);

        }

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
