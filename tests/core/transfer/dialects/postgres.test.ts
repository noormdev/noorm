import { describe, it, expect } from 'bun:test';

import { postgresTransferOperations } from '../../../../src/core/transfer/dialects/postgres.js';

describe('transfer: postgres dialect', () => {

    describe('getDisableFKSql', () => {

        it('should return session_replication_role = replica', () => {

            const sql = postgresTransferOperations.getDisableFKSql();

            expect(sql).toBe('SET session_replication_role = replica');

        });

    });

    describe('getEnableFKSql', () => {

        it('should return session_replication_role = DEFAULT', () => {

            const sql = postgresTransferOperations.getEnableFKSql();

            expect(sql).toBe('SET session_replication_role = DEFAULT');

        });

    });

    describe('getEnableIdentityInsertSql', () => {

        it('should return null (PostgreSQL uses OVERRIDING SYSTEM VALUE)', () => {

            const sql = postgresTransferOperations.getEnableIdentityInsertSql('users');

            expect(sql).toBeNull();

        });

    });

    describe('getDisableIdentityInsertSql', () => {

        it('should return null', () => {

            const sql = postgresTransferOperations.getDisableIdentityInsertSql('users');

            expect(sql).toBeNull();

        });

    });

    describe('getResetSequenceSql', () => {

        it('should generate setval for simple table', () => {

            const sql = postgresTransferOperations.getResetSequenceSql('users', 'id');

            expect(sql).toContain('setval');
            expect(sql).toContain("pg_get_serial_sequence('users', 'id')");
            expect(sql).toContain('MAX("id")');
            expect(sql).toContain('"users"');

        });

        it('should include schema in sequence lookup', () => {

            const sql = postgresTransferOperations.getResetSequenceSql('users', 'id', 'custom');

            expect(sql).toContain("pg_get_serial_sequence('custom.users', 'id')");
            expect(sql).toContain('"custom"."users"');

        });

    });

    describe('buildConflictInsert', () => {

        const columns = ['id', 'name', 'email'];
        const primaryKey = ['id'];

        it('should generate basic INSERT for fail strategy', () => {

            const sql = postgresTransferOperations.buildConflictInsert(
                'users',
                columns,
                primaryKey,
                'fail',
            );

            expect(sql).toBe('INSERT INTO "users" ("id", "name", "email") OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3)');

        });

        it('should generate INSERT with DO NOTHING for skip strategy', () => {

            const sql = postgresTransferOperations.buildConflictInsert(
                'users',
                columns,
                primaryKey,
                'skip',
            );

            expect(sql).toBe('INSERT INTO "users" ("id", "name", "email") OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3) ON CONFLICT ("id") DO NOTHING');

        });

        it('should generate INSERT with DO UPDATE for update strategy', () => {

            const sql = postgresTransferOperations.buildConflictInsert(
                'users',
                columns,
                primaryKey,
                'update',
            );

            expect(sql).toBe('INSERT INTO "users" ("id", "name", "email") OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3) ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "email" = EXCLUDED."email"');

        });

        it('should generate INSERT with DO UPDATE all columns for replace strategy', () => {

            const sql = postgresTransferOperations.buildConflictInsert(
                'users',
                columns,
                primaryKey,
                'replace',
            );

            expect(sql).toBe('INSERT INTO "users" ("id", "name", "email") OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3) ON CONFLICT ("id") DO UPDATE SET "id" = EXCLUDED."id", "name" = EXCLUDED."name", "email" = EXCLUDED."email"');

        });

        it('should handle composite primary keys', () => {

            const sql = postgresTransferOperations.buildConflictInsert(
                'order_items',
                ['order_id', 'product_id', 'quantity'],
                ['order_id', 'product_id'],
                'skip',
            );

            expect(sql).toContain('ON CONFLICT ("order_id", "product_id") DO NOTHING');

        });

        it('should use DO NOTHING for update when all columns are PK', () => {

            const sql = postgresTransferOperations.buildConflictInsert(
                'tags',
                ['id'],
                ['id'],
                'update',
            );

            expect(sql).toContain('ON CONFLICT ("id") DO NOTHING');

        });

        it('should escape double quotes in identifiers', () => {

            const sql = postgresTransferOperations.buildConflictInsert(
                'table"name',
                ['col"umn'],
                ['col"umn'],
                'fail',
            );

            expect(sql).toContain('"table""name"');
            expect(sql).toContain('"col""umn"');

        });

    });

    // These previously asserted the emitted INSERT...SELECT, which is exactly
    // the defect: srcDb was discarded, so the statement read from and wrote to
    // the same table. There is no correct statement to assert — postgres needs
    // dblink/postgres_fdw to reach another database — so the contract is now
    // "refuse loudly".
    describe('buildDirectTransfer', () => {

        it('should refuse rather than emit a self-copy', () => {

            expect(() => postgresTransferOperations.buildDirectTransfer(
                'source_db',
                'users',
                'users',
                ['id', 'name', 'email'],
            )).toThrow(/dblink or postgres_fdw/);

        });

        it('should name the source it could not reach', () => {

            expect(() => postgresTransferOperations.buildDirectTransfer(
                'source_db',
                'users',
                'users',
                ['id'],
            )).toThrow(/source_db\.users/);

        });

    });

});
