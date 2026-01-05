import { describe, it, expect } from 'vitest';

import { mysqlTeardownOperations } from '../../../../src/core/teardown/dialects/mysql.js';

describe('teardown: mysql dialect', () => {

    describe('disableForeignKeyChecks', () => {

        it('should return SET FOREIGN_KEY_CHECKS = 0', () => {

            const sql = mysqlTeardownOperations.disableForeignKeyChecks();

            expect(sql).toBe('SET FOREIGN_KEY_CHECKS = 0');

        });

    });

    describe('enableForeignKeyChecks', () => {

        it('should return SET FOREIGN_KEY_CHECKS = 1', () => {

            const sql = mysqlTeardownOperations.enableForeignKeyChecks();

            expect(sql).toBe('SET FOREIGN_KEY_CHECKS = 1');

        });

    });

    describe('truncateTable', () => {

        it('should generate TRUNCATE TABLE without RESTART IDENTITY', () => {

            const sql = mysqlTeardownOperations.truncateTable('users');

            expect(sql).toBe('TRUNCATE TABLE `users`');

        });

        it('should ignore restartIdentity parameter (always resets AUTO_INCREMENT)', () => {

            const sqlTrue = mysqlTeardownOperations.truncateTable('users', undefined, true);
            const sqlFalse = mysqlTeardownOperations.truncateTable('users', undefined, false);

            expect(sqlTrue).toBe('TRUNCATE TABLE `users`');
            expect(sqlFalse).toBe('TRUNCATE TABLE `users`');

        });

        it('should quote table name with backticks', () => {

            const sql = mysqlTeardownOperations.truncateTable('user_accounts');

            expect(sql).toBe('TRUNCATE TABLE `user_accounts`');

        });

        it('should escape backticks in table name', () => {

            const sql = mysqlTeardownOperations.truncateTable('table`with`quotes');

            expect(sql).toBe('TRUNCATE TABLE `table``with``quotes`');

        });

        it('should include database/schema when provided', () => {

            const sql = mysqlTeardownOperations.truncateTable('users', 'mydb');

            expect(sql).toBe('TRUNCATE TABLE `mydb`.`users`');

        });

        it('should escape backticks in database name', () => {

            const sql = mysqlTeardownOperations.truncateTable('users', 'my`db');

            expect(sql).toBe('TRUNCATE TABLE `my``db`.`users`');

        });

    });

    describe('dropTable', () => {

        it('should generate DROP TABLE with IF EXISTS', () => {

            const sql = mysqlTeardownOperations.dropTable('users');

            expect(sql).toBe('DROP TABLE IF EXISTS `users`');

        });

        it('should include database when provided', () => {

            const sql = mysqlTeardownOperations.dropTable('users', 'mydb');

            expect(sql).toBe('DROP TABLE IF EXISTS `mydb`.`users`');

        });

        it('should escape backticks in table name', () => {

            const sql = mysqlTeardownOperations.dropTable('table`name');

            expect(sql).toBe('DROP TABLE IF EXISTS `table``name`');

        });

    });

    describe('dropView', () => {

        it('should generate DROP VIEW with IF EXISTS', () => {

            const sql = mysqlTeardownOperations.dropView('user_summary');

            expect(sql).toBe('DROP VIEW IF EXISTS `user_summary`');

        });

        it('should include database when provided', () => {

            const sql = mysqlTeardownOperations.dropView('user_summary', 'reports');

            expect(sql).toBe('DROP VIEW IF EXISTS `reports`.`user_summary`');

        });

        it('should escape backticks in view name', () => {

            const sql = mysqlTeardownOperations.dropView('view`name');

            expect(sql).toBe('DROP VIEW IF EXISTS `view``name`');

        });

    });

    describe('dropFunction', () => {

        it('should generate DROP FUNCTION with IF EXISTS', () => {

            const sql = mysqlTeardownOperations.dropFunction('calculate_total');

            expect(sql).toBe('DROP FUNCTION IF EXISTS `calculate_total`');

        });

        it('should include database when provided', () => {

            const sql = mysqlTeardownOperations.dropFunction('calculate_total', 'analytics');

            expect(sql).toBe('DROP FUNCTION IF EXISTS `analytics`.`calculate_total`');

        });

        it('should escape backticks in function name', () => {

            const sql = mysqlTeardownOperations.dropFunction('func`name');

            expect(sql).toBe('DROP FUNCTION IF EXISTS `func``name`');

        });

    });

    describe('dropProcedure', () => {

        it('should generate DROP PROCEDURE with IF EXISTS', () => {

            const sql = mysqlTeardownOperations.dropProcedure('calculate_total');

            expect(sql).toBe('DROP PROCEDURE IF EXISTS `calculate_total`');

        });

        it('should include database when provided', () => {

            const sql = mysqlTeardownOperations.dropProcedure('calculate_total', 'analytics');

            expect(sql).toBe('DROP PROCEDURE IF EXISTS `analytics`.`calculate_total`');

        });

        it('should escape backticks in procedure name', () => {

            const sql = mysqlTeardownOperations.dropProcedure('proc`name');

            expect(sql).toBe('DROP PROCEDURE IF EXISTS `proc``name`');

        });

    });

    describe('dropType', () => {

        it('should return comment indicating MySQL does not support custom types', () => {

            const sql = mysqlTeardownOperations.dropType('user_status');

            expect(sql).toBe('-- MySQL does not support custom types');

        });

        it('should return same comment regardless of parameters', () => {

            const sql1 = mysqlTeardownOperations.dropType('status');
            const sql2 = mysqlTeardownOperations.dropType('status', 'mydb');

            expect(sql1).toBe('-- MySQL does not support custom types');
            expect(sql2).toBe('-- MySQL does not support custom types');

        });

    });

    describe('dropForeignKey', () => {

        it('should generate ALTER TABLE DROP FOREIGN KEY', () => {

            const sql = mysqlTeardownOperations.dropForeignKey('fk_user_id', 'orders');

            expect(sql).toBe('ALTER TABLE `orders` DROP FOREIGN KEY `fk_user_id`');

        });

        it('should include database when provided', () => {

            const sql = mysqlTeardownOperations.dropForeignKey('fk_user_id', 'orders', 'sales');

            expect(sql).toBe('ALTER TABLE `sales`.`orders` DROP FOREIGN KEY `fk_user_id`');

        });

        it('should escape backticks in table name', () => {

            const sql = mysqlTeardownOperations.dropForeignKey('fk_id', 'table`name');

            expect(sql).toBe('ALTER TABLE `table``name` DROP FOREIGN KEY `fk_id`');

        });

        it('should escape backticks in constraint name', () => {

            const sql = mysqlTeardownOperations.dropForeignKey('fk`name', 'orders');

            expect(sql).toBe('ALTER TABLE `orders` DROP FOREIGN KEY `fk``name`');

        });

    });

});
