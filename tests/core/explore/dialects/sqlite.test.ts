/**
 * Unit tests for SQLite explore dialect operations.
 *
 * SQLite is the only dialect that concatenates identifiers into SQL text
 * (PRAGMA and `FROM <table>` cannot take a bind parameter), so these tests
 * assert the *compiled statement*, not just the parsed result.
 */
import { describe, it, expect } from 'bun:test';
import { sqliteExploreOperations } from '../../../../src/core/explore/dialects/sqlite.js';
import { createRecordingDb } from '../recording-db.js';

const HOSTILE = 'we"ird';

describe('explore: sqlite dialect', () => {

    describe('identifier quoting', () => {

        it('should double embedded quotes when listing tables', async () => {

            // A single table named `we"ird` used to abort the whole listing —
            // and every unrelated table with it — with a syntax error.
            const db = createRecordingDb('sqlite', [
                { match: /type = 'table'/, rows: [{ name: HOSTILE }] },
                { match: /PRAGMA table_info/, rows: [{ cid: 0 }] },
                { match: /COUNT\(\*\)/, rows: [{ count: 3 }] },
            ]);

            const tables = await sqliteExploreOperations.listTables(db.kysely);

            expect(db.find(/PRAGMA table_info/)?.sql).toContain('PRAGMA table_info("we""ird")');
            expect(db.find(/FROM "we/)?.sql).toContain('FROM "we""ird"');
            expect(tables[0]?.name).toBe(HOSTILE);

        });

        it('should double embedded quotes when listing views', async () => {

            const db = createRecordingDb('sqlite', [
                { match: /type = 'view'/, rows: [{ name: HOSTILE }] },
                { match: /PRAGMA table_info/, rows: [{ cid: 0 }] },
            ]);

            await sqliteExploreOperations.listViews(db.kysely);

            expect(db.find(/PRAGMA table_info/)?.sql).toContain('PRAGMA table_info("we""ird")');

        });

        it('should double embedded quotes when listing foreign keys', async () => {

            const db = createRecordingDb('sqlite', [
                { match: /type = 'table'/, rows: [{ name: HOSTILE }] },
                { match: /PRAGMA foreign_key_list/, rows: [] },
            ]);

            await sqliteExploreOperations.listForeignKeys(db.kysely);

            expect(db.find(/PRAGMA foreign_key_list/)?.sql)
                .toContain('PRAGMA foreign_key_list("we""ird")');

        });

        it('should double embedded quotes when listing indexes', async () => {

            const db = createRecordingDb('sqlite', [
                { match: /type = 'index'/, rows: [{ name: HOSTILE, tbl_name: 't', sql: null }] },
                { match: /PRAGMA index_info/, rows: [] },
            ]);

            await sqliteExploreOperations.listIndexes(db.kysely);

            expect(db.find(/PRAGMA index_info/)?.sql).toContain('PRAGMA index_info("we""ird")');

        });

        it('should double embedded quotes in table detail', async () => {

            const db = createRecordingDb('sqlite', [
                { match: /type = 'table' and name =/i, rows: [{ name: HOSTILE }] },
                { match: /PRAGMA table_info/, rows: [{ cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 }] },
                { match: /COUNT\(\*\)/, rows: [{ count: 1 }] },
            ]);

            const detail = await sqliteExploreOperations.getTableDetail(db.kysely, HOSTILE);

            expect(db.find(/PRAGMA table_info/)?.sql).toContain('PRAGMA table_info("we""ird")');
            expect(db.find(/FROM "we/)?.sql).toContain('FROM "we""ird"');
            expect(detail?.name).toBe(HOSTILE);

        });

        it('should double embedded quotes in view detail', async () => {

            const db = createRecordingDb('sqlite', [
                { match: /type = 'view' and name =/i, rows: [{ sql: 'CREATE VIEW ...' }] },
                { match: /PRAGMA table_info/, rows: [] },
            ]);

            await sqliteExploreOperations.getViewDetail(db.kysely, HOSTILE);

            expect(db.find(/PRAGMA table_info/)?.sql).toContain('PRAGMA table_info("we""ird")');

        });

        it('should double embedded quotes when counting foreign keys for the overview', async () => {

            const db = createRecordingDb('sqlite', [
                { match: /type = 'table'/, rows: [{ name: HOSTILE }] },
                { match: /PRAGMA foreign_key_list/, rows: [] },
            ]);

            await sqliteExploreOperations.listForeignKeys(db.kysely);

            expect(db.findAll(/PRAGMA/).every((q) => !/[^"]"[^"]*ird/.test(q.sql))).toBe(true);

        });

    });

    describe('resilience', () => {

        it('should keep listing views when one view has lost its base table', async () => {

            // PRAGMA table_info on a view over a dropped table errors; that must
            // not take down the listing of every other view.
            const db = createRecordingDb('sqlite', [
                { match: /type = 'view'/, rows: [{ name: 'broken' }, { name: 'fine' }] },
            ]);

            const original = db.kysely.getExecutor().executeQuery.bind(db.kysely.getExecutor());

            db.kysely.getExecutor().executeQuery = ((compiled: { sql: string }, ...rest: unknown[]) => {

                if (compiled.sql.includes('PRAGMA table_info("broken")')) {

                    return Promise.reject(new Error('no such table: main.t'));

                }

                return original(compiled as never, ...rest as []);

            }) as never;

            const views = await sqliteExploreOperations.listViews(db.kysely);

            expect(views.map((v) => v.name)).toEqual(['broken', 'fine']);
            expect(views[0]?.columnCount).toBe(0);

        });

    });

    describe('listTriggers', () => {

        it('should read timing and event from the trigger header, not the body', async () => {

            // `AFTER DELETE ... BEGIN INSERT INTO audit_log` used to report both
            // INSERT and DELETE because the whole statement was substring-matched.
            const db = createRecordingDb('sqlite', [
                {
                    match: /type = 'trigger'/,
                    rows: [
                        {
                            name: 'cascade_delete',
                            tbl_name: 'products',
                            sql: 'CREATE TRIGGER cascade_delete AFTER DELETE ON products BEGIN INSERT INTO audit_log VALUES (OLD.id); END',
                        },
                    ],
                },
            ]);

            const triggers = await sqliteExploreOperations.listTriggers(db.kysely);

            expect(triggers[0]?.events).toEqual(['DELETE']);
            expect(triggers[0]?.timing).toBe('AFTER');

        });

        it('should not let the word BEFORE inside a string literal change the timing', async () => {

            const db = createRecordingDb('sqlite', [
                {
                    match: /type = 'trigger'/,
                    rows: [
                        {
                            name: 'note_trigger',
                            tbl_name: 'orders',
                            sql: "CREATE TRIGGER note_trigger AFTER UPDATE ON orders BEGIN INSERT INTO log VALUES ('state BEFORE change'); END",
                        },
                    ],
                },
            ]);

            const triggers = await sqliteExploreOperations.listTriggers(db.kysely);

            expect(triggers[0]?.timing).toBe('AFTER');
            expect(triggers[0]?.events).toEqual(['UPDATE']);

        });

        it('should return trigger summaries with name and table', async () => {

            const db = createRecordingDb('sqlite', [
                {
                    match: /type = 'trigger'/,
                    rows: [
                        {
                            name: 'audit_trigger',
                            tbl_name: 'users',
                            sql: 'CREATE TRIGGER audit_trigger AFTER INSERT ON users BEGIN SELECT 1; END',
                        },
                    ],
                },
            ]);

            const triggers = await sqliteExploreOperations.listTriggers(db.kysely);

            expect(triggers).toHaveLength(1);
            expect(triggers[0]).toEqual({
                name: 'audit_trigger',
                tableName: 'users',
                timing: 'AFTER',
                events: ['INSERT'],
            });

        });

        it('should parse BEFORE timing from the header', async () => {

            const db = createRecordingDb('sqlite', [
                {
                    match: /type = 'trigger'/,
                    rows: [
                        {
                            name: 'validate_trigger',
                            tbl_name: 'orders',
                            sql: 'CREATE TRIGGER validate_trigger BEFORE UPDATE ON orders BEGIN SELECT RAISE(ABORT, \'Invalid\'); END',
                        },
                    ],
                },
            ]);

            const triggers = await sqliteExploreOperations.listTriggers(db.kysely);

            expect(triggers[0]?.timing).toBe('BEFORE');
            expect(triggers[0]?.events).toEqual(['UPDATE']);

        });

        it('should parse INSTEAD OF timing from the header', async () => {

            const db = createRecordingDb('sqlite', [
                {
                    match: /type = 'trigger'/,
                    rows: [
                        {
                            name: 'view_trigger',
                            tbl_name: 'vw_users',
                            sql: 'CREATE TRIGGER view_trigger INSTEAD OF INSERT ON vw_users BEGIN SELECT NEW.name; END',
                        },
                    ],
                },
            ]);

            const triggers = await sqliteExploreOperations.listTriggers(db.kysely);

            expect(triggers[0]?.timing).toBe('INSTEAD OF');
            expect(triggers[0]?.events).toEqual(['INSERT']);

        });

        it('should handle UPDATE OF <columns> and lowercase keywords', async () => {

            const db = createRecordingDb('sqlite', [
                {
                    match: /type = 'trigger'/,
                    rows: [
                        {
                            name: 'lowercase_trigger',
                            tbl_name: 'users',
                            sql: 'create trigger if not exists lowercase_trigger before update of email on users begin select 1; end',
                        },
                    ],
                },
            ]);

            const triggers = await sqliteExploreOperations.listTriggers(db.kysely);

            expect(triggers[0]?.timing).toBe('BEFORE');
            expect(triggers[0]?.events).toEqual(['UPDATE']);

        });

    });

    describe('listLocks', () => {

        it('should return empty array', async () => {

            const db = createRecordingDb('sqlite');

            expect(await sqliteExploreOperations.listLocks(db.kysely)).toEqual([]);

        });

    });

    describe('listConnections', () => {

        it('should return empty array', async () => {

            const db = createRecordingDb('sqlite');

            expect(await sqliteExploreOperations.listConnections(db.kysely)).toEqual([]);

        });

    });

    describe('getTriggerDetail', () => {

        it('should return full trigger definition', async () => {

            const definition = 'CREATE TRIGGER audit_trigger AFTER INSERT ON users BEGIN INSERT INTO audit_log VALUES (NEW.id); END';

            const db = createRecordingDb('sqlite', [
                {
                    match: /type = 'trigger'/,
                    rows: [{ name: 'audit_trigger', tbl_name: 'users', sql: definition }],
                },
            ]);

            const trigger = await sqliteExploreOperations.getTriggerDetail(db.kysely, 'audit_trigger');

            expect(trigger).toEqual({
                name: 'audit_trigger',
                tableName: 'users',
                timing: 'AFTER',
                events: ['INSERT'],
                definition,
                isEnabled: true,
            });

        });

        it('should return null for non-existent trigger', async () => {

            const db = createRecordingDb('sqlite');

            expect(await sqliteExploreOperations.getTriggerDetail(db.kysely, 'nonexistent')).toBeNull();

        });

        it('should not report body statements as trigger events', async () => {

            const db = createRecordingDb('sqlite', [
                {
                    match: /type = 'trigger'/,
                    rows: [
                        {
                            name: 'touch',
                            tbl_name: 'products',
                            sql: 'CREATE TRIGGER touch AFTER INSERT ON products BEGIN UPDATE products SET updated_at = CURRENT_TIMESTAMP; DELETE FROM stale; END',
                        },
                    ],
                },
            ]);

            const trigger = await sqliteExploreOperations.getTriggerDetail(db.kysely, 'touch');

            expect(trigger?.events).toEqual(['INSERT']);

        });

        it('should default to INSERT when the header cannot be parsed', async () => {

            const db = createRecordingDb('sqlite', [
                {
                    match: /type = 'trigger'/,
                    rows: [{ name: 'malformed', tbl_name: 'test', sql: 'CREATE TRIGGER malformed' }],
                },
            ]);

            const trigger = await sqliteExploreOperations.getTriggerDetail(db.kysely, 'malformed');

            expect(trigger?.events).toEqual(['INSERT']);
            expect(trigger?.timing).toBe('AFTER');

        });

    });

});
