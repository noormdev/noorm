/**
 * Unit tests for MySQL explore dialect operations.
 *
 * MySQL's "schema" is a database, and every catalog query used to be pinned to
 * `DATABASE()`. The recording harness makes that visible: these tests assert
 * which database each statement binds, not just the shape of the result.
 */
import { describe, it, expect } from 'bun:test';
import { mysqlExploreOperations } from '../../../../src/core/explore/dialects/mysql.js';
import { createRecordingDb } from '../recording-db.js';

const CONNECTED_DB = 'noorm_audit';
const OTHER_DB = 'noorm_audit_other';

/** Every method opens with `SELECT DATABASE()`; answer it once per call. */
function currentDatabase(name = CONNECTED_DB) {

    return { match: /SELECT DATABASE\(\)/, rows: [{ db: name }] };

}

describe('explore: mysql dialect', () => {

    describe('getTableDetail', () => {

        it('should read indexes and foreign keys from the requested schema, not the connected one', async () => {

            // Columns came from `schema` while indexes/FKs came from DATABASE(),
            // producing an object whose own `tableSchema` contradicted its label.
            const db = createRecordingDb('mysql', [
                currentDatabase(),
                {
                    match: /information_schema\.columns/,
                    rows: [
                        {
                            column_name: 'id',
                            data_type: 'int',
                            is_nullable: 'NO',
                            column_default: null,
                            ordinal_position: 1,
                            column_key: 'PRI',
                        },
                    ],
                },
                { match: /information_schema\.tables/, rows: [{ table_rows: '3' }] },
                currentDatabase(),
                {
                    match: /information_schema\.statistics/,
                    rows: [
                        {
                            index_name: 'idx_zzz',
                            table_name: 't1',
                            column_name: 'zzz',
                            non_unique: 1,
                            seq_in_index: 1,
                        },
                    ],
                },
                currentDatabase(),
                { match: /key_column_usage/, rows: [] },
            ]);

            const detail = await mysqlExploreOperations.getTableDetail(db.kysely, 't1', OTHER_DB);

            expect(db.find(/information_schema\.statistics/)?.parameters).toContain(OTHER_DB);
            expect(db.find(/key_column_usage/)?.parameters).toContain(OTHER_DB);

            expect(detail?.schema).toBe(OTHER_DB);
            expect(detail?.indexes.map((i) => i.name)).toEqual(['idx_zzz']);
            expect(detail?.indexes[0]?.tableSchema).toBe(OTHER_DB);

        });

        it('should fall back to the connected database when no schema is given', async () => {

            const db = createRecordingDb('mysql', [
                currentDatabase(),
                {
                    match: /information_schema\.columns/,
                    rows: [
                        {
                            column_name: 'id',
                            data_type: 'int',
                            is_nullable: 'NO',
                            column_default: null,
                            ordinal_position: 1,
                            column_key: 'PRI',
                        },
                    ],
                },
                { match: /information_schema\.tables/, rows: [] },
                currentDatabase(),
                { match: /information_schema\.statistics/, rows: [] },
                currentDatabase(),
                { match: /key_column_usage/, rows: [] },
            ]);

            await mysqlExploreOperations.getTableDetail(db.kysely, 't1');

            expect(db.find(/information_schema\.statistics/)?.parameters).toContain(CONNECTED_DB);

        });

    });

    describe('schema scoping', () => {

        it.each([
            'listTables',
            'listViews',
            'listProcedures',
            'listFunctions',
            'listIndexes',
            'listForeignKeys',
            'listTriggers',
        ] as const)('should bind the requested schema in %s', async (method) => {

            const db = createRecordingDb('mysql', [currentDatabase()]);

            await mysqlExploreOperations[method](db.kysely, OTHER_DB);

            expect(db.queries.at(-1)?.parameters).toContain(OTHER_DB);

        });

        it('should not ask the server for DATABASE() when a schema is supplied', async () => {

            const db = createRecordingDb('mysql');

            await mysqlExploreOperations.listTables(db.kysely, OTHER_DB);

            expect(db.find(/SELECT DATABASE\(\)/)).toBeUndefined();

        });

        it('should bind the connected database when no schema is supplied', async () => {

            const db = createRecordingDb('mysql', [currentDatabase()]);

            await mysqlExploreOperations.listTables(db.kysely);

            expect(db.find(/information_schema\.tables/)?.parameters).toContain(CONNECTED_DB);

        });

    });

    describe('listTriggers', () => {

        it('should return trigger summaries with name and table', async () => {

            const db = createRecordingDb('mysql', [
                currentDatabase('mydb'),
                {
                    match: /information_schema\.TRIGGERS/i,
                    rows: [
                        {
                            TRIGGER_NAME: 'audit_trigger',
                            TRIGGER_SCHEMA: 'mydb',
                            EVENT_OBJECT_TABLE: 'users',
                            ACTION_TIMING: 'AFTER',
                            EVENT_MANIPULATION: 'INSERT',
                        },
                    ],
                },
            ]);

            const triggers = await mysqlExploreOperations.listTriggers(db.kysely);

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

    });

    describe('listLocks', () => {

        it('should return lock info from performance_schema', async () => {

            const db = createRecordingDb('mysql', [
                {
                    match: /metadata_locks/,
                    rows: [
                        {
                            OBJECT_TYPE: 'TABLE',
                            OBJECT_NAME: 'users',
                            LOCK_TYPE: 'SHARED_READ',
                            LOCK_STATUS: 'GRANTED',
                            OWNER_THREAD_ID: 12345,
                        },
                        {
                            OBJECT_TYPE: 'GLOBAL',
                            OBJECT_NAME: null,
                            LOCK_TYPE: 'EXCLUSIVE',
                            LOCK_STATUS: 'PENDING',
                            OWNER_THREAD_ID: 12346,
                        },
                    ],
                },
            ]);

            const locks = await mysqlExploreOperations.listLocks(db.kysely);

            expect(locks).toHaveLength(2);
            expect(locks[0]).toEqual({
                pid: 12345,
                lockType: 'TABLE',
                objectName: 'users',
                mode: 'SHARED_READ',
                granted: true,
            });
            expect(locks[1]?.objectName).toBeUndefined();
            expect(locks[1]?.granted).toBe(false);

        });

    });

    describe('listConnections', () => {

        it('should return connection info from PROCESSLIST', async () => {

            const db = createRecordingDb('mysql', [
                {
                    match: /PROCESSLIST/i,
                    rows: [
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
                    ],
                },
            ]);

            const connections = await mysqlExploreOperations.listConnections(db.kysely);

            expect(connections).toHaveLength(2);
            expect(connections[0]).toEqual({
                pid: 12345,
                username: 'app_user',
                database: 'mydb',
                clientAddress: '192.168.1.100:45678',
                state: 'Sending data',
            });
            expect(connections[1]?.state).toBe('unknown');

        });

        it('should exclude the current connection in SQL rather than in JS', async () => {

            const db = createRecordingDb('mysql', [{ match: /PROCESSLIST/i, rows: [] }]);

            await mysqlExploreOperations.listConnections(db.kysely);

            expect(db.find(/PROCESSLIST/i)?.sql).toContain('CONNECTION_ID()');

        });

    });

    describe('getTriggerDetail', () => {

        it('should return full trigger definition', async () => {

            const db = createRecordingDb('mysql', [
                {
                    match: /information_schema\.TRIGGERS/i,
                    rows: [
                        {
                            TRIGGER_NAME: 'audit_trigger',
                            EVENT_OBJECT_TABLE: 'users',
                            ACTION_TIMING: 'AFTER',
                            EVENT_MANIPULATION: 'INSERT',
                            ACTION_STATEMENT: 'BEGIN INSERT INTO audit_log VALUES (NEW.id); END',
                        },
                    ],
                },
            ]);

            const trigger = await mysqlExploreOperations.getTriggerDetail(db.kysely, 'audit_trigger', 'mydb');

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

            const db = createRecordingDb('mysql');

            expect(await mysqlExploreOperations.getTriggerDetail(db.kysely, 'nope', 'mydb')).toBeNull();

        });

    });

});
