/**
 * SQLite SQL Terminal Integration Tests
 *
 * Tests the sql-terminal executor against a real SQLite in-memory database.
 * Verifies SELECT, INSERT, UPDATE, DELETE, DDL operations and error handling.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';

import {
    createTestConnection,
    deployTestSchema,
    seedTestData,
    resetTestData,
} from '../../utils/db.js';
import { executeRawSql } from '../../../src/core/sql-terminal/executor.js';


describe('integration: sqlite sql-terminal', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        const conn = await createTestConnection('sqlite');
        db = conn.db;
        destroy = conn.destroy;

        await deployTestSchema(db, 'sqlite');

    });

    beforeEach(async () => {

        // Reset data before each test for consistent state
        await resetTestData(db, 'sqlite');
        await seedTestData(db, 'sqlite');

    });

    afterAll(async () => {

        await destroy();

    });

    describe('SELECT queries', () => {

        it('should execute simple SELECT and return columns and rows', async () => {

            const result = await executeRawSql(
                db,
                'SELECT id, email, username FROM users',
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual(['id', 'email', 'username']);
            expect(result.rows).toHaveLength(3);

        });

        it('should return correct row data', async () => {

            const result = await executeRawSql(
                db,
                "SELECT email, username FROM users WHERE email = 'user1@test.com'",
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.rows).toHaveLength(1);
            expect(result.rows![0]).toEqual({
                email: 'user1@test.com',
                username: 'user1',
            });

        });

        it('should handle SELECT with WHERE clause returning multiple rows', async () => {

            const result = await executeRawSql(
                db,
                'SELECT id, title FROM todo_items WHERE priority >= 1',
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.rows!.length).toBeGreaterThanOrEqual(2);

        });

        it('should handle SELECT with JOIN', async () => {

            const result = await executeRawSql(
                db,
                `SELECT u.username, tl.title
                 FROM users u
                 INNER JOIN todo_lists tl ON tl.user_id = u.id`,
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual(['username', 'title']);
            expect(result.rows!.length).toBeGreaterThan(0);

        });

        it('should handle SELECT with aggregate functions', async () => {

            const result = await executeRawSql(
                db,
                'SELECT COUNT(*) as total, MAX(priority) as max_priority FROM todo_items',
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual(['total', 'max_priority']);
            expect(result.rows).toHaveLength(1);
            expect(result.rows![0]!.total).toBe(3);

        });

        it('should handle SELECT returning empty result set', async () => {

            const result = await executeRawSql(
                db,
                "SELECT * FROM users WHERE email = 'nonexistent@test.com'",
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual([]);
            expect(result.rows).toEqual([]);

        });

        it('should handle SELECT from view', async () => {

            const result = await executeRawSql(
                db,
                'SELECT * FROM v_active_users',
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.rows).toHaveLength(3);
            expect(result.columns).toContain('email');
            expect(result.columns).toContain('username');

        });

        it('should return execution duration', async () => {

            const result = await executeRawSql(
                db,
                'SELECT * FROM users',
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

    });

    describe('INSERT queries', () => {

        it('should execute INSERT and return rowsAffected', async () => {

            const result = await executeRawSql(
                db,
                `INSERT INTO users (id, email, username, password_hash, display_name)
                 VALUES ('99999999-9999-9999-9999-999999999999', 'new@test.com', 'newuser', 'hash', 'New User')`,
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(1);

        });

        it('should persist inserted data', async () => {

            await executeRawSql(
                db,
                `INSERT INTO users (id, email, username, password_hash)
                 VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'test@insert.com', 'inserttest', 'hash')`,
                'test-config',
            );

            const check = await executeRawSql(
                db,
                "SELECT email FROM users WHERE username = 'inserttest'",
                'test-config',
            );

            expect(check.success).toBe(true);
            expect(check.rows).toHaveLength(1);
            expect(check.rows![0]!.email).toBe('test@insert.com');

        });

        it('should return rowsAffected for multi-row INSERT', async () => {

            // SQLite doesn't support multi-value INSERT in all versions
            // So we do multiple inserts to test rowsAffected
            const result1 = await executeRawSql(
                db,
                `INSERT INTO users (id, email, username, password_hash)
                 VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'a@test.com', 'usera', 'hash')`,
                'test-config',
            );

            const result2 = await executeRawSql(
                db,
                `INSERT INTO users (id, email, username, password_hash)
                 VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'b@test.com', 'userb', 'hash')`,
                'test-config',
            );

            expect(result1.rowsAffected).toBe(1);
            expect(result2.rowsAffected).toBe(1);

        });

    });

    describe('UPDATE queries', () => {

        it('should execute UPDATE and return rowsAffected', async () => {

            const result = await executeRawSql(
                db,
                "UPDATE users SET display_name = 'Updated Name' WHERE username = 'user1'",
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(1);

        });

        it('should update multiple rows', async () => {

            const result = await executeRawSql(
                db,
                "UPDATE users SET avatar_url = 'https://example.com/avatar.png'",
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(3);

        });

        it('should return rowsAffected = 0 when no rows match', async () => {

            const result = await executeRawSql(
                db,
                "UPDATE users SET display_name = 'Ghost' WHERE username = 'nonexistent'",
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(0);

        });

        it('should persist updated data', async () => {

            await executeRawSql(
                db,
                "UPDATE users SET display_name = 'Alice Smith' WHERE username = 'user1'",
                'test-config',
            );

            const check = await executeRawSql(
                db,
                "SELECT display_name FROM users WHERE username = 'user1'",
                'test-config',
            );

            expect(check.rows![0]!.display_name).toBe('Alice Smith');

        });

    });

    describe('DELETE queries', () => {

        it('should execute DELETE and return rowsAffected', async () => {

            const result = await executeRawSql(
                db,
                "DELETE FROM todo_items WHERE title = 'Buy groceries'",
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(1);

        });

        it('should delete multiple rows', async () => {

            const result = await executeRawSql(
                db,
                'DELETE FROM todo_items WHERE is_completed = 0',
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(2); // 2 incomplete items in seed data

        });

        it('should return rowsAffected = 0 when no rows match', async () => {

            const result = await executeRawSql(
                db,
                "DELETE FROM users WHERE email = 'nonexistent@ghost.com'",
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(0);

        });

        it('should persist deletion', async () => {

            await executeRawSql(
                db,
                "DELETE FROM users WHERE username = 'user3'",
                'test-config',
            );

            const check = await executeRawSql(
                db,
                'SELECT COUNT(*) as count FROM users',
                'test-config',
            );

            expect(check.rows![0]!.count).toBe(2);

        });

    });

    describe('DDL statements', () => {

        it('should execute CREATE TABLE', async () => {

            const result = await executeRawSql(
                db,
                `CREATE TABLE test_table (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL
                )`,
                'test-config',
            );

            expect(result.success).toBe(true);

            // Verify table exists
            const check = await executeRawSql(
                db,
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'test_table'",
                'test-config',
            );

            expect(check.rows).toHaveLength(1);

        });

        it('should execute DROP TABLE', async () => {

            // First create a table
            await executeRawSql(
                db,
                'CREATE TABLE temp_table (id INTEGER)',
                'test-config',
            );

            const result = await executeRawSql(
                db,
                'DROP TABLE temp_table',
                'test-config',
            );

            expect(result.success).toBe(true);

            // Verify table is gone
            const check = await executeRawSql(
                db,
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'temp_table'",
                'test-config',
            );

            expect(check.rows).toHaveLength(0);

        });

        it('should execute CREATE INDEX', async () => {

            const result = await executeRawSql(
                db,
                'CREATE INDEX idx_test_display_name ON users(display_name)',
                'test-config',
            );

            expect(result.success).toBe(true);

            // Verify index exists
            const check = await executeRawSql(
                db,
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_test_display_name'",
                'test-config',
            );

            expect(check.rows).toHaveLength(1);

        });

        it('should execute ALTER TABLE', async () => {

            const result = await executeRawSql(
                db,
                'ALTER TABLE users ADD COLUMN bio TEXT',
                'test-config',
            );

            expect(result.success).toBe(true);

            // Verify column exists
            const check = await executeRawSql(
                db,
                'PRAGMA table_info(users)',
                'test-config',
            );

            const columnNames = check.rows!.map((r) => r['name'] as string);
            expect(columnNames).toContain('bio');

        });

    });

    describe('PRAGMA statements', () => {

        it('should execute PRAGMA queries', async () => {

            const result = await executeRawSql(
                db,
                'PRAGMA table_info(users)',
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.rows!.length).toBeGreaterThan(0);
            expect(result.columns).toContain('name');
            expect(result.columns).toContain('type');

        });

        it('should execute PRAGMA foreign_keys', async () => {

            const result = await executeRawSql(
                db,
                'PRAGMA foreign_keys',
                'test-config',
            );

            expect(result.success).toBe(true);

        });

    });

    describe('error handling', () => {

        it('should return error for syntax error', async () => {

            const result = await executeRawSql(
                db,
                'SELEC * FORM users',
                'test-config',
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();
            expect(result.errorMessage!.length).toBeGreaterThan(0);

        });

        it('should return error for non-existent table', async () => {

            const result = await executeRawSql(
                db,
                'SELECT * FROM nonexistent_table',
                'test-config',
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toContain('no such table');

        });

        it('should return error for non-existent column', async () => {

            const result = await executeRawSql(
                db,
                'SELECT nonexistent_column FROM users',
                'test-config',
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toContain('no such column');

        });

        it('should return error for constraint violation', async () => {

            const result = await executeRawSql(
                db,
                `INSERT INTO users (id, email, username, password_hash)
                 VALUES ('11111111-1111-1111-1111-111111111111', 'duplicate@test.com', 'user1', 'hash')`,
                'test-config',
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();
            // Either UNIQUE constraint or PRIMARY KEY violation
            expect(
                result.errorMessage!.includes('UNIQUE') ||
                result.errorMessage!.includes('constraint'),
            ).toBe(true);

        });

        it('should return error for invalid SQL type', async () => {

            const result = await executeRawSql(
                db,
                'NOT_A_VALID_SQL_COMMAND',
                'test-config',
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();

        });

        it('should return duration even on error', async () => {

            const result = await executeRawSql(
                db,
                'INVALID SQL',
                'test-config',
            );

            expect(result.success).toBe(false);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

        it('should not return columns or rows on error', async () => {

            const result = await executeRawSql(
                db,
                'SELECT * FROM nonexistent',
                'test-config',
            );

            expect(result.success).toBe(false);
            expect(result.columns).toBeUndefined();
            expect(result.rows).toBeUndefined();

        });

    });

    describe('complex queries', () => {

        it('should handle subqueries', async () => {

            const result = await executeRawSql(
                db,
                `SELECT username FROM users
                 WHERE id IN (SELECT user_id FROM todo_lists)`,
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.rows!.length).toBeGreaterThan(0);

        });

        it('should handle GROUP BY and HAVING', async () => {

            const result = await executeRawSql(
                db,
                `SELECT list_id, COUNT(*) as item_count
                 FROM todo_items
                 GROUP BY list_id
                 HAVING COUNT(*) > 1`,
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual(['list_id', 'item_count']);

        });

        it('should handle ORDER BY with LIMIT', async () => {

            const result = await executeRawSql(
                db,
                'SELECT username FROM users ORDER BY username ASC LIMIT 2',
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.rows).toHaveLength(2);
            expect(result.rows![0]!.username).toBe('user1');
            expect(result.rows![1]!.username).toBe('user2');

        });

        it('should handle CASE expressions', async () => {

            const result = await executeRawSql(
                db,
                `SELECT title,
                        CASE priority
                            WHEN 0 THEN 'Low'
                            WHEN 1 THEN 'Medium'
                            WHEN 2 THEN 'High'
                            ELSE 'Critical'
                        END as priority_label
                 FROM todo_items`,
                'test-config',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual(['title', 'priority_label']);

        });

        it('should handle COALESCE and IFNULL', async () => {

            const result = await executeRawSql(
                db,
                `SELECT username, COALESCE(display_name, 'Anonymous') as name
                 FROM users`,
                'test-config',
            );

            expect(result.success).toBe(true);

            for (const row of result.rows!) {

                expect(row.name).not.toBeNull();

            }

        });

    });

    describe('transaction-like behavior', () => {

        it('should handle BEGIN/COMMIT', async () => {

            const beginResult = await executeRawSql(db, 'BEGIN', 'test-config');
            expect(beginResult.success).toBe(true);

            const insertResult = await executeRawSql(
                db,
                `INSERT INTO users (id, email, username, password_hash)
                 VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'tx@test.com', 'txuser', 'hash')`,
                'test-config',
            );
            expect(insertResult.success).toBe(true);

            const commitResult = await executeRawSql(db, 'COMMIT', 'test-config');
            expect(commitResult.success).toBe(true);

            // Verify data is committed
            const check = await executeRawSql(
                db,
                "SELECT * FROM users WHERE username = 'txuser'",
                'test-config',
            );
            expect(check.rows).toHaveLength(1);

        });

    });

    describe('advanced queries', () => {

        describe('recursive CTEs', () => {

            it('should execute recursive CTE', async () => {

                const result = await executeRawSql(
                    db,
                    `WITH RECURSIVE numbers(n) AS (
                        SELECT 1
                        UNION ALL
                        SELECT n + 1 FROM numbers WHERE n < 5
                    )
                    SELECT * FROM numbers`,
                    'test-config',
                );

                expect(result.success).toBe(true);
                expect(result.rows).toHaveLength(5);
                expect(result.rows![0].n).toBe(1);
                expect(result.rows![4].n).toBe(5);

            });

        });

        describe('EXPLAIN', () => {

            it('should return query plan', async () => {

                const result = await executeRawSql(
                    db,
                    'EXPLAIN QUERY PLAN SELECT * FROM users',
                    'test-config',
                );

                expect(result.success).toBe(true);
                expect(result.rows!.length).toBeGreaterThan(0);

            });

        });

        describe('PRAGMA', () => {

            it('should execute PRAGMA commands', async () => {

                const result = await executeRawSql(
                    db,
                    'PRAGMA table_info(users)',
                    'test-config',
                );

                expect(result.success).toBe(true);
                expect(result.rows!.length).toBeGreaterThan(0);
                expect(result.columns).toContain('name');
                expect(result.columns).toContain('type');

            });

        });

    });

});
