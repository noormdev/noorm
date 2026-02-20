import { describe, it, expect } from 'bun:test';

import { mssqlTransferOperations } from '../../../../src/core/transfer/dialects/mssql.js';

describe('transfer: mssql dialect', () => {

    describe('getDisableFKSql', () => {

        it('should return placeholder comment (FK disable is per-table)', () => {

            const sql = mssqlTransferOperations.getDisableFKSql();

            expect(sql).toContain('FK disable per-table');

        });

    });

    describe('getEnableFKSql', () => {

        it('should return placeholder comment (FK enable is per-table)', () => {

            const sql = mssqlTransferOperations.getEnableFKSql();

            expect(sql).toContain('FK enable per-table');

        });

    });

    describe('getEnableIdentityInsertSql', () => {

        it('should return SET IDENTITY_INSERT ON', () => {

            const sql = mssqlTransferOperations.getEnableIdentityInsertSql('users');

            expect(sql).toBe('SET IDENTITY_INSERT [users] ON');

        });

        it('should escape brackets in table name', () => {

            const sql = mssqlTransferOperations.getEnableIdentityInsertSql('table]name');

            expect(sql).toBe('SET IDENTITY_INSERT [table]]name] ON');

        });

    });

    describe('getDisableIdentityInsertSql', () => {

        it('should return SET IDENTITY_INSERT OFF', () => {

            const sql = mssqlTransferOperations.getDisableIdentityInsertSql('users');

            expect(sql).toBe('SET IDENTITY_INSERT [users] OFF');

        });

    });

    describe('getResetSequenceSql', () => {

        it('should generate DBCC CHECKIDENT', () => {

            const sql = mssqlTransferOperations.getResetSequenceSql('users', 'id');

            expect(sql).toBe("DBCC CHECKIDENT ('users', RESEED)");

        });

    });

    describe('buildConflictInsert', () => {

        const columns = ['id', 'name', 'email'];
        const primaryKey = ['id'];

        it('should generate basic INSERT for fail strategy', () => {

            const sql = mssqlTransferOperations.buildConflictInsert(
                'users',
                columns,
                primaryKey,
                'fail',
            );

            expect(sql).toBe('INSERT INTO [users] ([id], [name], [email]) VALUES (@p0, @p1, @p2)');

        });

        it('should generate MERGE with WHEN NOT MATCHED for skip strategy', () => {

            const sql = mssqlTransferOperations.buildConflictInsert(
                'users',
                columns,
                primaryKey,
                'skip',
            );

            expect(sql).toContain('MERGE INTO [users] AS target');
            expect(sql).toContain('USING (SELECT @p0 AS [id], @p1 AS [name], @p2 AS [email]) AS source');
            expect(sql).toContain('ON (target.[id] = source.[id])');
            expect(sql).toContain('WHEN NOT MATCHED THEN');
            expect(sql).toContain('INSERT ([id], [name], [email])');
            expect(sql).not.toContain('WHEN MATCHED THEN');

        });

        it('should generate MERGE with UPDATE for update strategy', () => {

            const sql = mssqlTransferOperations.buildConflictInsert(
                'users',
                columns,
                primaryKey,
                'update',
            );

            expect(sql).toContain('MERGE INTO [users] AS target');
            expect(sql).toContain('WHEN MATCHED THEN');
            expect(sql).toContain('UPDATE SET target.[name] = source.[name], target.[email] = source.[email]');
            expect(sql).toContain('WHEN NOT MATCHED THEN');
            expect(sql).toContain('INSERT ([id], [name], [email])');

        });

        it('should generate MERGE with full UPDATE for replace strategy', () => {

            const sql = mssqlTransferOperations.buildConflictInsert(
                'users',
                columns,
                primaryKey,
                'replace',
            );

            expect(sql).toContain('MERGE INTO [users] AS target');
            expect(sql).toContain('WHEN MATCHED THEN');
            expect(sql).toContain('UPDATE SET target.[id] = source.[id], target.[name] = source.[name], target.[email] = source.[email]');
            expect(sql).toContain('WHEN NOT MATCHED THEN');

        });

        it('should handle composite primary keys', () => {

            const sql = mssqlTransferOperations.buildConflictInsert(
                'order_items',
                ['order_id', 'product_id', 'quantity'],
                ['order_id', 'product_id'],
                'skip',
            );

            expect(sql).toContain('ON (target.[order_id] = source.[order_id] AND target.[product_id] = source.[product_id])');

        });

        it('should skip UPDATE clause for update strategy when all columns are PK', () => {

            const sql = mssqlTransferOperations.buildConflictInsert(
                'tags',
                ['id'],
                ['id'],
                'update',
            );

            // Should still have WHEN NOT MATCHED, but no WHEN MATCHED UPDATE
            expect(sql).toContain('WHEN NOT MATCHED THEN');
            expect(sql).not.toContain('WHEN MATCHED THEN');

        });

        it('should escape brackets in identifiers', () => {

            const sql = mssqlTransferOperations.buildConflictInsert(
                'table]name',
                ['col]umn'],
                ['col]umn'],
                'fail',
            );

            expect(sql).toContain('[table]]name]');
            expect(sql).toContain('[col]]umn]');

        });

        it('should end MERGE statements with semicolon', () => {

            const sql = mssqlTransferOperations.buildConflictInsert(
                'users',
                columns,
                primaryKey,
                'skip',
            );

            expect(sql.trim()).toMatch(/;$/);

        });

    });

    describe('buildDirectTransfer', () => {

        it('should generate INSERT...SELECT with four-part naming', () => {

            const sql = mssqlTransferOperations.buildDirectTransfer(
                'source_db',
                'users',
                'users',
                ['id', 'name', 'email'],
            );

            expect(sql).toBe('INSERT INTO [dbo].[users] ([id], [name], [email]) SELECT [id], [name], [email] FROM [source_db].[dbo].[users]');

        });

        it('should use custom schemas', () => {

            const sql = mssqlTransferOperations.buildDirectTransfer(
                'source_db',
                'users',
                'users',
                ['id', 'name'],
                'src_schema',
                'dst_schema',
            );

            expect(sql).toContain('[dst_schema].[users]');
            expect(sql).toContain('[source_db].[src_schema].[users]');

        });

        it('should default to dbo schema', () => {

            const sql = mssqlTransferOperations.buildDirectTransfer(
                'source_db',
                'users',
                'users',
                ['id'],
            );

            expect(sql).toContain('[dbo].[users]');

        });

        it('should escape brackets in identifiers', () => {

            const sql = mssqlTransferOperations.buildDirectTransfer(
                'source]db',
                'table]name',
                'dest]table',
                ['col]umn'],
            );

            expect(sql).toContain('[source]]db]');
            expect(sql).toContain('[table]]name]');
            expect(sql).toContain('[dest]]table]');
            expect(sql).toContain('[col]]umn]');

        });

    });

});
