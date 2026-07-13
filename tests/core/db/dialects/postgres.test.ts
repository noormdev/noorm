import { describe, it, expect } from 'bun:test';

import {
    buildCreateDatabaseSql,
    buildDropDatabaseSql,
} from '../../../../src/core/db/dialects/postgres.js';

describe('db: postgres dialect', () => {

    describe('buildCreateDatabaseSql', () => {

        it('should generate CREATE DATABASE with a quoted identifier', () => {

            const sql = buildCreateDatabaseSql('myapp');

            expect(sql).toBe('CREATE DATABASE "myapp"');

        });

        it('should escape embedded double quotes (adversarial)', () => {

            const sql = buildCreateDatabaseSql('my"app');

            expect(sql).toBe('CREATE DATABASE "my""app"');

        });

        it('should keep an embedded backtick literal inside the quoted identifier (adversarial)', () => {

            const sql = buildCreateDatabaseSql('my`app');

            expect(sql).toBe('CREATE DATABASE "my`app"');

        });

        it('should keep an embedded bracket literal inside the quoted identifier (adversarial)', () => {

            const sql = buildCreateDatabaseSql('my]app');

            expect(sql).toBe('CREATE DATABASE "my]app"');

        });

        it('should keep an embedded single quote literal inside the quoted identifier (adversarial)', () => {

            const sql = buildCreateDatabaseSql('my\'app');

            expect(sql).toBe('CREATE DATABASE "my\'app"');

        });

        it('should neutralize a semicolon injection payload as a single escaped identifier (adversarial)', () => {

            const sql = buildCreateDatabaseSql('x"; DROP DATABASE other; --');

            expect(sql).toBe('CREATE DATABASE "x""; DROP DATABASE other; --"');

        });

    });

    describe('buildDropDatabaseSql', () => {

        it('should generate DROP DATABASE IF EXISTS with a quoted identifier', () => {

            const sql = buildDropDatabaseSql('myapp');

            expect(sql).toBe('DROP DATABASE IF EXISTS "myapp"');

        });

        it('should escape embedded double quotes (adversarial)', () => {

            const sql = buildDropDatabaseSql('my"app');

            expect(sql).toBe('DROP DATABASE IF EXISTS "my""app"');

        });

        it('should keep an embedded backtick literal inside the quoted identifier (adversarial)', () => {

            const sql = buildDropDatabaseSql('my`app');

            expect(sql).toBe('DROP DATABASE IF EXISTS "my`app"');

        });

        it('should keep an embedded bracket literal inside the quoted identifier (adversarial)', () => {

            const sql = buildDropDatabaseSql('my]app');

            expect(sql).toBe('DROP DATABASE IF EXISTS "my]app"');

        });

        it('should keep an embedded single quote literal inside the quoted identifier (adversarial)', () => {

            const sql = buildDropDatabaseSql('my\'app');

            expect(sql).toBe('DROP DATABASE IF EXISTS "my\'app"');

        });

        it('should neutralize a semicolon injection payload as a single escaped identifier (adversarial)', () => {

            const sql = buildDropDatabaseSql('x"; DROP DATABASE other; --');

            expect(sql).toBe('DROP DATABASE IF EXISTS "x""; DROP DATABASE other; --"');

        });

    });

});
