/**
 * Unit tests for MSSQL explore dialect operations.
 *
 * Uses the recording harness so schema predicates and row-count coercion are
 * asserted against the compiled statement and the parsed value, not inferred.
 */
import { describe, it, expect } from 'bun:test';
import { mssqlExploreOperations } from '../../../../src/core/explore/dialects/mssql.js';
import { createRecordingDb } from '../recording-db.js';

describe('explore: mssql dialect', () => {

    describe('row count typing', () => {

        it('should return rowCountEstimate as a number when listing tables', async () => {

            // SUM(p.rows)/ISNULL(p.rows, 0) are bigint and the driver hands
            // them back as text, which violates the declared `number` in --json.
            const db = createRecordingDb('mssql', [
                {
                    match: /sys\.tables/,
                    rows: [{ table_name: 't1', schema_name: 'dbo', column_count: 2, row_count: '3' }],
                },
            ]);

            const tables = await mssqlExploreOperations.listTables(db.kysely);

            expect(tables[0]?.rowCountEstimate).toBe(3);

        });

        it('should report an empty table as undefined rather than "0"', async () => {

            const db = createRecordingDb('mssql', [
                {
                    match: /sys\.columns c/,
                    rows: [
                        {
                            column_name: 'id',
                            data_type: 'int',
                            is_nullable: false,
                            column_default: null,
                            ordinal_position: 1,
                            is_identity: true,
                        },
                    ],
                },
                { match: /is_primary_key = 1/, rows: [] },
                { match: /SUM\(p\.rows\)/, rows: [{ row_count: '0' }] },
            ]);

            const detail = await mssqlExploreOperations.getTableDetail(db.kysely, 'empty', 'dbo');

            expect(detail?.rowCountEstimate).toBeUndefined();

        });

        it('should return a numeric rowCountEstimate in table detail', async () => {

            const db = createRecordingDb('mssql', [
                {
                    match: /sys\.columns c/,
                    rows: [
                        {
                            column_name: 'id',
                            data_type: 'int',
                            is_nullable: false,
                            column_default: null,
                            ordinal_position: 1,
                            is_identity: true,
                        },
                    ],
                },
                { match: /is_primary_key = 1/, rows: [] },
                { match: /SUM\(p\.rows\)/, rows: [{ row_count: '42' }] },
            ]);

            const detail = await mssqlExploreOperations.getTableDetail(db.kysely, 't1', 'dbo');

            expect(detail?.rowCountEstimate).toBe(42);

        });

    });

    describe('schema scoping', () => {

        it('should filter listTables by schema instead of listing every schema', async () => {

            const db = createRecordingDb('mssql', [{ match: /sys\.tables/, rows: [] }]);

            await mssqlExploreOperations.listTables(db.kysely, 'app');

            const query = db.find(/sys\.tables/)!;

            expect(query.parameters).toContain('app');
            expect(query.parameters).not.toContain('INFORMATION_SCHEMA');

        });

        it.each([
            'listViews',
            'listProcedures',
            'listFunctions',
            'listTypes',
            'listIndexes',
            'listForeignKeys',
            'listTriggers',
        ] as const)('should bind the requested schema in %s', async (method) => {

            const db = createRecordingDb('mssql');

            await mssqlExploreOperations[method](db.kysely, 'app');

            expect(db.queries.at(-1)?.parameters).toContain('app');

        });

        it('should scope getTableDetail index and fk lookups to the requested schema', async () => {

            const db = createRecordingDb('mssql', [
                {
                    match: /sys\.columns c/,
                    rows: [
                        {
                            column_name: 'id',
                            data_type: 'int',
                            is_nullable: false,
                            column_default: null,
                            ordinal_position: 1,
                            is_identity: true,
                        },
                    ],
                },
            ]);

            await mssqlExploreOperations.getTableDetail(db.kysely, 'orders', 'app');

            expect(db.find(/sys\.index_columns/)?.parameters).toContain('app');
            expect(db.find(/sys\.foreign_keys/)?.parameters).toContain('app');

        });

    });

    describe('listTriggers', () => {

        it('should return trigger summaries with name and table', async () => {

            const db = createRecordingDb('mssql', [
                {
                    match: /sys\.triggers/,
                    rows: [
                        {
                            trigger_name: 'audit_trigger',
                            schema_name: 'dbo',
                            table_name: 'users',
                            is_instead_of_trigger: false,
                            is_disabled: false,
                            type_desc: 'INSERT',
                        },
                    ],
                },
            ]);

            const triggers = await mssqlExploreOperations.listTriggers(db.kysely);

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

            const db = createRecordingDb('mssql', [
                {
                    match: /sys\.triggers/,
                    rows: [
                        {
                            trigger_name: 'view_trigger',
                            schema_name: 'dbo',
                            table_name: 'vw_users',
                            is_instead_of_trigger: true,
                            is_disabled: false,
                            type_desc: 'INSERT',
                        },
                    ],
                },
            ]);

            const triggers = await mssqlExploreOperations.listTriggers(db.kysely);

            expect(triggers[0]?.timing).toBe('INSTEAD OF');

        });

        it('should combine multiple events for the same trigger without duplicating', async () => {

            const db = createRecordingDb('mssql', [
                {
                    match: /sys\.triggers/,
                    rows: [
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
                            type_desc: 'UPDATE',
                        },
                    ],
                },
            ]);

            const triggers = await mssqlExploreOperations.listTriggers(db.kysely);

            expect(triggers).toHaveLength(1);
            expect(triggers[0]?.events).toEqual(['INSERT', 'UPDATE']);

        });

    });

    describe('listLocks', () => {

        it('should return lock info scoped to the current database', async () => {

            const db = createRecordingDb('mssql', [
                {
                    match: /dm_tran_locks/,
                    rows: [
                        {
                            request_session_id: 55,
                            resource_type: 'OBJECT',
                            resource_description: 'users',
                            request_mode: 'S',
                            request_status: 'GRANT',
                        },
                        {
                            request_session_id: 56,
                            resource_type: 'PAGE',
                            resource_description: '',
                            request_mode: 'X',
                            request_status: 'WAIT',
                        },
                    ],
                },
            ]);

            const locks = await mssqlExploreOperations.listLocks(db.kysely);

            expect(db.find(/dm_tran_locks/)?.sql).toContain('DB_ID()');
            expect(locks[0]).toEqual({
                pid: 55,
                lockType: 'OBJECT',
                objectName: 'users',
                mode: 'S',
                granted: true,
            });
            expect(locks[1]?.objectName).toBeUndefined();
            expect(locks[1]?.granted).toBe(false);

        });

    });

    describe('listConnections', () => {

        it('should exclude the current session in SQL rather than in JS', async () => {

            const db = createRecordingDb('mssql', [
                {
                    match: /dm_exec_sessions/,
                    rows: [
                        {
                            session_id: 55,
                            login_name: 'sa',
                            host_name: 'workstation',
                            program_name: 'noorm',
                            status: 'sleeping',
                            login_time: new Date('2025-01-01T10:00:00Z'),
                        },
                    ],
                },
            ]);

            const connections = await mssqlExploreOperations.listConnections(db.kysely);

            expect(db.find(/dm_exec_sessions/)?.sql).toContain('@@SPID');
            expect(connections[0]?.username).toBe('sa');
            expect(connections[0]?.clientAddress).toBe('workstation');

        });

    });

    describe('getTriggerDetail', () => {

        it('should return full trigger definition', async () => {

            const db = createRecordingDb('mssql', [
                {
                    match: /sys\.triggers/,
                    rows: [
                        {
                            trigger_name: 'audit_trigger',
                            table_name: 'users',
                            is_instead_of_trigger: false,
                            is_disabled: false,
                            definition: 'CREATE TRIGGER audit_trigger ON users AFTER INSERT AS SELECT 1',
                            type_desc: 'INSERT',
                        },
                    ],
                },
            ]);

            const trigger = await mssqlExploreOperations.getTriggerDetail(db.kysely, 'audit_trigger', 'dbo');

            expect(trigger).toEqual({
                name: 'audit_trigger',
                schema: 'dbo',
                tableName: 'users',
                tableSchema: 'dbo',
                timing: 'AFTER',
                events: ['INSERT'],
                definition: 'CREATE TRIGGER audit_trigger ON users AFTER INSERT AS SELECT 1',
                isEnabled: true,
            });

        });

        it('should report a disabled trigger as not enabled', async () => {

            const db = createRecordingDb('mssql', [
                {
                    match: /sys\.triggers/,
                    rows: [
                        {
                            trigger_name: 'off_trigger',
                            table_name: 'users',
                            is_instead_of_trigger: false,
                            is_disabled: true,
                            definition: 'CREATE TRIGGER off_trigger ON users AFTER INSERT AS SELECT 1',
                            type_desc: 'INSERT',
                        },
                    ],
                },
            ]);

            const trigger = await mssqlExploreOperations.getTriggerDetail(db.kysely, 'off_trigger', 'dbo');

            expect(trigger?.isEnabled).toBe(false);

        });

        it('should return null for non-existent trigger', async () => {

            const db = createRecordingDb('mssql');

            expect(await mssqlExploreOperations.getTriggerDetail(db.kysely, 'nope', 'dbo')).toBeNull();

        });

    });

});
