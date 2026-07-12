import { describe, it, expect } from 'bun:test';

import {
    buildCreateDatabaseSql,
    buildDropDatabaseSql,
} from '../../../../src/core/db/dialects/mysql.js';

describe('db: mysql dialect', () => {

    describe('buildCreateDatabaseSql', () => {

        it('should generate CREATE DATABASE IF NOT EXISTS with a backtick-quoted identifier', () => {

            const sql = buildCreateDatabaseSql('myapp');

            expect(sql).toBe('CREATE DATABASE IF NOT EXISTS `myapp`');

        });

        it('should escape embedded backticks (adversarial)', () => {

            const sql = buildCreateDatabaseSql('my`app');

            expect(sql).toBe('CREATE DATABASE IF NOT EXISTS `my``app`');

        });

        it('should keep an embedded double quote literal inside the quoted identifier (adversarial)', () => {

            const sql = buildCreateDatabaseSql('my"app');

            expect(sql).toBe('CREATE DATABASE IF NOT EXISTS `my"app`');

        });

        it('should keep an embedded bracket literal inside the quoted identifier (adversarial)', () => {

            const sql = buildCreateDatabaseSql('my]app');

            expect(sql).toBe('CREATE DATABASE IF NOT EXISTS `my]app`');

        });

        it('should keep an embedded single quote literal inside the quoted identifier (adversarial)', () => {

            const sql = buildCreateDatabaseSql('my\'app');

            expect(sql).toBe('CREATE DATABASE IF NOT EXISTS `my\'app`');

        });

        it('should neutralize a semicolon injection payload as a single escaped identifier (adversarial)', () => {

            const sql = buildCreateDatabaseSql('x`; DROP DATABASE other; --');

            expect(sql).toBe('CREATE DATABASE IF NOT EXISTS `x``; DROP DATABASE other; --`');

        });

    });

    describe('buildDropDatabaseSql', () => {

        it('should generate DROP DATABASE IF EXISTS with a backtick-quoted identifier', () => {

            const sql = buildDropDatabaseSql('myapp');

            expect(sql).toBe('DROP DATABASE IF EXISTS `myapp`');

        });

        it('should escape embedded backticks (adversarial)', () => {

            const sql = buildDropDatabaseSql('my`app');

            expect(sql).toBe('DROP DATABASE IF EXISTS `my``app`');

        });

        it('should keep an embedded double quote literal inside the quoted identifier (adversarial)', () => {

            const sql = buildDropDatabaseSql('my"app');

            expect(sql).toBe('DROP DATABASE IF EXISTS `my"app`');

        });

        it('should keep an embedded bracket literal inside the quoted identifier (adversarial)', () => {

            const sql = buildDropDatabaseSql('my]app');

            expect(sql).toBe('DROP DATABASE IF EXISTS `my]app`');

        });

        it('should keep an embedded single quote literal inside the quoted identifier (adversarial)', () => {

            const sql = buildDropDatabaseSql('my\'app');

            expect(sql).toBe('DROP DATABASE IF EXISTS `my\'app`');

        });

        it('should neutralize a semicolon injection payload as a single escaped identifier (adversarial)', () => {

            const sql = buildDropDatabaseSql('x`; DROP DATABASE other; --');

            expect(sql).toBe('DROP DATABASE IF EXISTS `x``; DROP DATABASE other; --`');

        });

    });

});
