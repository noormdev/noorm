/**
 * Unit tests for SQLite explore dialect operations.
 *
 * Tests SQL generation and response parsing without requiring a live database.
 */
import { describe, it, expect, vi } from 'vitest';
import { sqliteExploreOperations } from '../../../../src/core/explore/dialects/sqlite.js';

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

describe('explore: sqlite dialect', () => {

    describe('listTriggers', () => {

        it('should return trigger summaries with name and table', async () => {

            const mockRows = [
                {
                    name: 'audit_trigger',
                    tbl_name: 'users',
                    sql: 'CREATE TRIGGER audit_trigger AFTER INSERT ON users BEGIN INSERT INTO audit_log VALUES (NEW.id); END',
                },
            ];

            const db = createMockDb(mockRows);
            const triggers = await sqliteExploreOperations.listTriggers(db);

            expect(triggers).toHaveLength(1);
            expect(triggers[0]).toEqual({
                name: 'audit_trigger',
                tableName: 'users',
                timing: 'AFTER',
                events: ['INSERT'],
            });

        });

        it('should parse BEFORE timing from SQL', async () => {

            const mockRows = [
                {
                    name: 'validate_trigger',
                    tbl_name: 'orders',
                    sql: 'CREATE TRIGGER validate_trigger BEFORE UPDATE ON orders BEGIN SELECT RAISE(ABORT, \'Invalid\'); END',
                },
            ];

            const db = createMockDb(mockRows);
            const triggers = await sqliteExploreOperations.listTriggers(db);

            expect(triggers[0]?.timing).toBe('BEFORE');
            expect(triggers[0]?.events).toEqual(['UPDATE']);

        });

        it('should parse INSTEAD OF timing from SQL', async () => {

            const mockRows = [
                {
                    name: 'view_trigger',
                    tbl_name: 'vw_users',
                    sql: 'CREATE TRIGGER view_trigger INSTEAD OF INSERT ON vw_users BEGIN SELECT NEW.name; END',
                },
            ];

            const db = createMockDb(mockRows);
            const triggers = await sqliteExploreOperations.listTriggers(db);

            expect(triggers[0]?.timing).toBe('INSTEAD OF');
            expect(triggers[0]?.events).toEqual(['INSERT']);

        });

        it('should parse DELETE event from SQL', async () => {

            const mockRows = [
                {
                    name: 'cascade_delete',
                    tbl_name: 'products',
                    sql: 'CREATE TRIGGER cascade_delete AFTER DELETE ON products BEGIN DELETE FROM product_prices WHERE product_id = OLD.id; END',
                },
            ];

            const db = createMockDb(mockRows);
            const triggers = await sqliteExploreOperations.listTriggers(db);

            expect(triggers[0]?.events).toEqual(['DELETE']);

        });

        it('should parse multiple events from SQL', async () => {

            const mockRows = [
                {
                    name: 'multi_event',
                    tbl_name: 'orders',
                    sql: 'CREATE TRIGGER multi_event AFTER INSERT OR UPDATE OR DELETE ON orders BEGIN SELECT 1; END',
                },
            ];

            const db = createMockDb(mockRows);
            const triggers = await sqliteExploreOperations.listTriggers(db);

            expect(triggers[0]?.events).toEqual(['INSERT', 'UPDATE', 'DELETE']);

        });

        it('should handle lowercase SQL keywords', async () => {

            const mockRows = [
                {
                    name: 'lowercase_trigger',
                    tbl_name: 'users',
                    sql: 'create trigger lowercase_trigger before insert on users begin select 1; end',
                },
            ];

            const db = createMockDb(mockRows);
            const triggers = await sqliteExploreOperations.listTriggers(db);

            expect(triggers[0]?.timing).toBe('BEFORE');
            expect(triggers[0]?.events).toEqual(['INSERT']);

        });

    });

    describe('listLocks', () => {

        it('should return empty array', async () => {

            const db = createMockDb([]);
            const locks = await sqliteExploreOperations.listLocks(db);

            expect(locks).toEqual([]);

        });

    });

    describe('listConnections', () => {

        it('should return empty array', async () => {

            const db = createMockDb([]);
            const connections = await sqliteExploreOperations.listConnections(db);

            expect(connections).toEqual([]);

        });

    });

    describe('getTriggerDetail', () => {

        it('should return full trigger definition', async () => {

            const mockRows = [
                {
                    name: 'audit_trigger',
                    tbl_name: 'users',
                    sql: 'CREATE TRIGGER audit_trigger AFTER INSERT ON users BEGIN INSERT INTO audit_log VALUES (NEW.id); END',
                },
            ];

            const db = createMockDb(mockRows);
            const trigger = await sqliteExploreOperations.getTriggerDetail(db, 'audit_trigger');

            expect(trigger).toEqual({
                name: 'audit_trigger',
                tableName: 'users',
                timing: 'AFTER',
                events: ['INSERT'],
                definition: 'CREATE TRIGGER audit_trigger AFTER INSERT ON users BEGIN INSERT INTO audit_log VALUES (NEW.id); END',
                isEnabled: true,
            });

        });

        it('should return null for non-existent trigger', async () => {

            const db = createMockDb([]);
            const trigger = await sqliteExploreOperations.getTriggerDetail(db, 'nonexistent');

            expect(trigger).toBeNull();

        });

        it('should parse BEFORE timing', async () => {

            const mockRows = [
                {
                    name: 'validate_trigger',
                    tbl_name: 'orders',
                    sql: 'CREATE TRIGGER validate_trigger BEFORE UPDATE ON orders BEGIN SELECT RAISE(ABORT, \'Invalid\'); END',
                },
            ];

            const db = createMockDb(mockRows);
            const trigger = await sqliteExploreOperations.getTriggerDetail(db, 'validate_trigger');

            expect(trigger?.timing).toBe('BEFORE');
            expect(trigger?.events).toEqual(['UPDATE']);

        });

        it('should parse INSTEAD OF timing', async () => {

            const mockRows = [
                {
                    name: 'view_trigger',
                    tbl_name: 'vw_users',
                    sql: 'CREATE TRIGGER view_trigger INSTEAD OF DELETE ON vw_users BEGIN DELETE FROM users WHERE id = OLD.id; END',
                },
            ];

            const db = createMockDb(mockRows);
            const trigger = await sqliteExploreOperations.getTriggerDetail(db, 'view_trigger');

            expect(trigger?.timing).toBe('INSTEAD OF');
            expect(trigger?.events).toEqual(['DELETE']);

        });

        it('should parse multiple events', async () => {

            const mockRows = [
                {
                    name: 'multi_event',
                    tbl_name: 'products',
                    sql: 'CREATE TRIGGER multi_event AFTER INSERT OR UPDATE ON products BEGIN UPDATE products SET updated_at = CURRENT_TIMESTAMP; END',
                },
            ];

            const db = createMockDb(mockRows);
            const trigger = await sqliteExploreOperations.getTriggerDetail(db, 'multi_event');

            expect(trigger?.events).toEqual(['INSERT', 'UPDATE']);

        });

        it('should default to INSERT if no events found', async () => {

            const mockRows = [
                {
                    name: 'malformed_trigger',
                    tbl_name: 'test',
                    sql: 'CREATE TRIGGER malformed_trigger AFTER ON test BEGIN SELECT 1; END',
                },
            ];

            const db = createMockDb(mockRows);
            const trigger = await sqliteExploreOperations.getTriggerDetail(db, 'malformed_trigger');

            expect(trigger?.events).toEqual(['INSERT']);

        });

    });

});
