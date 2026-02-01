import { describe, it, expect } from 'vitest';

import { mysqlTransferOperations } from '../../../../src/core/transfer/dialects/mysql.js';

describe('transfer: mysql dialect', () => {

    describe('getDisableFKSql', () => {

        it('should return SET FOREIGN_KEY_CHECKS = 0', () => {

            const sql = mysqlTransferOperations.getDisableFKSql();

            expect(sql).toBe('SET FOREIGN_KEY_CHECKS = 0');

        });

    });

    describe('getEnableFKSql', () => {

        it('should return SET FOREIGN_KEY_CHECKS = 1', () => {

            const sql = mysqlTransferOperations.getEnableFKSql();

            expect(sql).toBe('SET FOREIGN_KEY_CHECKS = 1');

        });

    });

    describe('getEnableIdentityInsertSql', () => {

        it('should return null (MySQL allows explicit IDs without mode)', () => {

            const sql = mysqlTransferOperations.getEnableIdentityInsertSql('users');

            expect(sql).toBeNull();

        });

    });

    describe('getDisableIdentityInsertSql', () => {

        it('should return null', () => {

            const sql = mysqlTransferOperations.getDisableIdentityInsertSql('users');

            expect(sql).toBeNull();

        });

    });

    describe('getResetSequenceSql', () => {

        it('should generate ALTER TABLE AUTO_INCREMENT', () => {

            const sql = mysqlTransferOperations.getResetSequenceSql('users', 'id');

            expect(sql).toBe('ALTER TABLE `users` AUTO_INCREMENT = 1');

        });

        it('should escape backticks in table name', () => {

            const sql = mysqlTransferOperations.getResetSequenceSql('table`name', 'id');

            expect(sql).toBe('ALTER TABLE `table``name` AUTO_INCREMENT = 1');

        });

    });

    describe('buildConflictInsert', () => {

        const columns = ['id', 'name', 'email'];
        const primaryKey = ['id'];

        it('should generate basic INSERT for fail strategy', () => {

            const sql = mysqlTransferOperations.buildConflictInsert(
                'users',
                columns,
                primaryKey,
                'fail',
            );

            expect(sql).toBe('INSERT INTO `users` (`id`, `name`, `email`) VALUES (?, ?, ?)');

        });

        it('should generate INSERT IGNORE for skip strategy', () => {

            const sql = mysqlTransferOperations.buildConflictInsert(
                'users',
                columns,
                primaryKey,
                'skip',
            );

            expect(sql).toBe('INSERT IGNORE INTO `users` (`id`, `name`, `email`) VALUES (?, ?, ?)');

        });

        it('should generate INSERT with ON DUPLICATE KEY UPDATE for update strategy', () => {

            const sql = mysqlTransferOperations.buildConflictInsert(
                'users',
                columns,
                primaryKey,
                'update',
            );

            expect(sql).toBe('INSERT INTO `users` (`id`, `name`, `email`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `email` = VALUES(`email`)');

        });

        it('should generate REPLACE INTO for replace strategy', () => {

            const sql = mysqlTransferOperations.buildConflictInsert(
                'users',
                columns,
                primaryKey,
                'replace',
            );

            expect(sql).toBe('REPLACE INTO `users` (`id`, `name`, `email`) VALUES (?, ?, ?)');

        });

        it('should handle composite primary keys', () => {

            const sql = mysqlTransferOperations.buildConflictInsert(
                'order_items',
                ['order_id', 'product_id', 'quantity'],
                ['order_id', 'product_id'],
                'update',
            );

            expect(sql).toContain('ON DUPLICATE KEY UPDATE `quantity` = VALUES(`quantity`)');

        });

        it('should use INSERT IGNORE for update when all columns are PK', () => {

            const sql = mysqlTransferOperations.buildConflictInsert(
                'tags',
                ['id'],
                ['id'],
                'update',
            );

            expect(sql).toBe('INSERT IGNORE INTO `tags` (`id`) VALUES (?)');

        });

        it('should escape backticks in identifiers', () => {

            const sql = mysqlTransferOperations.buildConflictInsert(
                'table`name',
                ['col`umn'],
                ['col`umn'],
                'fail',
            );

            expect(sql).toContain('`table``name`');
            expect(sql).toContain('`col``umn`');

        });

    });

    describe('buildDirectTransfer', () => {

        it('should generate INSERT...SELECT with database prefix', () => {

            const sql = mysqlTransferOperations.buildDirectTransfer(
                'source_db',
                'users',
                'users',
                ['id', 'name', 'email'],
            );

            expect(sql).toBe('INSERT INTO `users` (`id`, `name`, `email`) SELECT `id`, `name`, `email` FROM `source_db`.`users`');

        });

        it('should escape backticks in identifiers', () => {

            const sql = mysqlTransferOperations.buildDirectTransfer(
                'source`db',
                'table`name',
                'dest`table',
                ['col`umn'],
            );

            expect(sql).toContain('`source``db`');
            expect(sql).toContain('`table``name`');
            expect(sql).toContain('`dest``table`');
            expect(sql).toContain('`col``umn`');

        });

    });

});
