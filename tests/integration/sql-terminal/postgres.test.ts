/**
 * Integration tests for PostgreSQL sql-terminal operations.
 *
 * Tests executeRawSql against a real PostgreSQL database.
 * Requires docker-compose.test.yml containers to be running.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';

import { executeRawSql } from '../../../src/core/sql-terminal/executor.js';
import { observer } from '../../../src/core/observer.js';
import {
    createTestConnection,
    deployTestSchema,
    seedTestData,
    resetTestData,
    teardownTestSchema,
    skipIfNoContainer,
} from '../../utils/db.js';


describe('integration: postgres sql-terminal', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        const conn = await createTestConnection('postgres');
        db = conn.db;
        destroy = conn.destroy;

        // Clean up any existing schema and deploy fresh
        await teardownTestSchema(db, 'postgres');
        await deployTestSchema(db, 'postgres');

    });

    afterAll(async () => {

        if (destroy) {

            await destroy();

        }

    });

    beforeEach(async () => {

        // Reset data between tests to ensure consistent state
        await resetTestData(db, 'postgres');
        await seedTestData(db, 'postgres');

    });

    describe('SELECT queries', () => {

        it('should return columns and rows for simple SELECT', async () => {

            const result = await executeRawSql(db, 'SELECT id, email, username FROM users', 'test');

            expect(result.success).toBe(true);
            expect(result.columns).toEqual(['id', 'email', 'username']);
            expect(result.rows).toHaveLength(3);

            // Verify row data
            const emails = result.rows!.map((r) => r.email);
            expect(emails).toContain('user1@test.com');
            expect(emails).toContain('user2@test.com');
            expect(emails).toContain('user3@test.com');

        });

        it('should return correct column count for SELECT *', async () => {

            const result = await executeRawSql(db, 'SELECT * FROM users', 'test');

            expect(result.success).toBe(true);
            expect(result.columns).toHaveLength(9); // All columns from users table
            expect(result.columns).toContain('id');
            expect(result.columns).toContain('email');
            expect(result.columns).toContain('created_at');

        });

        it('should return empty array for SELECT with no results', async () => {

            const result = await executeRawSql(
                db,
                "SELECT * FROM users WHERE email = 'nonexistent@test.com'",
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual([]);
            expect(result.rows).toEqual([]);

        });

        it('should handle SELECT with WHERE clause', async () => {

            const result = await executeRawSql(
                db,
                "SELECT * FROM users WHERE email = 'user1@test.com'",
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rows).toHaveLength(1);
            expect(result.rows![0].email).toBe('user1@test.com');
            expect(result.rows![0].username).toBe('user1');

        });

        it('should handle SELECT with JOIN', async () => {

            const result = await executeRawSql(
                db,
                `SELECT u.username, tl.title
                 FROM users u
                 INNER JOIN todo_lists tl ON tl.user_id = u.id`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual(['username', 'title']);
            expect(result.rows).toHaveLength(2); // user1 has 2 todo lists

        });

        it('should handle SELECT with aggregate functions', async () => {

            const result = await executeRawSql(
                db,
                'SELECT COUNT(*) as user_count FROM users',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual(['user_count']);
            expect(result.rows).toHaveLength(1);
            expect(Number(result.rows![0].user_count)).toBe(3);

        });

        it('should handle SELECT with GROUP BY', async () => {

            const result = await executeRawSql(
                db,
                `SELECT u.username, COUNT(tl.id) as list_count
                 FROM users u
                 LEFT JOIN todo_lists tl ON tl.user_id = u.id
                 GROUP BY u.username
                 ORDER BY u.username`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rows!.length).toBeGreaterThan(0);

            const user1 = result.rows!.find((r) => r.username === 'user1');
            expect(Number(user1?.list_count)).toBe(2);

        });

        it('should handle SELECT with ORDER BY and LIMIT', async () => {

            const result = await executeRawSql(
                db,
                'SELECT username FROM users ORDER BY username LIMIT 2',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rows).toHaveLength(2);
            expect(result.rows![0].username).toBe('user1');
            expect(result.rows![1].username).toBe('user2');

        });

        it('should handle SELECT from views', async () => {

            const result = await executeRawSql(
                db,
                'SELECT * FROM v_active_users',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toContain('id');
            expect(result.columns).toContain('email');
            expect(result.rows!.length).toBe(3);

        });

        it('should measure execution duration', async () => {

            const result = await executeRawSql(db, 'SELECT * FROM users', 'test');

            expect(result.success).toBe(true);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
            expect(typeof result.durationMs).toBe('number');

        });

    });

    describe('INSERT statements', () => {

        it('should return rowsAffected for INSERT', async () => {

            const result = await executeRawSql(
                db,
                `INSERT INTO users (email, username, password_hash, display_name)
                 VALUES ('new@test.com', 'newuser', 'hash123', 'New User')`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(1);

            // Verify insert worked
            const verify = await executeRawSql(
                db,
                "SELECT * FROM users WHERE email = 'new@test.com'",
                'test',
            );
            expect(verify.rows).toHaveLength(1);

        });

        it('should return rowsAffected for multi-row INSERT', async () => {

            const result = await executeRawSql(
                db,
                `INSERT INTO users (email, username, password_hash, display_name)
                 VALUES
                     ('multi1@test.com', 'multi1', 'hash1', 'Multi 1'),
                     ('multi2@test.com', 'multi2', 'hash2', 'Multi 2'),
                     ('multi3@test.com', 'multi3', 'hash3', 'Multi 3')`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(3);

        });

        it('should handle INSERT with RETURNING clause', async () => {

            const result = await executeRawSql(
                db,
                `INSERT INTO users (email, username, password_hash, display_name)
                 VALUES ('returning@test.com', 'returnuser', 'hash123', 'Return User')
                 RETURNING id, email, username`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual(['id', 'email', 'username']);
            expect(result.rows).toHaveLength(1);
            expect(result.rows![0].email).toBe('returning@test.com');
            expect(result.rows![0].id).toBeDefined();

        });

    });

    describe('UPDATE statements', () => {

        it('should return rowsAffected for UPDATE', async () => {

            const result = await executeRawSql(
                db,
                "UPDATE users SET display_name = 'Updated Name' WHERE username = 'user1'",
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(1);

            // Verify update worked
            const verify = await executeRawSql(
                db,
                "SELECT display_name FROM users WHERE username = 'user1'",
                'test',
            );
            expect(verify.rows![0].display_name).toBe('Updated Name');

        });

        it('should return rowsAffected for multi-row UPDATE', async () => {

            const result = await executeRawSql(
                db,
                "UPDATE users SET avatar_url = 'https://example.com/avatar.png'",
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(3); // All 3 users

        });

        it('should return 0 rowsAffected for UPDATE with no matches', async () => {

            const result = await executeRawSql(
                db,
                "UPDATE users SET display_name = 'Ghost' WHERE username = 'nonexistent'",
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(0);

        });

        it('should handle UPDATE with RETURNING clause', async () => {

            const result = await executeRawSql(
                db,
                `UPDATE users
                 SET display_name = 'Returned Update'
                 WHERE username = 'user1'
                 RETURNING id, username, display_name`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual(['id', 'username', 'display_name']);
            expect(result.rows).toHaveLength(1);
            expect(result.rows![0].display_name).toBe('Returned Update');

        });

    });

    describe('DELETE statements', () => {

        it('should return rowsAffected for DELETE', async () => {

            const result = await executeRawSql(
                db,
                "DELETE FROM todo_items WHERE title = 'Complete report'",
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(1);

        });

        it('should return rowsAffected for multi-row DELETE', async () => {

            const result = await executeRawSql(
                db,
                'DELETE FROM todo_items',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(3); // All 3 todo items

        });

        it('should return 0 rowsAffected for DELETE with no matches', async () => {

            const result = await executeRawSql(
                db,
                "DELETE FROM users WHERE email = 'nonexistent@test.com'",
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(0);

        });

        it('should handle DELETE with RETURNING clause', async () => {

            const result = await executeRawSql(
                db,
                `DELETE FROM todo_items
                 WHERE title = 'Complete report'
                 RETURNING id, title`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual(['id', 'title']);
            expect(result.rows).toHaveLength(1);
            expect(result.rows![0].title).toBe('Complete report');

        });

    });

    describe('DDL statements', () => {

        it('should execute CREATE TABLE successfully', async () => {

            const result = await executeRawSql(
                db,
                `CREATE TABLE test_ddl_table (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL
                )`,
                'test',
            );

            expect(result.success).toBe(true);

            // Verify table exists
            const verify = await executeRawSql(
                db,
                `SELECT table_name FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'test_ddl_table'`,
                'test',
            );
            expect(verify.rows).toHaveLength(1);

            // Clean up
            await executeRawSql(db, 'DROP TABLE test_ddl_table', 'test');

        });

        it('should execute ALTER TABLE successfully', async () => {

            // Create temp table
            await executeRawSql(
                db,
                'CREATE TABLE test_alter_table (id SERIAL PRIMARY KEY)',
                'test',
            );

            const result = await executeRawSql(
                db,
                'ALTER TABLE test_alter_table ADD COLUMN description TEXT',
                'test',
            );

            expect(result.success).toBe(true);

            // Verify column exists
            const verify = await executeRawSql(
                db,
                `SELECT column_name FROM information_schema.columns
                 WHERE table_name = 'test_alter_table' AND column_name = 'description'`,
                'test',
            );
            expect(verify.rows).toHaveLength(1);

            // Clean up
            await executeRawSql(db, 'DROP TABLE test_alter_table', 'test');

        });

        it('should execute DROP TABLE successfully', async () => {

            // Create temp table
            await executeRawSql(
                db,
                'CREATE TABLE test_drop_table (id SERIAL PRIMARY KEY)',
                'test',
            );

            const result = await executeRawSql(
                db,
                'DROP TABLE test_drop_table',
                'test',
            );

            expect(result.success).toBe(true);

            // Verify table is gone
            const verify = await executeRawSql(
                db,
                `SELECT table_name FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'test_drop_table'`,
                'test',
            );
            expect(verify.rows).toHaveLength(0);

        });

        it('should execute CREATE INDEX successfully', async () => {

            const result = await executeRawSql(
                db,
                'CREATE INDEX test_idx_email ON users (email)',
                'test',
            );

            expect(result.success).toBe(true);

            // Clean up
            await executeRawSql(db, 'DROP INDEX test_idx_email', 'test');

        });

    });

    describe('error handling', () => {

        it('should return error for syntax errors', async () => {

            const result = await executeRawSql(
                db,
                'SELCT * FROM users', // Typo: SELCT
                'test',
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();
            expect(result.errorMessage).toContain('syntax');

        });

        it('should return error for non-existent table', async () => {

            const result = await executeRawSql(
                db,
                'SELECT * FROM nonexistent_table_xyz',
                'test',
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();
            expect(result.errorMessage!.toLowerCase()).toContain('does not exist');

        });

        it('should return error for invalid column reference', async () => {

            const result = await executeRawSql(
                db,
                'SELECT nonexistent_column FROM users',
                'test',
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();
            expect(result.errorMessage!.toLowerCase()).toContain('does not exist');

        });

        it('should return error for constraint violations', async () => {

            const result = await executeRawSql(
                db,
                `INSERT INTO users (email, username, password_hash)
                 VALUES ('user1@test.com', 'duplicate', 'hash')`, // Duplicate email
                'test',
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();
            expect(
                result.errorMessage!.toLowerCase().includes('duplicate') ||
                result.errorMessage!.toLowerCase().includes('unique'),
            ).toBe(true);

        });

        it('should return error for foreign key violations', async () => {

            const result = await executeRawSql(
                db,
                `INSERT INTO todo_lists (user_id, title)
                 VALUES ('99999999-9999-9999-9999-999999999999', 'Orphan List')`,
                'test',
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBeDefined();
            expect(result.errorMessage!.toLowerCase()).toContain('foreign key');

        });

        it('should include duration even on error', async () => {

            const result = await executeRawSql(
                db,
                'INVALID SQL QUERY',
                'test',
            );

            expect(result.success).toBe(false);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

    });

    describe('observer events', () => {

        it('should emit before and after events for SELECT', async () => {

            const events: Array<{ event: string; data: unknown }> = [];

            const beforeCleanup = observer.on('sql-terminal:execute:before', (data) => {

                events.push({ event: 'before', data });

            });

            const afterCleanup = observer.on('sql-terminal:execute:after', (data) => {

                events.push({ event: 'after', data });

            });

            try {

                await executeRawSql(db, 'SELECT * FROM users', 'test-config');

                expect(events.length).toBe(2);

                const beforeEvent = events.find((e) => e.event === 'before');
                expect(beforeEvent).toBeDefined();
                expect((beforeEvent!.data as { query: string }).query).toBe('SELECT * FROM users');
                expect((beforeEvent!.data as { configName: string }).configName).toBe('test-config');

                const afterEvent = events.find((e) => e.event === 'after');
                expect(afterEvent).toBeDefined();
                expect((afterEvent!.data as { success: boolean }).success).toBe(true);
                expect((afterEvent!.data as { rowCount: number }).rowCount).toBe(3);

            }
            finally {

                beforeCleanup();
                afterCleanup();

            }

        });

        it('should emit error details in after event on failure', async () => {

            const events: Array<{ event: string; data: unknown }> = [];

            const beforeCleanup = observer.on('sql-terminal:execute:before', (data) => {

                events.push({ event: 'before', data });

            });

            const afterCleanup = observer.on('sql-terminal:execute:after', (data) => {

                events.push({ event: 'after', data });

            });

            try {

                await executeRawSql(db, 'INVALID QUERY', 'test-config');

                const afterEvent = events.find((e) => e.event === 'after');
                expect(afterEvent).toBeDefined();
                expect((afterEvent!.data as { success: boolean }).success).toBe(false);
                expect((afterEvent!.data as { error: string }).error).toBeDefined();

            }
            finally {

                beforeCleanup();
                afterCleanup();

            }

        });

    });

    describe('special data types', () => {

        it('should handle UUID columns correctly', async () => {

            const result = await executeRawSql(
                db,
                'SELECT id FROM users LIMIT 1',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rows![0].id).toBeDefined();
            // UUID should be a string in format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
            expect(typeof result.rows![0].id).toBe('string');
            expect((result.rows![0].id as string).length).toBe(36);

        });

        it('should handle TIMESTAMPTZ columns correctly', async () => {

            const result = await executeRawSql(
                db,
                'SELECT created_at FROM users LIMIT 1',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rows![0].created_at).toBeDefined();
            // Should be a Date object
            expect(result.rows![0].created_at instanceof Date).toBe(true);

        });

        it('should handle BOOLEAN columns correctly', async () => {

            const result = await executeRawSql(
                db,
                'SELECT is_completed FROM todo_items',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rows!.some((r) => r.is_completed === true)).toBe(true);
            expect(result.rows!.some((r) => r.is_completed === false)).toBe(true);

        });

        it('should handle NULL values correctly', async () => {

            const result = await executeRawSql(
                db,
                'SELECT deleted_at FROM users LIMIT 1',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rows![0].deleted_at).toBeNull();

        });

        it('should handle SMALLINT columns correctly', async () => {

            const result = await executeRawSql(
                db,
                'SELECT priority FROM todo_items LIMIT 1',
                'test',
            );

            expect(result.success).toBe(true);
            expect(typeof result.rows![0].priority).toBe('number');

        });

        it('should handle TEXT columns correctly', async () => {

            const result = await executeRawSql(
                db,
                'SELECT description FROM todo_items WHERE description IS NOT NULL LIMIT 1',
                'test',
            );

            expect(result.success).toBe(true);
            expect(typeof result.rows![0].description).toBe('string');

        });

    });

    describe('complex queries', () => {

        it('should handle CTEs (Common Table Expressions)', async () => {

            const result = await executeRawSql(
                db,
                `WITH user_list_counts AS (
                    SELECT user_id, COUNT(*) as list_count
                    FROM todo_lists
                    GROUP BY user_id
                )
                SELECT u.username, COALESCE(ulc.list_count, 0) as list_count
                FROM users u
                LEFT JOIN user_list_counts ulc ON ulc.user_id = u.id
                ORDER BY u.username`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual(['username', 'list_count']);
            expect(result.rows!.length).toBe(3);

        });

        it('should handle subqueries', async () => {

            const result = await executeRawSql(
                db,
                `SELECT username
                 FROM users
                 WHERE id IN (SELECT user_id FROM todo_lists)`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rows!.length).toBe(1); // Only user1 has todo lists

        });

        it('should handle window functions', async () => {

            const result = await executeRawSql(
                db,
                `SELECT
                    username,
                    ROW_NUMBER() OVER (ORDER BY created_at) as row_num
                 FROM users`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toContain('row_num');
            expect(result.rows!.length).toBe(3);

        });

        it('should handle CASE expressions', async () => {

            const result = await executeRawSql(
                db,
                `SELECT
                    title,
                    CASE priority
                        WHEN 0 THEN 'low'
                        WHEN 1 THEN 'medium'
                        WHEN 2 THEN 'high'
                        ELSE 'urgent'
                    END as priority_label
                 FROM todo_items`,
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toContain('priority_label');

            const labels = result.rows!.map((r) => r.priority_label);
            expect(labels.some((l) => ['low', 'medium', 'high', 'urgent'].includes(l as string))).toBe(true);

        });

    });

    describe('advanced queries', () => {

        describe('recursive CTEs', () => {

            it('should execute recursive CTE for hierarchy traversal', async () => {

                const result = await executeRawSql(
                    db,
                    `WITH RECURSIVE numbers AS (
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

        describe('EXPLAIN', () => {

            it('should return execution plan', async () => {

                const result = await executeRawSql(
                    db,
                    'EXPLAIN SELECT * FROM users',
                    'test',
                );

                expect(result.success).toBe(true);
                expect(result.rows!.length).toBeGreaterThan(0);

            });

        });

        describe('transactions', () => {

            it('should handle explicit BEGIN/COMMIT', async () => {

                await executeRawSql(db, 'BEGIN', 'test');
                await executeRawSql(
                    db,
                    `INSERT INTO users (id, email, username, password_hash)
                     VALUES (gen_random_uuid(), 'tx@test.com', 'txuser', 'hash')`,
                    'test',
                );
                await executeRawSql(db, 'COMMIT', 'test');

                const result = await executeRawSql(
                    db,
                    "SELECT * FROM users WHERE email = 'tx@test.com'",
                    'test',
                );

                expect(result.success).toBe(true);
                expect(result.rows).toHaveLength(1);

            });

            it('should handle ROLLBACK', async () => {

                await executeRawSql(db, 'BEGIN', 'test');
                await executeRawSql(
                    db,
                    `INSERT INTO users (id, email, username, password_hash)
                     VALUES (gen_random_uuid(), 'rollback@test.com', 'rbuser', 'hash')`,
                    'test',
                );
                await executeRawSql(db, 'ROLLBACK', 'test');

                const result = await executeRawSql(
                    db,
                    "SELECT * FROM users WHERE email = 'rollback@test.com'",
                    'test',
                );

                expect(result.success).toBe(true);
                expect(result.rows).toHaveLength(0);

            });

        });

    });

});
