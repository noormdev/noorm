import { describe, it, expect } from 'vitest';

import { mssqlTeardownOperations } from '../../../../src/core/teardown/dialects/mssql.js';

describe('teardown: mssql dialect', () => {

    describe('disableForeignKeyChecks', () => {

        it('should return sp_MSforeachtable NOCHECK CONSTRAINT ALL', () => {

            const sql = mssqlTeardownOperations.disableForeignKeyChecks();

            expect(sql).toBe('EXEC sp_MSforeachtable \'ALTER TABLE ? NOCHECK CONSTRAINT ALL\'');

        });

    });

    describe('enableForeignKeyChecks', () => {

        it('should return sp_MSforeachtable CHECK CONSTRAINT ALL', () => {

            const sql = mssqlTeardownOperations.enableForeignKeyChecks();

            expect(sql).toBe('EXEC sp_MSforeachtable \'ALTER TABLE ? CHECK CONSTRAINT ALL\'');

        });

    });

    describe('truncateTable', () => {

        it('should generate DELETE FROM (MSSQL cannot TRUNCATE FK-referenced tables)', () => {

            const sql = mssqlTeardownOperations.truncateTable('users');

            expect(sql).toContain('DELETE FROM [users]');

        });

        it('should include DBCC CHECKIDENT when restartIdentity is true', () => {

            const sqlTrue = mssqlTeardownOperations.truncateTable('users', undefined, true);
            const sqlFalse = mssqlTeardownOperations.truncateTable('users', undefined, false);

            expect(sqlTrue).toContain('DBCC CHECKIDENT');
            expect(sqlFalse).toBe('DELETE FROM [users]');

        });

        it('should quote table name with brackets', () => {

            const sql = mssqlTeardownOperations.truncateTable('user_accounts');

            expect(sql).toContain('DELETE FROM [user_accounts]');

        });

        it('should escape closing brackets in table name', () => {

            const sql = mssqlTeardownOperations.truncateTable('table]with]brackets');

            expect(sql).toContain('DELETE FROM [table]]with]]brackets]');

        });

        it('should include schema when provided and not dbo', () => {

            const sql = mssqlTeardownOperations.truncateTable('users', 'sales');

            expect(sql).toContain('DELETE FROM [sales].[users]');

        });

        it('should omit dbo schema', () => {

            const sql = mssqlTeardownOperations.truncateTable('users', 'dbo');

            expect(sql).toContain('DELETE FROM [users]');
            expect(sql).not.toContain('[dbo]');

        });

        it('should escape brackets in schema name', () => {

            const sql = mssqlTeardownOperations.truncateTable('users', 'my]schema');

            expect(sql).toContain('DELETE FROM [my]]schema].[users]');

        });

    });

    describe('dropTable', () => {

        it('should generate DROP TABLE with IF EXISTS', () => {

            const sql = mssqlTeardownOperations.dropTable('users');

            expect(sql).toBe('DROP TABLE IF EXISTS [users]');

        });

        it('should include schema when provided and not dbo', () => {

            const sql = mssqlTeardownOperations.dropTable('users', 'sales');

            expect(sql).toBe('DROP TABLE IF EXISTS [sales].[users]');

        });

        it('should omit dbo schema', () => {

            const sql = mssqlTeardownOperations.dropTable('users', 'dbo');

            expect(sql).toBe('DROP TABLE IF EXISTS [users]');

        });

        it('should escape brackets in table name', () => {

            const sql = mssqlTeardownOperations.dropTable('table]name');

            expect(sql).toBe('DROP TABLE IF EXISTS [table]]name]');

        });

    });

    describe('dropView', () => {

        it('should generate DROP VIEW with IF EXISTS', () => {

            const sql = mssqlTeardownOperations.dropView('user_summary');

            expect(sql).toBe('DROP VIEW IF EXISTS [user_summary]');

        });

        it('should include schema when provided and not dbo', () => {

            const sql = mssqlTeardownOperations.dropView('user_summary', 'reports');

            expect(sql).toBe('DROP VIEW IF EXISTS [reports].[user_summary]');

        });

        it('should omit dbo schema', () => {

            const sql = mssqlTeardownOperations.dropView('user_summary', 'dbo');

            expect(sql).toBe('DROP VIEW IF EXISTS [user_summary]');

        });

        it('should escape brackets in view name', () => {

            const sql = mssqlTeardownOperations.dropView('view]name');

            expect(sql).toBe('DROP VIEW IF EXISTS [view]]name]');

        });

    });

    describe('dropFunction', () => {

        it('should generate DROP FUNCTION with IF EXISTS (for scalar/table functions)', () => {

            const sql = mssqlTeardownOperations.dropFunction('calculate_total');

            expect(sql).toBe('DROP FUNCTION IF EXISTS [calculate_total]');

        });

        it('should include schema when provided and not dbo', () => {

            const sql = mssqlTeardownOperations.dropFunction('calculate_total', 'analytics');

            expect(sql).toBe('DROP FUNCTION IF EXISTS [analytics].[calculate_total]');

        });

        it('should omit dbo schema', () => {

            const sql = mssqlTeardownOperations.dropFunction('calculate_total', 'dbo');

            expect(sql).toBe('DROP FUNCTION IF EXISTS [calculate_total]');

        });

        it('should escape brackets in function name', () => {

            const sql = mssqlTeardownOperations.dropFunction('func]name');

            expect(sql).toBe('DROP FUNCTION IF EXISTS [func]]name]');

        });

    });

    describe('dropProcedure', () => {

        it('should generate DROP PROCEDURE with IF EXISTS', () => {

            const sql = mssqlTeardownOperations.dropProcedure('process_orders');

            expect(sql).toBe('DROP PROCEDURE IF EXISTS [process_orders]');

        });

        it('should include schema when provided and not dbo', () => {

            const sql = mssqlTeardownOperations.dropProcedure('process_orders', 'jobs');

            expect(sql).toBe('DROP PROCEDURE IF EXISTS [jobs].[process_orders]');

        });

        it('should omit dbo schema', () => {

            const sql = mssqlTeardownOperations.dropProcedure('process_orders', 'dbo');

            expect(sql).toBe('DROP PROCEDURE IF EXISTS [process_orders]');

        });

        it('should escape brackets in procedure name', () => {

            const sql = mssqlTeardownOperations.dropProcedure('proc]name');

            expect(sql).toBe('DROP PROCEDURE IF EXISTS [proc]]name]');

        });

    });

    describe('dropType', () => {

        it('should generate DROP TYPE with IF EXISTS', () => {

            const sql = mssqlTeardownOperations.dropType('user_status');

            expect(sql).toBe('DROP TYPE IF EXISTS [user_status]');

        });

        it('should include schema when provided and not dbo', () => {

            const sql = mssqlTeardownOperations.dropType('user_status', 'enums');

            expect(sql).toBe('DROP TYPE IF EXISTS [enums].[user_status]');

        });

        it('should omit dbo schema', () => {

            const sql = mssqlTeardownOperations.dropType('user_status', 'dbo');

            expect(sql).toBe('DROP TYPE IF EXISTS [user_status]');

        });

        it('should escape brackets in type name', () => {

            const sql = mssqlTeardownOperations.dropType('type]name');

            expect(sql).toBe('DROP TYPE IF EXISTS [type]]name]');

        });

    });

    describe('dropForeignKey', () => {

        it('should generate ALTER TABLE DROP CONSTRAINT', () => {

            const sql = mssqlTeardownOperations.dropForeignKey('fk_user_id', 'orders');

            expect(sql).toBe('ALTER TABLE [orders] DROP CONSTRAINT [fk_user_id]');

        });

        it('should include schema when provided and not dbo', () => {

            const sql = mssqlTeardownOperations.dropForeignKey('fk_user_id', 'orders', 'sales');

            expect(sql).toBe('ALTER TABLE [sales].[orders] DROP CONSTRAINT [fk_user_id]');

        });

        it('should omit dbo schema', () => {

            const sql = mssqlTeardownOperations.dropForeignKey('fk_user_id', 'orders', 'dbo');

            expect(sql).toBe('ALTER TABLE [orders] DROP CONSTRAINT [fk_user_id]');

        });

        it('should escape brackets in table name', () => {

            const sql = mssqlTeardownOperations.dropForeignKey('fk_id', 'table]name');

            expect(sql).toBe('ALTER TABLE [table]]name] DROP CONSTRAINT [fk_id]');

        });

        it('should escape brackets in constraint name', () => {

            const sql = mssqlTeardownOperations.dropForeignKey('fk]name', 'orders');

            expect(sql).toBe('ALTER TABLE [orders] DROP CONSTRAINT [fk]]name]');

        });

    });

});
