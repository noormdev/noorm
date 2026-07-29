/**
 * Unit tests for PostgreSQL explore dialect operations.
 *
 * Uses the recording harness so the SQL each method generates is compiled for
 * real and asserted. A predicate bug (wrong column, missing schema filter) is
 * only visible here if the statement itself is inspected.
 */
import { describe, it, expect } from 'bun:test';
import { postgresExploreOperations } from '../../../../src/core/explore/dialects/postgres.js';
import { createRecordingDb } from '../recording-db.js';

describe('explore: postgres dialect', () => {

    describe('getProcedureDetail', () => {

        it('should look parameters up by the specific_name postgres actually stores', async () => {

            // information_schema.parameters.specific_name is `proname_oid`, never
            // the bare name. Filtering on the bare name silently returns nothing.
            const db = createRecordingDb('postgres', [
                { match: /FROM pg_proc/, rows: [{ oid: '675394', prosrc: 'BEGIN END' }] },
                {
                    match: /information_schema\.parameters/,
                    rows: [
                        {
                            parameter_name: 'p_id',
                            data_type: 'integer',
                            parameter_mode: 'IN',
                            ordinal_position: '1',
                            parameter_default: null,
                        },
                        {
                            parameter_name: 'p_note',
                            data_type: 'text',
                            parameter_mode: 'INOUT',
                            ordinal_position: '2',
                            parameter_default: null,
                        },
                    ],
                },
            ]);

            const detail = await postgresExploreOperations.getProcedureDetail(db.kysely, 'sp_touch', 'public');

            const paramQuery = db.find(/information_schema\.parameters/);

            expect(paramQuery?.parameters).toContain('sp_touch_675394');
            expect(paramQuery?.parameters).not.toContain('sp_touch');

            expect(detail?.parameters.map((p) => p.name)).toEqual(['p_id', 'p_note']);

        });

        it('should report OUT parameters, which a procedure can have and a function cannot', async () => {

            const db = createRecordingDb('postgres', [
                { match: /FROM pg_proc/, rows: [{ oid: '1', prosrc: 'BEGIN END' }] },
                {
                    match: /information_schema\.parameters/,
                    rows: [
                        {
                            parameter_name: 'p_out',
                            data_type: 'text',
                            parameter_mode: 'OUT',
                            ordinal_position: '1',
                            parameter_default: null,
                        },
                    ],
                },
            ]);

            const detail = await postgresExploreOperations.getProcedureDetail(db.kysely, 'sp_out', 'public');

            expect(db.find(/information_schema\.parameters/)?.sql).not.toContain('parameter_mode IN');
            expect(detail?.parameters).toEqual([
                {
                    name: 'p_out',
                    dataType: 'text',
                    mode: 'OUT',
                    defaultValue: undefined,
                    ordinalPosition: 1,
                },
            ]);

        });

        it('should return null without querying parameters when the procedure is absent', async () => {

            const db = createRecordingDb('postgres');

            const detail = await postgresExploreOperations.getProcedureDetail(db.kysely, 'nope', 'public');

            expect(detail).toBeNull();
            expect(db.find(/information_schema\.parameters/)).toBeUndefined();

        });

    });

    describe('getFunctionDetail', () => {

        it('should look parameters up by name_oid and skip OUT parameters', async () => {

            const db = createRecordingDb('postgres', [
                {
                    match: /FROM pg_proc/,
                    rows: [{ oid: '99', prosrc: 'SELECT 1', return_type: 'integer', language: 'sql' }],
                },
                {
                    match: /information_schema\.parameters/,
                    rows: [
                        {
                            parameter_name: 'a',
                            data_type: 'integer',
                            parameter_mode: 'IN',
                            ordinal_position: '1',
                            parameter_default: null,
                        },
                    ],
                },
            ]);

            const detail = await postgresExploreOperations.getFunctionDetail(db.kysely, 'fn_over', 'public');

            const paramQuery = db.find(/information_schema\.parameters/);

            expect(paramQuery?.parameters).toContain('fn_over_99');
            expect(paramQuery?.sql).toContain('parameter_mode IN');
            expect(detail?.parameters.map((p) => p.name)).toEqual(['a']);

        });

    });

    describe('schema scoping', () => {

        it('should filter listTables by schema instead of listing every schema', async () => {

            const db = createRecordingDb('postgres', [{ match: /information_schema\.tables/, rows: [] }]);

            await postgresExploreOperations.listTables(db.kysely, 'app');

            const query = db.find(/information_schema\.tables/)!;

            expect(query.parameters).toContain('app');
            expect(query.sql).not.toContain('not in');

        });

        it('should exclude system schemas when no schema is given', async () => {

            const db = createRecordingDb('postgres', [{ match: /information_schema\.tables/, rows: [] }]);

            await postgresExploreOperations.listTables(db.kysely);

            const query = db.find(/information_schema\.tables/)!;

            expect(query.parameters).toContain('pg_catalog');
            expect(query.parameters).toContain('noorm');

        });

        it.each([
            ['listViews', 'listViews'],
            ['listProcedures', 'listProcedures'],
            ['listFunctions', 'listFunctions'],
            ['listTypes', 'listTypes'],
            ['listIndexes', 'listIndexes'],
            ['listForeignKeys', 'listForeignKeys'],
            ['listTriggers', 'listTriggers'],
        ] as const)('should bind the requested schema in %s', async (_label, method) => {

            const db = createRecordingDb('postgres');

            await postgresExploreOperations[method](db.kysely, 'app');

            expect(db.queries.at(-1)?.parameters).toContain('app');

        });

        it('should scope getTableDetail index and fk lookups to the requested schema', async () => {

            const db = createRecordingDb('postgres', [
                {
                    match: /information_schema\.columns/,
                    rows: [
                        {
                            column_name: 'id',
                            data_type: 'integer',
                            is_nullable: 'NO',
                            column_default: null,
                            ordinal_position: '1',
                        },
                    ],
                },
            ]);

            await postgresExploreOperations.getTableDetail(db.kysely, 'orders', 'app');

            const indexQuery = db.find(/pg_indexes/)!;
            const fkQuery = db.find(/table_constraints/)!;

            expect(indexQuery.parameters).toContain('app');
            expect(fkQuery.parameters).toContain('app');

        });

    });

    describe('listLocks', () => {

        it('should return lock info with pid and mode', async () => {

            const db = createRecordingDb('postgres', [
                {
                    match: /pg_locks/,
                    rows: [
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
                    ],
                },
            ]);

            const locks = await postgresExploreOperations.listLocks(db.kysely);

            expect(locks).toHaveLength(2);
            expect(locks[0]).toEqual({
                pid: 12345,
                lockType: 'relation',
                objectName: 'users',
                mode: 'AccessShareLock',
                granted: true,
            });
            expect(locks[1]?.objectName).toBeUndefined();

        });

        it('should exclude virtualxid locks in SQL rather than in JS', async () => {

            const db = createRecordingDb('postgres', [{ match: /pg_locks/, rows: [] }]);

            await postgresExploreOperations.listLocks(db.kysely);

            expect(db.find(/pg_locks/)?.sql).toContain("locktype != 'virtualxid'");

        });

        it('should restrict locks to the current database', async () => {

            // pg_locks is cluster-wide: without a database predicate the count
            // reflects unrelated tenants on the same server.
            const db = createRecordingDb('postgres', [{ match: /pg_locks/, rows: [] }]);

            await postgresExploreOperations.listLocks(db.kysely);

            expect(db.find(/pg_locks/)?.sql).toContain('current_database()');

        });

    });

    describe('listConnections', () => {

        it('should return connection info excluding current backend', async () => {

            const db = createRecordingDb('postgres', [
                {
                    match: /pg_stat_activity/,
                    rows: [
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
                    ],
                },
            ]);

            const connections = await postgresExploreOperations.listConnections(db.kysely);

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
            expect(connections[1]?.applicationName).toBeUndefined();

        });

    });

    describe('listTriggers', () => {

        it('should return trigger summaries with name and table', async () => {

            const db = createRecordingDb('postgres', [
                {
                    match: /information_schema\.triggers/i,
                    rows: [
                        {
                            trigger_name: 'audit_trigger',
                            trigger_schema: 'public',
                            event_object_table: 'users',
                            event_object_schema: 'public',
                            action_timing: 'AFTER',
                            event_manipulation: 'INSERT',
                        },
                    ],
                },
            ]);

            const triggers = await postgresExploreOperations.listTriggers(db.kysely);

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

            const db = createRecordingDb('postgres', [
                {
                    match: /information_schema\.triggers/i,
                    rows: [
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
                    ],
                },
            ]);

            const triggers = await postgresExploreOperations.listTriggers(db.kysely);

            expect(triggers).toHaveLength(1);
            expect(triggers[0]?.events).toEqual(['UPDATE', 'DELETE']);
            expect(triggers[0]?.timing).toBe('BEFORE');

        });

    });

    describe('getTriggerDetail', () => {

        it('should return full trigger definition', async () => {

            const db = createRecordingDb('postgres', [
                {
                    match: /information_schema\.triggers/i,
                    rows: [
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
                    ],
                },
            ]);

            const trigger = await postgresExploreOperations.getTriggerDetail(db.kysely, 'audit_trigger', 'public');

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

            const db = createRecordingDb('postgres');
            const trigger = await postgresExploreOperations.getTriggerDetail(db.kysely, 'nonexistent', 'public');

            expect(trigger).toBeNull();

        });

    });

});
