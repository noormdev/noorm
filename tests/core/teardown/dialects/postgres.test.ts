import { describe, it, expect } from 'vitest';

import { postgresTeardownOperations } from '../../../../src/core/teardown/dialects/postgres.js';

describe('teardown: postgres dialect', () => {

    describe('disableForeignKeyChecks', () => {

        it('should return session replication role SQL', () => {

            const sql = postgresTeardownOperations.disableForeignKeyChecks();

            expect(sql).toBe('SET session_replication_role = \'replica\'');

        });

    });

    describe('enableForeignKeyChecks', () => {

        it('should return origin replication role SQL', () => {

            const sql = postgresTeardownOperations.enableForeignKeyChecks();

            expect(sql).toBe('SET session_replication_role = \'origin\'');

        });

    });

    describe('truncateTable', () => {

        it('should generate TRUNCATE with RESTART IDENTITY by default', () => {

            const sql = postgresTeardownOperations.truncateTable('users');

            expect(sql).toBe('TRUNCATE TABLE "users" RESTART IDENTITY CASCADE');

        });

        it('should generate TRUNCATE without RESTART IDENTITY when disabled', () => {

            const sql = postgresTeardownOperations.truncateTable('users', undefined, false);

            expect(sql).toBe('TRUNCATE TABLE "users" CASCADE');

        });

        it('should quote table name with double quotes', () => {

            const sql = postgresTeardownOperations.truncateTable('user_accounts');

            expect(sql).toBe('TRUNCATE TABLE "user_accounts" RESTART IDENTITY CASCADE');

        });

        it('should escape double quotes in table name', () => {

            const sql = postgresTeardownOperations.truncateTable('table"with"quotes');

            expect(sql).toBe('TRUNCATE TABLE "table""with""quotes" RESTART IDENTITY CASCADE');

        });

        it('should include schema when provided and not public', () => {

            const sql = postgresTeardownOperations.truncateTable('users', 'private');

            expect(sql).toBe('TRUNCATE TABLE "private"."users" RESTART IDENTITY CASCADE');

        });

        it('should omit public schema', () => {

            const sql = postgresTeardownOperations.truncateTable('users', 'public');

            expect(sql).toBe('TRUNCATE TABLE "users" RESTART IDENTITY CASCADE');

        });

        it('should escape quotes in schema name', () => {

            const sql = postgresTeardownOperations.truncateTable('users', 'my"schema');

            expect(sql).toBe('TRUNCATE TABLE "my""schema"."users" RESTART IDENTITY CASCADE');

        });

    });

    describe('dropTable', () => {

        it('should generate DROP TABLE with IF EXISTS and CASCADE', () => {

            const sql = postgresTeardownOperations.dropTable('users');

            expect(sql).toBe('DROP TABLE IF EXISTS "users" CASCADE');

        });

        it('should include schema when provided and not public', () => {

            const sql = postgresTeardownOperations.dropTable('users', 'private');

            expect(sql).toBe('DROP TABLE IF EXISTS "private"."users" CASCADE');

        });

        it('should omit public schema', () => {

            const sql = postgresTeardownOperations.dropTable('users', 'public');

            expect(sql).toBe('DROP TABLE IF EXISTS "users" CASCADE');

        });

        it('should escape quotes in table name', () => {

            const sql = postgresTeardownOperations.dropTable('table"name');

            expect(sql).toBe('DROP TABLE IF EXISTS "table""name" CASCADE');

        });

    });

    describe('dropView', () => {

        it('should generate DROP VIEW with IF EXISTS and CASCADE', () => {

            const sql = postgresTeardownOperations.dropView('user_summary');

            expect(sql).toBe('DROP VIEW IF EXISTS "user_summary" CASCADE');

        });

        it('should include schema when provided and not public', () => {

            const sql = postgresTeardownOperations.dropView('user_summary', 'reports');

            expect(sql).toBe('DROP VIEW IF EXISTS "reports"."user_summary" CASCADE');

        });

        it('should omit public schema', () => {

            const sql = postgresTeardownOperations.dropView('user_summary', 'public');

            expect(sql).toBe('DROP VIEW IF EXISTS "user_summary" CASCADE');

        });

        it('should escape quotes in view name', () => {

            const sql = postgresTeardownOperations.dropView('view"name');

            expect(sql).toBe('DROP VIEW IF EXISTS "view""name" CASCADE');

        });

    });

    describe('dropFunction', () => {

        it('should generate DROP FUNCTION with IF EXISTS and CASCADE', () => {

            const sql = postgresTeardownOperations.dropFunction('calculate_total');

            expect(sql).toBe('DROP FUNCTION IF EXISTS "calculate_total" CASCADE');

        });

        it('should include schema when provided and not public', () => {

            const sql = postgresTeardownOperations.dropFunction('calculate_total', 'analytics');

            expect(sql).toBe('DROP FUNCTION IF EXISTS "analytics"."calculate_total" CASCADE');

        });

        it('should omit public schema', () => {

            const sql = postgresTeardownOperations.dropFunction('calculate_total', 'public');

            expect(sql).toBe('DROP FUNCTION IF EXISTS "calculate_total" CASCADE');

        });

        it('should escape quotes in function name', () => {

            const sql = postgresTeardownOperations.dropFunction('func"name');

            expect(sql).toBe('DROP FUNCTION IF EXISTS "func""name" CASCADE');

        });

    });

    describe('dropProcedure', () => {

        it('should generate DROP PROCEDURE with IF EXISTS and CASCADE', () => {

            const sql = postgresTeardownOperations.dropProcedure('process_orders');

            expect(sql).toBe('DROP PROCEDURE IF EXISTS "process_orders" CASCADE');

        });

        it('should include schema when provided and not public', () => {

            const sql = postgresTeardownOperations.dropProcedure('process_orders', 'jobs');

            expect(sql).toBe('DROP PROCEDURE IF EXISTS "jobs"."process_orders" CASCADE');

        });

        it('should omit public schema', () => {

            const sql = postgresTeardownOperations.dropProcedure('process_orders', 'public');

            expect(sql).toBe('DROP PROCEDURE IF EXISTS "process_orders" CASCADE');

        });

        it('should escape quotes in procedure name', () => {

            const sql = postgresTeardownOperations.dropProcedure('proc"name');

            expect(sql).toBe('DROP PROCEDURE IF EXISTS "proc""name" CASCADE');

        });

    });

    describe('dropType', () => {

        it('should generate DROP TYPE with IF EXISTS and CASCADE', () => {

            const sql = postgresTeardownOperations.dropType('user_status');

            expect(sql).toBe('DROP TYPE IF EXISTS "user_status" CASCADE');

        });

        it('should include schema when provided and not public', () => {

            const sql = postgresTeardownOperations.dropType('user_status', 'enums');

            expect(sql).toBe('DROP TYPE IF EXISTS "enums"."user_status" CASCADE');

        });

        it('should omit public schema', () => {

            const sql = postgresTeardownOperations.dropType('user_status', 'public');

            expect(sql).toBe('DROP TYPE IF EXISTS "user_status" CASCADE');

        });

        it('should escape quotes in type name', () => {

            const sql = postgresTeardownOperations.dropType('type"name');

            expect(sql).toBe('DROP TYPE IF EXISTS "type""name" CASCADE');

        });

    });

    describe('dropForeignKey', () => {

        it('should generate ALTER TABLE DROP CONSTRAINT with IF EXISTS', () => {

            const sql = postgresTeardownOperations.dropForeignKey('fk_user_id', 'orders');

            expect(sql).toBe('ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "fk_user_id"');

        });

        it('should include schema when provided and not public', () => {

            const sql = postgresTeardownOperations.dropForeignKey('fk_user_id', 'orders', 'sales');

            expect(sql).toBe('ALTER TABLE "sales"."orders" DROP CONSTRAINT IF EXISTS "fk_user_id"');

        });

        it('should omit public schema', () => {

            const sql = postgresTeardownOperations.dropForeignKey('fk_user_id', 'orders', 'public');

            expect(sql).toBe('ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "fk_user_id"');

        });

        it('should escape quotes in table name', () => {

            const sql = postgresTeardownOperations.dropForeignKey('fk_id', 'table"name');

            expect(sql).toBe('ALTER TABLE "table""name" DROP CONSTRAINT IF EXISTS "fk_id"');

        });

        it('should escape quotes in constraint name', () => {

            const sql = postgresTeardownOperations.dropForeignKey('fk"name', 'orders');

            expect(sql).toBe('ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "fk""name"');

        });

    });

});
