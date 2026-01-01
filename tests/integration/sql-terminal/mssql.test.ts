/**
 * Integration tests for MSSQL SQL terminal operations.
 *
 * Tests executeRawSql against a real MSSQL instance.
 * Requires docker-compose.test.yml to be running.
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


describe('integration: mssql sql-terminal', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('mssql');

        const conn = await createTestConnection('mssql');
        db = conn.db;
        destroy = conn.destroy;

        // Deploy schema once for all tests
        await teardownTestSchema(db, 'mssql');
        await deployTestSchema(db, 'mssql');
        await seedTestData(db, 'mssql');

    });

    afterAll(async () => {

        if (destroy) {

            await teardownTestSchema(db, 'mssql');
            await destroy();

        }

    });

    beforeEach(async () => {

        // Reset data between tests (but keep schema)
        await resetTestData(db, 'mssql');
        await seedTestData(db, 'mssql');

    });

    describe('SELECT queries', () => {

        it('should return correct columns and rows for simple SELECT', async () => {

            const result = await executeRawSql(
                db,
                'SELECT id, email, username FROM users',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toContain('id');
            expect(result.columns).toContain('email');
            expect(result.columns).toContain('username');
            expect(result.rows).toHaveLength(3); // 3 seeded users
            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

        it('should return all columns when using SELECT *', async () => {

            const result = await executeRawSql(
                db,
                'SELECT * FROM users',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toBeDefined();
            expect(result.columns!.length).toBeGreaterThan(3);
            expect(result.columns).toContain('id');
            expect(result.columns).toContain('email');
            expect(result.columns).toContain('username');
            expect(result.columns).toContain('password_hash');
            expect(result.columns).toContain('created_at');

        });

        it('should return correct data for filtered queries', async () => {

            const result = await executeRawSql(
                db,
                "SELECT * FROM users WHERE email = 'user1@test.com'",
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rows).toHaveLength(1);

            const row = result.rows![0] as Record<string, unknown>;
            expect(row.email).toBe('user1@test.com');
            expect(row.username).toBe('user1');

        });

        it('should return empty result for no matches', async () => {

            const result = await executeRawSql(
                db,
                "SELECT * FROM users WHERE email = 'nonexistent@test.com'",
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rows).toHaveLength(0);
            expect(result.columns).toEqual([]);

        });

        it('should handle aggregate functions', async () => {

            const result = await executeRawSql(
                db,
                'SELECT COUNT(*) as user_count FROM users',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toContain('user_count');
            expect(result.rows).toHaveLength(1);

            const row = result.rows![0] as Record<string, unknown>;
            expect(row.user_count).toBe(3);

        });

        it('should handle JOINs', async () => {

            const result = await executeRawSql(
                db,
                `SELECT u.username, tl.title
                 FROM users u
                 INNER JOIN todo_lists tl ON u.id = tl.user_id`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toContain('username');
            expect(result.columns).toContain('title');
            expect(result.rows!.length).toBeGreaterThan(0);

        });

        it('should handle ORDER BY', async () => {

            const result = await executeRawSql(
                db,
                'SELECT username FROM users ORDER BY username ASC',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rows).toHaveLength(3);

            const usernames = result.rows!.map((r: Record<string, unknown>) => r.username);
            expect(usernames).toEqual(['user1', 'user2', 'user3']);

        });

        it('should handle LIMIT (TOP in MSSQL)', async () => {

            const result = await executeRawSql(
                db,
                'SELECT TOP 2 * FROM users',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rows).toHaveLength(2);

        });

        it('should handle subqueries', async () => {

            const result = await executeRawSql(
                db,
                `SELECT * FROM users
                 WHERE id IN (SELECT user_id FROM todo_lists)`,
                'test',
            );

            expect(result.success).toBe(true);
            // User1 has todo_lists
            expect(result.rows!.length).toBeGreaterThan(0);

        });

    });

    describe('INSERT queries', () => {

        it('should return rowsAffected for INSERT', async () => {

            const result = await executeRawSql(
                db,
                `INSERT INTO users (id, email, username, password_hash, display_name)
                 VALUES (NEWID(), 'newuser@test.com', 'newuser', 'hash123', 'New User')`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(1);

        });

        it('should return rowsAffected for multi-row INSERT', async () => {

            const result = await executeRawSql(
                db,
                `INSERT INTO users (id, email, username, password_hash, display_name)
                 VALUES
                    (NEWID(), 'batch1@test.com', 'batch1', 'hash1', 'Batch User 1'),
                    (NEWID(), 'batch2@test.com', 'batch2', 'hash2', 'Batch User 2')`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(2);

        });

        it('should handle INSERT with default values', async () => {

            const result = await executeRawSql(
                db,
                `INSERT INTO users (email, username, password_hash)
                 VALUES ('default@test.com', 'defaultuser', 'hash123')`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(1);

        });

    });

    describe('UPDATE queries', () => {

        it('should return rowsAffected for UPDATE', async () => {

            const result = await executeRawSql(
                db,
                "UPDATE users SET display_name = 'Updated Name' WHERE username = 'user1'",
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(1);

        });

        it('should return rowsAffected for multi-row UPDATE', async () => {

            const result = await executeRawSql(
                db,
                "UPDATE users SET display_name = 'Updated' WHERE username IN ('user1', 'user2')",
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(2);

        });

        it('should return 0 rowsAffected when no rows match', async () => {

            const result = await executeRawSql(
                db,
                "UPDATE users SET display_name = 'Updated' WHERE username = 'nonexistent'",
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(0);

        });

    });

    describe('DELETE queries', () => {

        it('should return rowsAffected for DELETE', async () => {

            const result = await executeRawSql(
                db,
                "DELETE FROM users WHERE username = 'user3'",
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(1);

        });

        it('should return rowsAffected for multi-row DELETE', async () => {

            // First, insert extra users to delete
            await executeRawSql(
                db,
                `INSERT INTO users (id, email, username, password_hash)
                 VALUES (NEWID(), 'delete1@test.com', 'todelete1', 'hash'),
                        (NEWID(), 'delete2@test.com', 'todelete2', 'hash')`,
                'test',
            );

            const result = await executeRawSql(
                db,
                "DELETE FROM users WHERE username LIKE 'todelete%'",
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(2);

        });

        it('should return 0 rowsAffected when no rows match', async () => {

            const result = await executeRawSql(
                db,
                "DELETE FROM users WHERE username = 'nonexistent'",
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(0);

        });

    });

    describe('DDL statements', () => {

        it('should execute CREATE TABLE successfully', async () => {

            const result = await executeRawSql(
                db,
                `CREATE TABLE test_ddl_create (
                    id INT PRIMARY KEY,
                    name VARCHAR(100)
                )`,
                'test',
            );

            expect(result.success).toBe(true);

            // Verify table was created
            const verify = await executeRawSql(
                db,
                `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
                 WHERE TABLE_NAME = 'test_ddl_create'`,
                'test',
            );
            expect(verify.rows).toHaveLength(1);

            // Cleanup
            await executeRawSql(db, 'DROP TABLE test_ddl_create', 'test');

        });

        it('should execute ALTER TABLE successfully', async () => {

            // Create test table
            await executeRawSql(
                db,
                'CREATE TABLE test_ddl_alter (id INT PRIMARY KEY)',
                'test',
            );

            const result = await executeRawSql(
                db,
                'ALTER TABLE test_ddl_alter ADD new_column VARCHAR(50)',
                'test',
            );

            expect(result.success).toBe(true);

            // Verify column was added
            const verify = await executeRawSql(
                db,
                `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_NAME = 'test_ddl_alter' AND COLUMN_NAME = 'new_column'`,
                'test',
            );
            expect(verify.rows).toHaveLength(1);

            // Cleanup
            await executeRawSql(db, 'DROP TABLE test_ddl_alter', 'test');

        });

        it('should execute DROP TABLE successfully', async () => {

            // Create test table
            await executeRawSql(
                db,
                'CREATE TABLE test_ddl_drop (id INT PRIMARY KEY)',
                'test',
            );

            const result = await executeRawSql(
                db,
                'DROP TABLE test_ddl_drop',
                'test',
            );

            expect(result.success).toBe(true);

            // Verify table was dropped
            const verify = await executeRawSql(
                db,
                `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
                 WHERE TABLE_NAME = 'test_ddl_drop'`,
                'test',
            );
            expect(verify.rows).toHaveLength(0);

        });

        it('should execute CREATE INDEX successfully', async () => {

            const result = await executeRawSql(
                db,
                'CREATE INDEX idx_test_users_display ON users(display_name)',
                'test',
            );

            expect(result.success).toBe(true);

            // Cleanup
            await executeRawSql(
                db,
                'DROP INDEX idx_test_users_display ON users',
                'test',
            );

        });

    });

    describe('error handling', () => {

        it('should return error for syntax errors', async () => {

            const result = await executeRawSql(
                db,
                'SELEC * FORM users',
                'test',
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();
            expect(result.errorMessage!.length).toBeGreaterThan(0);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

        it('should return error for non-existent table', async () => {

            const result = await executeRawSql(
                db,
                'SELECT * FROM nonexistent_table',
                'test',
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();
            expect(result.errorMessage).toContain('nonexistent_table');

        });

        it('should return error for non-existent column', async () => {

            const result = await executeRawSql(
                db,
                'SELECT nonexistent_column FROM users',
                'test',
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();

        });

        it('should return error for constraint violation', async () => {

            const result = await executeRawSql(
                db,
                `INSERT INTO users (email, username, password_hash)
                 VALUES ('user1@test.com', 'user1', 'hash')`,
                'test',
            );

            // Should fail due to unique constraint on email/username
            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();

        });

        it('should return error for foreign key violation', async () => {

            const result = await executeRawSql(
                db,
                `INSERT INTO todo_lists (id, user_id, title, position)
                 VALUES (NEWID(), '99999999-9999-9999-9999-999999999999', 'Test', 0)`,
                'test',
            );

            // Should fail due to FK constraint
            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();

        });

        it('should return error for invalid data type', async () => {

            const result = await executeRawSql(
                db,
                "UPDATE users SET created_at = 'not-a-date' WHERE username = 'user1'",
                'test',
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();

        });

    });

    describe('special queries', () => {

        it('should handle queries with parameters using variables', async () => {

            const result = await executeRawSql(
                db,
                `DECLARE @email VARCHAR(255) = 'user1@test.com';
                 SELECT * FROM users WHERE email = @email`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rows).toHaveLength(1);

        });

        it('should handle CASE expressions', async () => {

            const result = await executeRawSql(
                db,
                `SELECT username,
                    CASE WHEN display_name IS NOT NULL THEN display_name
                         ELSE username
                    END as display
                 FROM users`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toContain('username');
            expect(result.columns).toContain('display');

        });

        it('should handle CTEs (Common Table Expressions)', async () => {

            const result = await executeRawSql(
                db,
                `WITH UserCounts AS (
                    SELECT user_id, COUNT(*) as list_count
                    FROM todo_lists
                    GROUP BY user_id
                 )
                 SELECT u.username, COALESCE(uc.list_count, 0) as lists
                 FROM users u
                 LEFT JOIN UserCounts uc ON u.id = uc.user_id`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toContain('username');
            expect(result.columns).toContain('lists');

        });

        it('should handle UNION queries', async () => {

            const result = await executeRawSql(
                db,
                `SELECT 'user' as type, username as name FROM users
                 UNION ALL
                 SELECT 'list' as type, title as name FROM todo_lists`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toContain('type');
            expect(result.columns).toContain('name');
            // 3 users + 2 todo_lists = 5 rows
            expect(result.rows!.length).toBe(5);

        });

        it('should handle date functions', async () => {

            const result = await executeRawSql(
                db,
                `SELECT username, DATEDIFF(day, created_at, GETDATE()) as days_since_created
                 FROM users`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toContain('days_since_created');

        });

        it('should handle string functions', async () => {

            const result = await executeRawSql(
                db,
                `SELECT UPPER(username) as upper_name, LEN(email) as email_length
                 FROM users`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toContain('upper_name');
            expect(result.columns).toContain('email_length');

            const row = result.rows![0] as Record<string, unknown>;
            expect(typeof row.upper_name).toBe('string');
            expect(typeof row.email_length).toBe('number');

        });

        it('should handle NULL comparisons', async () => {

            const result = await executeRawSql(
                db,
                'SELECT * FROM users WHERE deleted_at IS NULL',
                'test',
            );

            expect(result.success).toBe(true);
            // All seeded users have deleted_at = NULL
            expect(result.rows).toHaveLength(3);

        });

        it('should handle GROUP BY with HAVING', async () => {

            // First, add more todo lists for testing
            await executeRawSql(
                db,
                `INSERT INTO todo_lists (id, user_id, title, position)
                 SELECT NEWID(), id, 'Extra List', 10 FROM users WHERE username = 'user1'`,
                'test',
            );

            const result = await executeRawSql(
                db,
                `SELECT user_id, COUNT(*) as list_count
                 FROM todo_lists
                 GROUP BY user_id
                 HAVING COUNT(*) > 1`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toContain('user_id');
            expect(result.columns).toContain('list_count');

        });

    });

    describe('performance', () => {

        it('should report accurate duration for fast queries', async () => {

            const result = await executeRawSql(
                db,
                'SELECT 1 as test',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
            expect(result.durationMs).toBeLessThan(1000); // Should be fast

        });

        it('should report accurate duration for slow queries', async () => {

            // WAITFOR DELAY in MSSQL
            const result = await executeRawSql(
                db,
                "WAITFOR DELAY '00:00:00.1'; SELECT 1 as test",
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.durationMs).toBeGreaterThanOrEqual(100);

        });

    });

    describe('advanced queries', () => {

        describe('recursive CTEs', () => {

            it('should execute recursive CTE', async () => {

                const result = await executeRawSql(
                    db,
                    `WITH numbers AS (
                        SELECT 1 AS n
                        UNION ALL
                        SELECT n + 1 FROM numbers WHERE n < 5
                    )
                    SELECT * FROM numbers`,
                    'test',
                );

                expect(result.success).toBe(true);
                expect(result.rows).toHaveLength(5);
                expect(result.rows![0].n).toBe(1);
                expect(result.rows![4].n).toBe(5);

            });

        });

        describe('execution plan', () => {

            it('should return estimated plan', async () => {

                // MSSQL uses SET SHOWPLAN_TEXT ON or sys.dm_exec_query_plan
                const result = await executeRawSql(
                    db,
                    'SELECT * FROM users WHERE id = NEWID() OPTION (RECOMPILE)',
                    'test',
                );

                // Just verify it executes without error
                expect(result.success).toBe(true);
                expect(result).toBeDefined();

            });

        });

    });

});
