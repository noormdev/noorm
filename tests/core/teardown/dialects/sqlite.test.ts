import { describe, it, expect } from 'vitest';

import { sqliteTeardownOperations } from '../../../../src/core/teardown/dialects/sqlite.js';

describe('teardown: sqlite dialect', () => {

    describe('disableForeignKeyChecks', () => {

        it('should return PRAGMA foreign_keys = OFF', () => {

            const sql = sqliteTeardownOperations.disableForeignKeyChecks();

            expect(sql).toBe('PRAGMA foreign_keys = OFF');

        });

    });

    describe('enableForeignKeyChecks', () => {

        it('should return PRAGMA foreign_keys = ON', () => {

            const sql = sqliteTeardownOperations.enableForeignKeyChecks();

            expect(sql).toBe('PRAGMA foreign_keys = ON');

        });

    });

    describe('truncateTable', () => {

        it('should generate DELETE FROM without TRUNCATE', () => {

            const sql = sqliteTeardownOperations.truncateTable('users');

            expect(sql).toContain('DELETE FROM "users"');

        });

        it('should include sqlite_sequence DELETE with restartIdentity true', () => {

            const sql = sqliteTeardownOperations.truncateTable('users', undefined, true);

            expect(sql).toBe('DELETE FROM "users"; DELETE FROM sqlite_sequence WHERE name = \'users\'');

        });

        it('should not include sqlite_sequence DELETE when restartIdentity false', () => {

            const sql = sqliteTeardownOperations.truncateTable('users', undefined, false);

            expect(sql).toBe('DELETE FROM "users"');

        });

        it('should quote table name with double quotes', () => {

            const sql = sqliteTeardownOperations.truncateTable('user_accounts');

            expect(sql).toContain('DELETE FROM "user_accounts"');

        });

        it('should escape double quotes in table name', () => {

            const sql = sqliteTeardownOperations.truncateTable('table"with"quotes');

            expect(sql).toContain('DELETE FROM "table""with""quotes"');

        });

        it('should escape single quotes in table name for sqlite_sequence', () => {

            const sql = sqliteTeardownOperations.truncateTable('table\'with\'quotes', undefined, true);

            expect(sql).toContain('WHERE name = \'table\'\'with\'\'quotes\'');

        });

        it('should ignore schema parameter (SQLite has no schemas)', () => {

            const sql = sqliteTeardownOperations.truncateTable('users', 'ignored_schema');

            expect(sql).toContain('DELETE FROM "users"');

        });

    });

    describe('dropTable', () => {

        it('should generate DROP TABLE with IF EXISTS', () => {

            const sql = sqliteTeardownOperations.dropTable('users');

            expect(sql).toBe('DROP TABLE IF EXISTS "users"');

        });

        it('should quote table name with double quotes', () => {

            const sql = sqliteTeardownOperations.dropTable('user_accounts');

            expect(sql).toBe('DROP TABLE IF EXISTS "user_accounts"');

        });

        it('should escape double quotes in table name', () => {

            const sql = sqliteTeardownOperations.dropTable('table"name');

            expect(sql).toBe('DROP TABLE IF EXISTS "table""name"');

        });

        it('should ignore schema parameter', () => {

            const sql = sqliteTeardownOperations.dropTable('users', 'ignored_schema');

            expect(sql).toBe('DROP TABLE IF EXISTS "users"');

        });

    });

    describe('dropView', () => {

        it('should generate DROP VIEW with IF EXISTS', () => {

            const sql = sqliteTeardownOperations.dropView('user_summary');

            expect(sql).toBe('DROP VIEW IF EXISTS "user_summary"');

        });

        it('should quote view name with double quotes', () => {

            const sql = sqliteTeardownOperations.dropView('summary_view');

            expect(sql).toBe('DROP VIEW IF EXISTS "summary_view"');

        });

        it('should escape double quotes in view name', () => {

            const sql = sqliteTeardownOperations.dropView('view"name');

            expect(sql).toBe('DROP VIEW IF EXISTS "view""name"');

        });

        it('should ignore schema parameter', () => {

            const sql = sqliteTeardownOperations.dropView('user_summary', 'ignored_schema');

            expect(sql).toBe('DROP VIEW IF EXISTS "user_summary"');

        });

    });

    describe('dropFunction', () => {

        it('should return comment indicating SQLite does not support stored procedures', () => {

            const sql = sqliteTeardownOperations.dropFunction('calculate_total');

            expect(sql).toBe('-- SQLite does not support stored procedures');

        });

        it('should return same comment regardless of parameters', () => {

            const sql1 = sqliteTeardownOperations.dropFunction('func1');
            const sql2 = sqliteTeardownOperations.dropFunction('func2', 'schema');

            expect(sql1).toBe('-- SQLite does not support stored procedures');
            expect(sql2).toBe('-- SQLite does not support stored procedures');

        });

    });

    describe('dropType', () => {

        it('should return comment indicating SQLite does not support custom types', () => {

            const sql = sqliteTeardownOperations.dropType('user_status');

            expect(sql).toBe('-- SQLite does not support custom types');

        });

        it('should return same comment regardless of parameters', () => {

            const sql1 = sqliteTeardownOperations.dropType('type1');
            const sql2 = sqliteTeardownOperations.dropType('type2', 'schema');

            expect(sql1).toBe('-- SQLite does not support custom types');
            expect(sql2).toBe('-- SQLite does not support custom types');

        });

    });

    describe('dropForeignKey', () => {

        it('should return comment indicating SQLite does not support dropping FKs', () => {

            const sql = sqliteTeardownOperations.dropForeignKey('fk_user_id', 'orders');

            expect(sql).toBe('-- SQLite does not support dropping individual FK constraints');

        });

        it('should return same comment regardless of parameters', () => {

            const sql1 = sqliteTeardownOperations.dropForeignKey('fk1', 'table1');
            const sql2 = sqliteTeardownOperations.dropForeignKey('fk2', 'table2', 'schema');

            expect(sql1).toBe('-- SQLite does not support dropping individual FK constraints');
            expect(sql2).toBe('-- SQLite does not support dropping individual FK constraints');

        });

    });

});
