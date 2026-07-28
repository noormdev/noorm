import { describe, it, expect } from 'bun:test';

import {
    buildCreateDatabaseSql,
    buildDropDatabaseSql,
} from '../../../../src/core/db/dialects/mssql.js';

describe('db: mssql dialect', () => {

    describe('buildCreateDatabaseSql', () => {

        it('should generate CREATE DATABASE with a bracket-quoted identifier', () => {

            const sql = buildCreateDatabaseSql('myapp');

            expect(sql).toBe('CREATE DATABASE [myapp]');

        });

        it('should escape embedded closing brackets (adversarial)', () => {

            const sql = buildCreateDatabaseSql('my]app');

            expect(sql).toBe('CREATE DATABASE [my]]app]');

        });

        it('should keep an embedded double quote literal inside the quoted identifier (adversarial)', () => {

            const sql = buildCreateDatabaseSql('my"app');

            expect(sql).toBe('CREATE DATABASE [my"app]');

        });

        it('should keep an embedded backtick literal inside the quoted identifier (adversarial)', () => {

            const sql = buildCreateDatabaseSql('my`app');

            expect(sql).toBe('CREATE DATABASE [my`app]');

        });

        it('should keep an embedded single quote literal inside the quoted identifier (adversarial)', () => {

            const sql = buildCreateDatabaseSql('my\'app');

            expect(sql).toBe('CREATE DATABASE [my\'app]');

        });

        it('should neutralize a semicolon injection payload as a single escaped identifier (adversarial)', () => {

            const sql = buildCreateDatabaseSql('x]; DROP DATABASE other; --');

            expect(sql).toBe('CREATE DATABASE [x]]; DROP DATABASE other; --]');

        });

    });

    describe('buildDropDatabaseSql', () => {

        function expectedBatch(literal: string, identifier: string): string {

            return [
                `IF EXISTS(SELECT 1 FROM sys.databases WHERE name = '${literal}')`,
                'BEGIN',
                `    ALTER DATABASE ${identifier} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;`,
                `    DROP DATABASE ${identifier};`,
                'END',
            ].join('\n');

        }

        it('should generate the IF EXISTS / BEGIN / ALTER+DROP / END batch with bracket-quoted identifiers', () => {

            const sql = buildDropDatabaseSql('myapp');

            expect(sql).toBe(expectedBatch('myapp', '[myapp]'));

        });

        it('should double an embedded single quote in the string literal only (adversarial)', () => {

            const sql = buildDropDatabaseSql('my\'app');

            expect(sql).toBe(expectedBatch('my\'\'app', '[my\'app]'));

        });

        it('should escape an embedded closing bracket in the identifiers only (adversarial)', () => {

            const sql = buildDropDatabaseSql('my]app');

            expect(sql).toBe(expectedBatch('my]app', '[my]]app]'));

        });

        it('should keep an embedded double quote literal untouched (adversarial)', () => {

            const sql = buildDropDatabaseSql('my"app');

            expect(sql).toBe(expectedBatch('my"app', '[my"app]'));

        });

        it('should keep an embedded backtick literal untouched (adversarial)', () => {

            const sql = buildDropDatabaseSql('my`app');

            expect(sql).toBe(expectedBatch('my`app', '[my`app]'));

        });

        it('cannot be broken out of by a semicolon + quote injection payload (adversarial)', () => {

            const sql = buildDropDatabaseSql('x\'; DROP DATABASE other; --');

            expect(sql).toBe(
                expectedBatch('x\'\'; DROP DATABASE other; --', '[x\'; DROP DATABASE other; --]'),
            );

        });

        it('escapes the quote and the bracket independently when both are present (adversarial)', () => {

            // Literal context (single quote) and identifier context (bracket)
            // each escape only their own delimiter — one context's fix-up
            // must not bleed into the other.
            const sql = buildDropDatabaseSql('my\']db');

            expect(sql).toBe(expectedBatch('my\'\']db', '[my\']]db]'));

        });

    });

});
