/**
 * Unit tests for MSSQL explore dialect operations.
 *
 * Tests SQL generation and response parsing without requiring a live database.
 */
import { describe, it, expect, vi } from 'vitest';
import { mssqlExploreOperations } from '../../../../src/core/explore/dialects/mssql.js';

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

describe('explore: mssql dialect', () => {

    describe('listTriggers', () => {

        it('should return trigger summaries with name and table', async () => {

            const mockRows = [
                {
                    trigger_name: 'audit_trigger',
                    schema_name: 'dbo',
                    table_name: 'users',
                    is_instead_of_trigger: false,
                    is_disabled: false,
                    type_desc: 'INSERT',
                },
            ];

            const db = createMockDb(mockRows);
            const triggers = await mssqlExploreOperations.listTriggers(db);

            expect(triggers).toHaveLength(1);
            expect(triggers[0]).toEqual({
                name: 'audit_trigger',
                schema: 'dbo',
                tableName: 'users',
                tableSchema: 'dbo',
                timing: 'AFTER',
                events: ['INSERT'],
            });

        });

        it('should handle INSTEAD OF triggers', async () => {

            const mockRows = [
                {
                    trigger_name: 'view_trigger',
                    schema_name: 'dbo',
                    table_name: 'vw_users',
                    is_instead_of_trigger: true,
                    is_disabled: false,
                    type_desc: 'INSERT',
                },
            ];

            const db = createMockDb(mockRows);
            const triggers = await mssqlExploreOperations.listTriggers(db);

            expect(triggers[0]?.timing).toBe('INSTEAD OF');

        });

        it('should combine multiple events for same trigger', async () => {

            const mockRows = [
                {
                    trigger_name: 'multi_event',
                    schema_name: 'dbo',
                    table_name: 'orders',
                    is_instead_of_trigger: false,
                    is_disabled: false,
                    type_desc: 'INSERT',
                },
                {
                    trigger_name: 'multi_event',
                    schema_name: 'dbo',
                    table_name: 'orders',
                    is_instead_of_trigger: false,
                    is_disabled: false,
                    type_desc: 'UPDATE',
                },
                {
                    trigger_name: 'multi_event',
                    schema_name: 'dbo',
                    table_name: 'orders',
                    is_instead_of_trigger: false,
                    is_disabled: false,
                    type_desc: 'DELETE',
                },
            ];

            const db = createMockDb(mockRows);
            const triggers = await mssqlExploreOperations.listTriggers(db);

            expect(triggers).toHaveLength(1);
            expect(triggers[0]?.events).toEqual(['INSERT', 'UPDATE', 'DELETE']);

        });

        it('should deduplicate events for same trigger', async () => {

            const mockRows = [
                {
                    trigger_name: 'dup_trigger',
                    schema_name: 'dbo',
                    table_name: 'products',
                    is_instead_of_trigger: false,
                    is_disabled: false,
                    type_desc: 'UPDATE',
                },
                {
                    trigger_name: 'dup_trigger',
                    schema_name: 'dbo',
                    table_name: 'products',
                    is_instead_of_trigger: false,
                    is_disabled: false,
                    type_desc: 'UPDATE',
                },
            ];

            const db = createMockDb(mockRows);
            const triggers = await mssqlExploreOperations.listTriggers(db);

            expect(triggers).toHaveLength(1);
            expect(triggers[0]?.events).toEqual(['UPDATE']);

        });

    });

    describe('listLocks', () => {

        it('should return lock info from sys.dm_tran_locks', async () => {

            const mockRows = [
                {
                    request_session_id: 52,
                    resource_type: 'OBJECT',
                    resource_description: 'users',
                    request_mode: 'S',
                    request_status: 'GRANT',
                },
                {
                    request_session_id: 53,
                    resource_type: 'PAGE',
                    resource_description: '1:2345',
                    request_mode: 'X',
                    request_status: 'WAIT',
                },
            ];

            const db = createMockDb(mockRows);
            const locks = await mssqlExploreOperations.listLocks(db);

            expect(locks).toHaveLength(2);
            expect(locks[0]).toEqual({
                pid: 52,
                lockType: 'OBJECT',
                objectName: 'users',
                mode: 'S',
                granted: true,
            });
            expect(locks[1]).toEqual({
                pid: 53,
                lockType: 'PAGE',
                objectName: '1:2345',
                mode: 'X',
                granted: false,
            });

        });

        it('should handle empty resource description', async () => {

            const mockRows = [
                {
                    request_session_id: 52,
                    resource_type: 'DATABASE',
                    resource_description: '',
                    request_mode: 'S',
                    request_status: 'GRANT',
                },
            ];

            const db = createMockDb(mockRows);
            const locks = await mssqlExploreOperations.listLocks(db);

            expect(locks[0]?.objectName).toBeUndefined();

        });

    });

    describe('listConnections', () => {

        it('should return connection info from sys.dm_exec_sessions', async () => {

            const mockRows = [
                {
                    session_id: 52,
                    login_name: 'app_user',
                    host_name: 'web-server-01',
                    program_name: 'node-app',
                    status: 'running',
                    login_time: new Date('2025-01-01T10:00:00Z'),
                },
                {
                    session_id: 53,
                    login_name: 'admin',
                    host_name: '',
                    program_name: '',
                    status: 'sleeping',
                    login_time: new Date('2025-01-01T09:00:00Z'),
                },
            ];

            const db = createMockDb(mockRows);
            const connections = await mssqlExploreOperations.listConnections(db);

            expect(connections).toHaveLength(2);
            expect(connections[0]).toEqual({
                pid: 52,
                username: 'app_user',
                database: 'current',
                applicationName: 'node-app',
                clientAddress: 'web-server-01',
                backendStart: new Date('2025-01-01T10:00:00Z'),
                state: 'running',
            });

        });

        it('should handle empty program name', async () => {

            const mockRows = [
                {
                    session_id: 52,
                    login_name: 'app_user',
                    host_name: 'web-server-01',
                    program_name: '',
                    status: 'running',
                    login_time: new Date('2025-01-01T10:00:00Z'),
                },
            ];

            const db = createMockDb(mockRows);
            const connections = await mssqlExploreOperations.listConnections(db);

            expect(connections[0]?.applicationName).toBeUndefined();

        });

        it('should handle empty host name', async () => {

            const mockRows = [
                {
                    session_id: 52,
                    login_name: 'app_user',
                    host_name: '',
                    program_name: 'SSMS',
                    status: 'running',
                    login_time: new Date('2025-01-01T10:00:00Z'),
                },
            ];

            const db = createMockDb(mockRows);
            const connections = await mssqlExploreOperations.listConnections(db);

            expect(connections[0]?.clientAddress).toBeUndefined();

        });

    });

    describe('getTriggerDetail', () => {

        it('should return full trigger definition', async () => {

            const mockRows = [
                {
                    trigger_name: 'audit_trigger',
                    table_name: 'users',
                    is_instead_of_trigger: false,
                    is_disabled: false,
                    definition: 'CREATE TRIGGER audit_trigger ON users AFTER INSERT AS ...',
                    type_desc: 'INSERT',
                },
            ];

            const db = createMockDb(mockRows);
            const trigger = await mssqlExploreOperations.getTriggerDetail(db, 'audit_trigger', 'dbo');

            expect(trigger).toEqual({
                name: 'audit_trigger',
                schema: 'dbo',
                tableName: 'users',
                tableSchema: 'dbo',
                timing: 'AFTER',
                events: ['INSERT'],
                definition: 'CREATE TRIGGER audit_trigger ON users AFTER INSERT AS ...',
                isEnabled: true,
            });

        });

        it('should return null for non-existent trigger', async () => {

            const db = createMockDb([]);
            const trigger = await mssqlExploreOperations.getTriggerDetail(db, 'nonexistent', 'dbo');

            expect(trigger).toBeNull();

        });

        it('should handle disabled triggers', async () => {

            const mockRows = [
                {
                    trigger_name: 'disabled_trigger',
                    table_name: 'orders',
                    is_instead_of_trigger: false,
                    is_disabled: true,
                    definition: 'CREATE TRIGGER disabled_trigger ...',
                    type_desc: 'UPDATE',
                },
            ];

            const db = createMockDb(mockRows);
            const trigger = await mssqlExploreOperations.getTriggerDetail(db, 'disabled_trigger', 'dbo');

            expect(trigger?.isEnabled).toBe(false);

        });

        it('should combine multiple events', async () => {

            const mockRows = [
                {
                    trigger_name: 'multi_trigger',
                    table_name: 'products',
                    is_instead_of_trigger: false,
                    is_disabled: false,
                    definition: 'CREATE TRIGGER multi_trigger ...',
                    type_desc: 'INSERT',
                },
                {
                    trigger_name: 'multi_trigger',
                    table_name: 'products',
                    is_instead_of_trigger: false,
                    is_disabled: false,
                    definition: 'CREATE TRIGGER multi_trigger ...',
                    type_desc: 'UPDATE',
                },
            ];

            const db = createMockDb(mockRows);
            const trigger = await mssqlExploreOperations.getTriggerDetail(db, 'multi_trigger', 'dbo');

            expect(trigger?.events).toEqual(['INSERT', 'UPDATE']);

        });

    });

});
