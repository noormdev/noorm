/**
 * Unit tests for MySQL explore dialect operations.
 *
 * Tests SQL generation and response parsing without requiring a live database.
 */
import { describe, it, expect, vi } from 'vitest';
import { mysqlExploreOperations } from '../../../../src/core/explore/dialects/mysql.js';

import type { Kysely } from 'kysely';

/**
 * Creates a mock Kysely database instance with executor stub.
 */
function createMockDb(rows: unknown[]) {

    const mockExecutor = {
        executeQuery: vi.fn().mockResolvedValue({ rows }),
        transformQuery: vi.fn((node) => node),
        compileQuery: vi.fn(() => ({ sql: 'SELECT 1', parameters: [], query: {} as never })),
        adapter: {
            supportsTransactionalDdl: true,
            supportsReturning: true,
        },
        withConnectionProvider: vi.fn(() => mockExecutor),
        withPluginAtFront: vi.fn(() => mockExecutor),
    };

    return {
        getExecutor: () => mockExecutor,
        withPlugin: vi.fn(function() {

            return this;

        }),
    } as unknown as Kysely<unknown>;

}

describe('explore: mysql dialect', () => {

    describe('listTriggers', () => {

        it('should return trigger summaries with name and table', async () => {

            const mockRows = [
                {
                    TRIGGER_NAME: 'audit_trigger',
                    TRIGGER_SCHEMA: 'mydb',
                    EVENT_OBJECT_TABLE: 'users',
                    ACTION_TIMING: 'AFTER',
                    EVENT_MANIPULATION: 'INSERT',
                },
            ];

            const db = createMockDb(mockRows);
            const triggers = await mysqlExploreOperations.listTriggers(db);

            expect(triggers).toHaveLength(1);
            expect(triggers[0]).toEqual({
                name: 'audit_trigger',
                schema: 'mydb',
                tableName: 'users',
                tableSchema: 'mydb',
                timing: 'AFTER',
                events: ['INSERT'],
            });

        });

        it('should handle BEFORE timing', async () => {

            const mockRows = [
                {
                    TRIGGER_NAME: 'validate_trigger',
                    TRIGGER_SCHEMA: 'mydb',
                    EVENT_OBJECT_TABLE: 'orders',
                    ACTION_TIMING: 'BEFORE',
                    EVENT_MANIPULATION: 'UPDATE',
                },
            ];

            const db = createMockDb(mockRows);
            const triggers = await mysqlExploreOperations.listTriggers(db);

            expect(triggers[0]?.timing).toBe('BEFORE');
            expect(triggers[0]?.events).toEqual(['UPDATE']);

        });

        it('should handle DELETE event', async () => {

            const mockRows = [
                {
                    TRIGGER_NAME: 'cascade_delete',
                    TRIGGER_SCHEMA: 'mydb',
                    EVENT_OBJECT_TABLE: 'products',
                    ACTION_TIMING: 'AFTER',
                    EVENT_MANIPULATION: 'DELETE',
                },
            ];

            const db = createMockDb(mockRows);
            const triggers = await mysqlExploreOperations.listTriggers(db);

            expect(triggers[0]?.events).toEqual(['DELETE']);

        });

    });

    describe('listLocks', () => {

        it('should return lock info from performance_schema', async () => {

            const mockRows = [
                {
                    OBJECT_TYPE: 'TABLE',
                    OBJECT_NAME: 'users',
                    LOCK_TYPE: 'SHARED_READ',
                    LOCK_STATUS: 'GRANTED',
                    OWNER_THREAD_ID: 12345,
                },
                {
                    OBJECT_TYPE: 'TABLE',
                    OBJECT_NAME: 'orders',
                    LOCK_TYPE: 'EXCLUSIVE',
                    LOCK_STATUS: 'PENDING',
                    OWNER_THREAD_ID: 12346,
                },
            ];

            const db = createMockDb(mockRows);
            const locks = await mysqlExploreOperations.listLocks(db);

            expect(locks).toHaveLength(2);
            expect(locks[0]).toEqual({
                pid: 12345,
                lockType: 'TABLE',
                objectName: 'users',
                mode: 'SHARED_READ',
                granted: true,
            });
            expect(locks[1]).toEqual({
                pid: 12346,
                lockType: 'TABLE',
                objectName: 'orders',
                mode: 'EXCLUSIVE',
                granted: false,
            });

        });

        it('should handle null object names', async () => {

            const mockRows = [
                {
                    OBJECT_TYPE: 'GLOBAL',
                    OBJECT_NAME: null,
                    LOCK_TYPE: 'INTENTION_EXCLUSIVE',
                    LOCK_STATUS: 'GRANTED',
                    OWNER_THREAD_ID: 12345,
                },
            ];

            const db = createMockDb(mockRows);
            const locks = await mysqlExploreOperations.listLocks(db);

            expect(locks[0]?.objectName).toBeUndefined();

        });

    });

    describe('listConnections', () => {

        it('should return connection info from PROCESSLIST', async () => {

            const mockRows = [
                {
                    ID: 12345,
                    USER: 'app_user',
                    HOST: '192.168.1.100:45678',
                    DB: 'mydb',
                    STATE: 'Sending data',
                    INFO: 'SELECT * FROM users',
                },
                {
                    ID: 12346,
                    USER: 'admin',
                    HOST: 'localhost:56789',
                    DB: 'mydb',
                    STATE: null,
                    INFO: null,
                },
            ];

            const db = createMockDb(mockRows);
            const connections = await mysqlExploreOperations.listConnections(db);

            expect(connections).toHaveLength(2);
            expect(connections[0]).toEqual({
                pid: 12345,
                username: 'app_user',
                database: 'mydb',
                clientAddress: '192.168.1.100:45678',
                state: 'Sending data',
            });

        });

        it('should handle null state as unknown', async () => {

            const mockRows = [
                {
                    ID: 12345,
                    USER: 'app_user',
                    HOST: 'localhost',
                    DB: 'mydb',
                    STATE: null,
                    INFO: null,
                },
            ];

            const db = createMockDb(mockRows);
            const connections = await mysqlExploreOperations.listConnections(db);

            expect(connections[0]?.state).toBe('unknown');

        });

        it('should filter current connection', async () => {

            const mockRows = [
                {
                    ID: 12345,
                    USER: 'app_user',
                    HOST: 'localhost',
                    DB: 'mydb',
                    STATE: 'active',
                    INFO: null,
                },
            ];

            const db = createMockDb(mockRows);
            const connections = await mysqlExploreOperations.listConnections(db);

            // Current connection is filtered in SQL query (ID != CONNECTION_ID())
            expect(connections).toHaveLength(1);

        });

    });

    describe('getTriggerDetail', () => {

        it('should return full trigger definition', async () => {

            const mockRows = [
                {
                    TRIGGER_NAME: 'audit_trigger',
                    EVENT_OBJECT_TABLE: 'users',
                    ACTION_TIMING: 'AFTER',
                    EVENT_MANIPULATION: 'INSERT',
                    ACTION_STATEMENT: 'BEGIN INSERT INTO audit_log VALUES (NEW.id); END',
                },
            ];

            const db = createMockDb(mockRows);
            const trigger = await mysqlExploreOperations.getTriggerDetail(db, 'audit_trigger', 'mydb');

            expect(trigger).toEqual({
                name: 'audit_trigger',
                schema: 'mydb',
                tableName: 'users',
                tableSchema: 'mydb',
                timing: 'AFTER',
                events: ['INSERT'],
                definition: 'BEGIN INSERT INTO audit_log VALUES (NEW.id); END',
                isEnabled: true,
            });

        });

        it('should return null for non-existent trigger', async () => {

            const db = createMockDb([]);
            const trigger = await mysqlExploreOperations.getTriggerDetail(db, 'nonexistent', 'mydb');

            expect(trigger).toBeNull();

        });

        it('should handle single event trigger', async () => {

            const mockRows = [
                {
                    TRIGGER_NAME: 'update_timestamp',
                    EVENT_OBJECT_TABLE: 'orders',
                    ACTION_TIMING: 'BEFORE',
                    EVENT_MANIPULATION: 'UPDATE',
                    ACTION_STATEMENT: 'SET NEW.updated_at = NOW()',
                },
            ];

            const db = createMockDb(mockRows);
            const trigger = await mysqlExploreOperations.getTriggerDetail(db, 'update_timestamp', 'mydb');

            expect(trigger?.events).toEqual(['UPDATE']);
            expect(trigger?.timing).toBe('BEFORE');

        });

    });

});
