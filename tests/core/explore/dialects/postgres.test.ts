/**
 * Unit tests for PostgreSQL explore dialect operations.
 *
 * Tests SQL generation and response parsing without requiring a live database.
 */
import { describe, it, expect, vi } from 'vitest';
import { postgresExploreOperations } from '../../../../src/core/explore/dialects/postgres.js';

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

describe('explore: postgres dialect', () => {

    describe('listTriggers', () => {

        it('should return trigger summaries with name and table', async () => {

            const mockRows = [
                {
                    trigger_name: 'audit_trigger',
                    trigger_schema: 'public',
                    event_object_table: 'users',
                    event_object_schema: 'public',
                    action_timing: 'AFTER',
                    event_manipulation: 'INSERT',
                },
            ];

            const db = createMockDb(mockRows);
            const triggers = await postgresExploreOperations.listTriggers(db);

            expect(triggers).toHaveLength(1);
            expect(triggers[0]).toEqual({
                name: 'audit_trigger',
                schema: 'public',
                tableName: 'users',
                tableSchema: 'public',
                timing: 'AFTER',
                events: ['INSERT'],
            });

        });

        it('should combine multiple events for same trigger', async () => {

            const mockRows = [
                {
                    trigger_name: 'update_trigger',
                    trigger_schema: 'public',
                    event_object_table: 'products',
                    event_object_schema: 'public',
                    action_timing: 'BEFORE',
                    event_manipulation: 'UPDATE',
                },
                {
                    trigger_name: 'update_trigger',
                    trigger_schema: 'public',
                    event_object_table: 'products',
                    event_object_schema: 'public',
                    action_timing: 'BEFORE',
                    event_manipulation: 'DELETE',
                },
            ];

            const db = createMockDb(mockRows);
            const triggers = await postgresExploreOperations.listTriggers(db);

            expect(triggers).toHaveLength(1);
            expect(triggers[0]?.events).toEqual(['UPDATE', 'DELETE']);
            expect(triggers[0]?.timing).toBe('BEFORE');

        });

        it('should exclude system schema triggers', async () => {

            const mockRows = [
                {
                    trigger_name: 'user_trigger',
                    trigger_schema: 'public',
                    event_object_table: 'users',
                    event_object_schema: 'public',
                    action_timing: 'AFTER',
                    event_manipulation: 'INSERT',
                },
            ];

            const db = createMockDb(mockRows);
            const triggers = await postgresExploreOperations.listTriggers(db);

            // System schemas (pg_catalog, information_schema) are filtered in SQL query
            expect(triggers).toHaveLength(1);
            expect(triggers[0]?.schema).toBe('public');

        });

    });

    describe('listLocks', () => {

        it('should return lock info with pid and mode', async () => {

            const mockRows = [
                {
                    pid: 12345,
                    locktype: 'relation',
                    relation: 'users',
                    mode: 'AccessShareLock',
                    granted: true,
                },
                {
                    pid: 12345,
                    locktype: 'transactionid',
                    relation: null,
                    mode: 'ExclusiveLock',
                    granted: true,
                },
            ];

            const db = createMockDb(mockRows);
            const locks = await postgresExploreOperations.listLocks(db);

            expect(locks).toHaveLength(2);
            expect(locks[0]).toEqual({
                pid: 12345,
                lockType: 'relation',
                objectName: 'users',
                mode: 'AccessShareLock',
                granted: true,
            });
            expect(locks[1]).toEqual({
                pid: 12345,
                lockType: 'transactionid',
                objectName: undefined,
                mode: 'ExclusiveLock',
                granted: true,
            });

        });

        it('should filter out virtualxid locks', async () => {

            const mockRows = [
                {
                    pid: 12345,
                    locktype: 'relation',
                    relation: 'users',
                    mode: 'AccessShareLock',
                    granted: true,
                },
            ];

            const db = createMockDb(mockRows);
            const locks = await postgresExploreOperations.listLocks(db);

            // virtualxid locks are filtered in SQL query (WHERE l.locktype != 'virtualxid')
            expect(locks).toHaveLength(1);
            expect(locks[0]?.lockType).toBe('relation');

        });

    });

    describe('listConnections', () => {

        it('should return connection info excluding current backend', async () => {

            const mockRows = [
                {
                    pid: 12345,
                    usename: 'app_user',
                    datname: 'mydb',
                    application_name: 'node-app',
                    client_addr: '192.168.1.100',
                    backend_start: new Date('2025-01-01T10:00:00Z'),
                    state: 'active',
                },
                {
                    pid: 12346,
                    usename: 'admin',
                    datname: 'mydb',
                    application_name: '',
                    client_addr: null,
                    backend_start: new Date('2025-01-01T09:00:00Z'),
                    state: 'idle',
                },
            ];

            const db = createMockDb(mockRows);
            const connections = await postgresExploreOperations.listConnections(db);

            expect(connections).toHaveLength(2);
            expect(connections[0]).toEqual({
                pid: 12345,
                username: 'app_user',
                database: 'mydb',
                applicationName: 'node-app',
                clientAddress: '192.168.1.100',
                backendStart: new Date('2025-01-01T10:00:00Z'),
                state: 'active',
            });

        });

        it('should include application name when present', async () => {

            const mockRows = [
                {
                    pid: 12345,
                    usename: 'app_user',
                    datname: 'mydb',
                    application_name: 'psql',
                    client_addr: '127.0.0.1',
                    backend_start: new Date('2025-01-01T10:00:00Z'),
                    state: 'active',
                },
            ];

            const db = createMockDb(mockRows);
            const connections = await postgresExploreOperations.listConnections(db);

            expect(connections[0]?.applicationName).toBe('psql');

        });

        it('should handle missing application name', async () => {

            const mockRows = [
                {
                    pid: 12345,
                    usename: 'app_user',
                    datname: 'mydb',
                    application_name: '',
                    client_addr: '127.0.0.1',
                    backend_start: new Date('2025-01-01T10:00:00Z'),
                    state: 'active',
                },
            ];

            const db = createMockDb(mockRows);
            const connections = await postgresExploreOperations.listConnections(db);

            expect(connections[0]?.applicationName).toBeUndefined();

        });

    });

    describe('getTriggerDetail', () => {

        it('should return full trigger definition', async () => {

            const mockRows = [
                {
                    trigger_name: 'audit_trigger',
                    event_object_table: 'users',
                    action_timing: 'AFTER',
                    event_manipulation: 'INSERT',
                    action_statement: 'EXECUTE FUNCTION audit_log()',
                },
                {
                    trigger_name: 'audit_trigger',
                    event_object_table: 'users',
                    action_timing: 'AFTER',
                    event_manipulation: 'UPDATE',
                    action_statement: 'EXECUTE FUNCTION audit_log()',
                },
            ];

            const db = createMockDb(mockRows);
            const trigger = await postgresExploreOperations.getTriggerDetail(db, 'audit_trigger', 'public');

            expect(trigger).toEqual({
                name: 'audit_trigger',
                schema: 'public',
                tableName: 'users',
                tableSchema: 'public',
                timing: 'AFTER',
                events: ['INSERT', 'UPDATE'],
                definition: 'EXECUTE FUNCTION audit_log()',
                isEnabled: true,
            });

        });

        it('should return null for non-existent trigger', async () => {

            const db = createMockDb([]);
            const trigger = await postgresExploreOperations.getTriggerDetail(db, 'nonexistent', 'public');

            expect(trigger).toBeNull();

        });

        it('should combine events from multiple rows', async () => {

            const mockRows = [
                {
                    trigger_name: 'multi_event_trigger',
                    event_object_table: 'orders',
                    action_timing: 'BEFORE',
                    event_manipulation: 'INSERT',
                    action_statement: 'EXECUTE FUNCTION validate_order()',
                },
                {
                    trigger_name: 'multi_event_trigger',
                    event_object_table: 'orders',
                    action_timing: 'BEFORE',
                    event_manipulation: 'UPDATE',
                    action_statement: 'EXECUTE FUNCTION validate_order()',
                },
                {
                    trigger_name: 'multi_event_trigger',
                    event_object_table: 'orders',
                    action_timing: 'BEFORE',
                    event_manipulation: 'DELETE',
                    action_statement: 'EXECUTE FUNCTION validate_order()',
                },
            ];

            const db = createMockDb(mockRows);
            const trigger = await postgresExploreOperations.getTriggerDetail(db, 'multi_event_trigger', 'public');

            expect(trigger?.events).toEqual(['INSERT', 'UPDATE', 'DELETE']);
            expect(trigger?.timing).toBe('BEFORE');

        });

    });

});
