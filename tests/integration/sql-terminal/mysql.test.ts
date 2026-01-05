/**
 * MySQL SQL Terminal Integration Tests.
 *
 * Tests SQL execution against a real MySQL database.
 * Requires MySQL container running on port 13306.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';

import { executeRawSql } from '../../../src/core/sql-terminal/executor.js';
import {
    createTestConnection,
    deployTestSchema,
    seedTestData,
    resetTestData,
    teardownTestSchema,
    skipIfNoContainer,
} from '../../utils/db.js';

describe('integration: mysql sql-terminal', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;
    const configName = 'mysql-test';

    beforeAll(async () => {

        await skipIfNoContainer('mysql');

        const conn = await createTestConnection('mysql');
        db = conn.db;
        destroy = conn.destroy;

        // Clean slate
        await teardownTestSchema(db, 'mysql');
        await deployTestSchema(db, 'mysql');
        await seedTestData(db, 'mysql');

    });

    afterAll(async () => {

        if (destroy) {

            await teardownTestSchema(db, 'mysql');
            await destroy();

        }

    });

    beforeEach(async () => {

        await resetTestData(db, 'mysql');
        await seedTestData(db, 'mysql');

    });

    describe('SELECT queries', () => {

        it('should return correct columns for simple SELECT', async () => {

            const result = await executeRawSql(
                db,
                'SELECT id, email, username FROM users',
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual(['id', 'email', 'username']);

        });

        it('should return correct row count', async () => {

            const result = await executeRawSql(
                db,
                'SELECT * FROM users',
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rows).toHaveLength(3);

        });

        it('should return correct row data', async () => {

            const result = await executeRawSql(
                db,
                'SELECT email, username FROM users ORDER BY username',
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rows![0]).toHaveProperty('email');
            expect(result.rows![0]).toHaveProperty('username');

            const emails = result.rows!.map((r) => r.email);
            expect(emails).toContain('user1@test.com');
            expect(emails).toContain('user2@test.com');
            expect(emails).toContain('user3@test.com');

        });

        it('should handle SELECT with WHERE clause', async () => {

            const result = await executeRawSql(
                db,
                "SELECT * FROM users WHERE email = 'user1@test.com'",
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rows).toHaveLength(1);
            expect(result.rows![0].email).toBe('user1@test.com');

        });

        it('should handle SELECT with JOIN', async () => {

            const result = await executeRawSql(
                db,
                `SELECT u.username, tl.title
                 FROM users u
                 INNER JOIN todo_lists tl ON tl.user_id = u.id
                 ORDER BY u.username, tl.title`,
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual(['username', 'title']);
            expect(result.rows!.length).toBeGreaterThan(0);

        });

        it('should handle SELECT with LIMIT', async () => {

            const result = await executeRawSql(
                db,
                'SELECT * FROM users LIMIT 2',
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rows).toHaveLength(2);

        });

        it('should handle SELECT with aggregate functions', async () => {

            const result = await executeRawSql(
                db,
                'SELECT COUNT(*) as total, MAX(priority) as max_priority FROM todo_items',
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.columns).toContain('total');
            expect(result.columns).toContain('max_priority');
            expect(result.rows).toHaveLength(1);

        });

        it('should handle SELECT from views', async () => {

            const result = await executeRawSql(
                db,
                'SELECT * FROM v_active_users',
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rows!.length).toBeGreaterThan(0);

        });

        it('should handle empty result set', async () => {

            const result = await executeRawSql(
                db,
                "SELECT * FROM users WHERE email = 'nonexistent@test.com'",
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rows).toHaveLength(0);
            expect(result.columns).toEqual([]);

        });

        it('should include duration in result', async () => {

            const result = await executeRawSql(
                db,
                'SELECT * FROM users',
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.durationMs).toBeDefined();
            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

    });

    describe('INSERT queries', () => {

        it('should return rowsAffected for single INSERT', async () => {

            const result = await executeRawSql(
                db,
                `INSERT INTO users (id, email, username, password_hash, display_name)
                 VALUES (UUID(), 'new@test.com', 'newuser', 'hash123', 'New User')`,
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(1);

        });

        it('should return rowsAffected for multiple INSERT', async () => {

            const result = await executeRawSql(
                db,
                `INSERT INTO users (id, email, username, password_hash, display_name) VALUES
                 (UUID(), 'batch1@test.com', 'batch1', 'hash1', 'Batch 1'),
                 (UUID(), 'batch2@test.com', 'batch2', 'hash2', 'Batch 2')`,
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(2);

        });

        it('should handle INSERT with all columns', async () => {

            const result = await executeRawSql(
                db,
                `INSERT INTO users (
                    id, email, username, password_hash, display_name, avatar_url
                 ) VALUES (
                    UUID(), 'full@test.com', 'fulluser', 'hash', 'Full User', 'https://example.com/avatar.png'
                 )`,
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(1);

        });

    });

    describe('UPDATE queries', () => {

        it('should return rowsAffected for UPDATE', async () => {

            const result = await executeRawSql(
                db,
                "UPDATE users SET display_name = 'Updated Name' WHERE email = 'user1@test.com'",
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(1);

        });

        it('should return rowsAffected for UPDATE affecting multiple rows', async () => {

            const result = await executeRawSql(
                db,
                "UPDATE users SET display_name = 'Bulk Update'",
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(3);

        });

        it('should return 0 rowsAffected when no rows match', async () => {

            const result = await executeRawSql(
                db,
                "UPDATE users SET display_name = 'No Match' WHERE email = 'nonexistent@test.com'",
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(0);

        });

    });

    describe('DELETE queries', () => {

        it('should return rowsAffected for DELETE', async () => {

            const result = await executeRawSql(
                db,
                "DELETE FROM todo_items WHERE title = 'Buy groceries'",
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(1);

        });

        it('should return rowsAffected for DELETE affecting multiple rows', async () => {

            const result = await executeRawSql(
                db,
                'DELETE FROM todo_items',
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(3);

        });

        it('should return 0 rowsAffected when no rows match', async () => {

            const result = await executeRawSql(
                db,
                "DELETE FROM users WHERE email = 'nonexistent@test.com'",
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(0);

        });

    });

    describe('DDL statements', () => {

        it('should execute CREATE TABLE successfully', async () => {

            const result = await executeRawSql(
                db,
                `CREATE TABLE test_ddl (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    name VARCHAR(100) NOT NULL
                )`,
                configName,
            );

            expect(result.success).toBe(true);

            // Cleanup
            await executeRawSql(db, 'DROP TABLE test_ddl', configName);

        });

        it('should execute DROP TABLE successfully', async () => {

            // Create table first
            await executeRawSql(
                db,
                'CREATE TABLE test_drop (id INT PRIMARY KEY)',
                configName,
            );

            const result = await executeRawSql(
                db,
                'DROP TABLE test_drop',
                configName,
            );

            expect(result.success).toBe(true);

        });

        it('should execute ALTER TABLE successfully', async () => {

            // Create table first
            await executeRawSql(
                db,
                'CREATE TABLE test_alter (id INT PRIMARY KEY)',
                configName,
            );

            const result = await executeRawSql(
                db,
                'ALTER TABLE test_alter ADD COLUMN name VARCHAR(100)',
                configName,
            );

            expect(result.success).toBe(true);

            // Cleanup
            await executeRawSql(db, 'DROP TABLE test_alter', configName);

        });

        it('should execute CREATE INDEX successfully', async () => {

            // Create table first
            await executeRawSql(
                db,
                'CREATE TABLE test_index (id INT PRIMARY KEY, name VARCHAR(100))',
                configName,
            );

            const result = await executeRawSql(
                db,
                'CREATE INDEX idx_test_name ON test_index (name)',
                configName,
            );

            expect(result.success).toBe(true);

            // Cleanup
            await executeRawSql(db, 'DROP TABLE test_index', configName);

        });

    });

    describe('error handling', () => {

        it('should return error for syntax error', async () => {

            const result = await executeRawSql(
                db,
                'SELEC * FROM users',
                configName,
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();
            expect(result.errorMessage!.length).toBeGreaterThan(0);

        });

        it('should return error for non-existent table', async () => {

            const result = await executeRawSql(
                db,
                'SELECT * FROM nonexistent_table',
                configName,
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();
            expect(result.errorMessage!.toLowerCase()).toContain("doesn't exist");

        });

        it('should return error for non-existent column', async () => {

            const result = await executeRawSql(
                db,
                'SELECT nonexistent_column FROM users',
                configName,
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();

        });

        it('should return error for constraint violation', async () => {

            const result = await executeRawSql(
                db,
                `INSERT INTO users (id, email, username, password_hash)
                 VALUES (UUID(), 'user1@test.com', 'duplicate', 'hash')`,
                configName,
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();
            expect(result.errorMessage!.toLowerCase()).toContain('duplicate');

        });

        it('should return error for foreign key violation', async () => {

            const result = await executeRawSql(
                db,
                `INSERT INTO todo_lists (id, user_id, title)
                 VALUES (UUID(), 'nonexistent-user-id-123', 'Test List')`,
                configName,
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();

        });

        it('should include duration even on error', async () => {

            const result = await executeRawSql(
                db,
                'INVALID SQL QUERY',
                configName,
            );

            expect(result.success).toBe(false);
            expect(result.durationMs).toBeDefined();
            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

    });

    describe('MySQL-specific features', () => {

        it('should handle SHOW statements', async () => {

            const result = await executeRawSql(
                db,
                'SHOW TABLES',
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rows!.length).toBeGreaterThan(0);

        });

        it('should handle DESCRIBE statement', async () => {

            const result = await executeRawSql(
                db,
                'DESCRIBE users',
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rows!.length).toBeGreaterThan(0);

        });

        it('should handle CALL procedure', async () => {

            const result = await executeRawSql(
                db,
                "CALL get_user_by_email('user1@test.com')",
                configName,
            );

            expect(result.success).toBe(true);

        });

        it('should handle MySQL date functions', async () => {

            const result = await executeRawSql(
                db,
                'SELECT NOW() as `current_time`, CURDATE() as `current_date`',
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.columns).toContain('current_time');
            expect(result.columns).toContain('current_date');

        });

        it('should handle MySQL string functions', async () => {

            const result = await executeRawSql(
                db,
                "SELECT CONCAT(username, ' <', email, '>') as formatted FROM users LIMIT 1",
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.rows![0].formatted).toContain('<');
            expect(result.rows![0].formatted).toContain('>');

        });

        it('should handle backtick-quoted identifiers', async () => {

            const result = await executeRawSql(
                db,
                'SELECT `id`, `email` FROM `users` LIMIT 1',
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual(['id', 'email']);

        });

        it('should handle IF expression', async () => {

            const result = await executeRawSql(
                db,
                'SELECT IF(is_completed, \'Done\', \'Pending\') as status FROM todo_items',
                configName,
            );

            expect(result.success).toBe(true);
            expect(result.columns).toContain('status');

        });

    });

    describe('advanced queries', () => {

        describe('recursive CTEs', () => {

            it('should execute recursive CTE', async () => {

                const result = await executeRawSql(
                    db,
                    `WITH RECURSIVE numbers AS (
                        SELECT 1 AS n
                        UNION ALL
                        SELECT n + 1 FROM numbers WHERE n < 5
                    )
                    SELECT * FROM numbers`,
                    configName,
                );

                expect(result.success).toBe(true);
                expect(result.rows).toHaveLength(5);
                expect(result.rows![0].n).toBe(1);
                expect(result.rows![4].n).toBe(5);

            });

        });

        describe('EXPLAIN', () => {

            it('should return execution plan', async () => {

                const result = await executeRawSql(
                    db,
                    'EXPLAIN SELECT * FROM users',
                    configName,
                );

                expect(result.success).toBe(true);
                expect(result.rows!.length).toBeGreaterThan(0);

            });

        });

    });

});
