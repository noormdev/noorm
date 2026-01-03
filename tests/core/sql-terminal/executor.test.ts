/**
 * SQL Terminal Executor tests.
 *
 * Tests executeRawSql with mocked database interactions.
 * Verifies observer events, result structure, and error handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Kysely, RawBuilder } from 'kysely';

import { executeRawSql } from '../../../src/core/sql-terminal/executor.js';
import { observer } from '../../../src/core/observer.js';

/**
 * Minimal mock for sql.raw() return value.
 * Only implements the execute method needed for testing.
 */
type MockRawBuilder = Pick<RawBuilder<unknown>, 'execute'>;

/**
 * Event data emitted after SQL execution.
 */
interface ExecuteAfterEventData {
    query: string;
    configName: string;
    success: boolean;
    durationMs: number;
    rowCount?: number;
    rowsAffected?: number;
    error?: string;
}


describe('sql-terminal: executor', () => {

    describe('executeRawSql', () => {

        let mockDb: Kysely<unknown>;
        let mockExecute: ReturnType<typeof vi.fn>;
        let events: Array<{ event: string; data: unknown }>;

        beforeEach(() => {

            // Track all observer events
            events = [];

            const beforeCleanup = observer.on('sql-terminal:execute:before', (data) => {

                events.push({ event: 'before', data });

            });

            const afterCleanup = observer.on('sql-terminal:execute:after', (data) => {

                events.push({ event: 'after', data });

            });

            // Clean up listeners after test
            afterEach(() => {

                beforeCleanup();
                afterCleanup();

            });

            // Mock Kysely execute function
            mockExecute = vi.fn();

            // Mock db structure - sql.raw(query).execute(db) pattern
            mockDb = {} as Kysely<unknown>;

        });

        it('should emit sql-terminal:execute:before with correct data', async () => {

            mockExecute.mockResolvedValue({
                rows: [{ id: 1, name: 'Alice' }],
                numAffectedRows: undefined,
            });

            // Mock sql.raw() - we need to mock the kysely module
            const { sql } = await import('kysely');
            vi.spyOn(sql, 'raw').mockReturnValue({
                execute: mockExecute,
            } as MockRawBuilder);

            await executeRawSql(mockDb, 'SELECT * FROM users', 'production');

            const beforeEvent = events.find((e) => e.event === 'before');
            expect(beforeEvent).toBeDefined();
            expect(beforeEvent!.data).toEqual({
                query: 'SELECT * FROM users',
                configName: 'production',
            });

        });

        it('should emit sql-terminal:execute:after with correct data on success', async () => {

            mockExecute.mockResolvedValue({
                rows: [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                ],
                numAffectedRows: undefined,
            });

            const { sql } = await import('kysely');
            vi.spyOn(sql, 'raw').mockReturnValue({
                execute: mockExecute,
            } as MockRawBuilder);

            await executeRawSql(mockDb, 'SELECT * FROM users', 'production');

            const afterEvent = events.find((e) => e.event === 'after');
            expect(afterEvent).toBeDefined();

            const afterData = afterEvent!.data as ExecuteAfterEventData;
            expect(afterData.query).toBe('SELECT * FROM users');
            expect(afterData.configName).toBe('production');
            expect(afterData.success).toBe(true);
            expect(afterData.rowCount).toBe(2);
            expect(afterData.durationMs).toBeGreaterThanOrEqual(0);
            expect(afterData.rowsAffected).toBeUndefined();

        });

        it('should emit sql-terminal:execute:after with error on failure', async () => {

            const testError = new Error('Connection timeout');
            mockExecute.mockRejectedValue(testError);

            const { sql } = await import('kysely');
            vi.spyOn(sql, 'raw').mockReturnValue({
                execute: mockExecute,
            } as MockRawBuilder);

            await executeRawSql(mockDb, 'SELECT * FROM users', 'production');

            const afterEvent = events.find((e) => e.event === 'after');
            expect(afterEvent).toBeDefined();

            const afterData = afterEvent!.data as ExecuteAfterEventData;
            expect(afterData.query).toBe('SELECT * FROM users');
            expect(afterData.configName).toBe('production');
            expect(afterData.success).toBe(false);
            expect(afterData.error).toBe('Connection timeout');
            expect(afterData.durationMs).toBeGreaterThanOrEqual(0);

        });

        it('should return success=true with columns and rows for SELECT', async () => {

            mockExecute.mockResolvedValue({
                rows: [
                    { id: 1, name: 'Alice', email: 'alice@example.com' },
                    { id: 2, name: 'Bob', email: 'bob@example.com' },
                ],
                numAffectedRows: undefined,
            });

            const { sql } = await import('kysely');
            vi.spyOn(sql, 'raw').mockReturnValue({
                execute: mockExecute,
            } as MockRawBuilder);

            const result = await executeRawSql(
                mockDb,
                'SELECT id, name, email FROM users',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual(['id', 'name', 'email']);
            expect(result.rows).toHaveLength(2);
            expect(result.rows![0]).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
            expect(result.rows![1]).toEqual({ id: 2, name: 'Bob', email: 'bob@example.com' });
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
            expect(result.rowsAffected).toBeUndefined();

        });

        it('should return success=true with rowsAffected for INSERT', async () => {

            mockExecute.mockResolvedValue({
                rows: [],
                numAffectedRows: BigInt(3),
            });

            const { sql } = await import('kysely');
            vi.spyOn(sql, 'raw').mockReturnValue({
                execute: mockExecute,
            } as MockRawBuilder);

            const result = await executeRawSql(
                mockDb,
                'INSERT INTO users (name) VALUES (\'Alice\'), (\'Bob\'), (\'Charlie\')',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual([]);
            expect(result.rows).toEqual([]);
            expect(result.rowsAffected).toBe(3);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

        it('should return success=true with rowsAffected for UPDATE', async () => {

            mockExecute.mockResolvedValue({
                rows: [],
                numAffectedRows: BigInt(5),
            });

            const { sql } = await import('kysely');
            vi.spyOn(sql, 'raw').mockReturnValue({
                execute: mockExecute,
            } as MockRawBuilder);

            const result = await executeRawSql(
                mockDb,
                'UPDATE users SET active = true WHERE id > 10',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(5);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

        it('should return success=true with rowsAffected for DELETE', async () => {

            mockExecute.mockResolvedValue({
                rows: [],
                numAffectedRows: BigInt(2),
            });

            const { sql } = await import('kysely');
            vi.spyOn(sql, 'raw').mockReturnValue({
                execute: mockExecute,
            } as MockRawBuilder);

            const result = await executeRawSql(
                mockDb,
                'DELETE FROM users WHERE id < 5',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.rowsAffected).toBe(2);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);

        });

        it('should return success=false with error message on failure', async () => {

            const testError = new Error('Syntax error near SELECT');
            mockExecute.mockRejectedValue(testError);

            const { sql } = await import('kysely');
            vi.spyOn(sql, 'raw').mockReturnValue({
                execute: mockExecute,
            } as MockRawBuilder);

            const result = await executeRawSql(
                mockDb,
                'SELECT * FORM users',
                'test',
            );

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBe('Syntax error near SELECT');
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
            expect(result.columns).toBeUndefined();
            expect(result.rows).toBeUndefined();

        });

        it('should handle non-Error thrown values', async () => {

            mockExecute.mockRejectedValue('String error');

            const { sql } = await import('kysely');
            vi.spyOn(sql, 'raw').mockReturnValue({
                execute: mockExecute,
            } as MockRawBuilder);

            const result = await executeRawSql(mockDb, 'SELECT 1', 'test');

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBe('String error');

        });

        it('should pass query correctly to sql.raw()', async () => {

            mockExecute.mockResolvedValue({
                rows: [],
                numAffectedRows: undefined,
            });

            const { sql } = await import('kysely');
            const rawSpy = vi.spyOn(sql, 'raw').mockReturnValue({
                execute: mockExecute,
            } as MockRawBuilder);

            const query = 'SELECT * FROM users WHERE id = 42';
            await executeRawSql(mockDb, query, 'test');

            expect(rawSpy).toHaveBeenCalledWith(query);
            expect(mockExecute).toHaveBeenCalledWith(mockDb);

        });

        it('should handle empty result set', async () => {

            mockExecute.mockResolvedValue({
                rows: [],
                numAffectedRows: undefined,
            });

            const { sql } = await import('kysely');
            vi.spyOn(sql, 'raw').mockReturnValue({
                execute: mockExecute,
            } as MockRawBuilder);

            const result = await executeRawSql(
                mockDb,
                'SELECT * FROM users WHERE id = -1',
                'test',
            );

            expect(result.success).toBe(true);
            expect(result.columns).toEqual([]);
            expect(result.rows).toEqual([]);
            expect(result.rowsAffected).toBeUndefined();

        });

        // Note: setTimeout doesn't guarantee exact timing - use lenient threshold
        it('should measure execution duration', { retry: 2 }, async () => {

            mockExecute.mockImplementation(async () => {

                // Simulate query execution time
                await new Promise((resolve) => setTimeout(resolve, 15));

                return {
                    rows: [{ id: 1 }],
                    numAffectedRows: undefined,
                };

            });

            const { sql } = await import('kysely');
            vi.spyOn(sql, 'raw').mockReturnValue({
                execute: mockExecute,
            } as MockRawBuilder);

            const result = await executeRawSql(mockDb, 'SELECT 1', 'test');

            expect(result.success).toBe(true);
            // setTimeout(15) may fire slightly early - allow 10ms minimum
            expect(result.durationMs).toBeGreaterThanOrEqual(10);

        });

        it('should handle queries with complex result types', async () => {

            mockExecute.mockResolvedValue({
                rows: [
                    {
                        id: 1,
                        metadata: { tags: ['important', 'urgent'] },
                        createdAt: new Date('2025-01-01'),
                        count: BigInt(9007199254740991),
                        isActive: true,
                    },
                ],
                numAffectedRows: undefined,
            });

            const { sql } = await import('kysely');
            vi.spyOn(sql, 'raw').mockReturnValue({
                execute: mockExecute,
            } as MockRawBuilder);

            const result = await executeRawSql(mockDb, 'SELECT * FROM complex_table', 'test');

            expect(result.success).toBe(true);
            expect(result.columns).toEqual(['id', 'metadata', 'createdAt', 'count', 'isActive']);
            expect(result.rows![0].metadata).toEqual({ tags: ['important', 'urgent'] });
            expect(result.rows![0].createdAt).toBeInstanceOf(Date);
            expect(result.rows![0].count).toBe(BigInt(9007199254740991));

        });

    });

});
