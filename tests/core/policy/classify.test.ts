/**
 * Access policy: classifyStatements.
 */
import { describe, it, expect } from 'bun:test';
import { classifyStatements } from '../../../src/core/policy/index.js';

describe('policy: classifyStatements', () => {

    describe('read', () => {

        it('should classify SELECT as read', () => {

            expect(classifyStatements('SELECT * FROM users', 'postgres')).toBe('read');

        });

        it('should classify lowercase select as read', () => {

            expect(classifyStatements('select 1', 'postgres')).toBe('read');

        });

        it('should classify EXPLAIN as read', () => {

            expect(classifyStatements('EXPLAIN SELECT * FROM users', 'postgres')).toBe('read');

        });

        it('should classify SHOW as read on mysql', () => {

            expect(classifyStatements('SHOW TABLES', 'mysql')).toBe('read');

        });

        it('should classify DESCRIBE as read on mssql (keyword fallback)', () => {

            expect(classifyStatements('DESCRIBE users', 'mssql')).toBe('read');

        });

        it('should classify DESC as read on mssql (keyword fallback)', () => {

            expect(classifyStatements('DESC users', 'mssql')).toBe('read');

        });

        it('should classify empty input as read', () => {

            expect(classifyStatements('', 'postgres')).toBe('read');

        });

        it('should classify whitespace-only input as read', () => {

            expect(classifyStatements('   \n  ', 'postgres')).toBe('read');

        });

        it('should classify comment-only input as read', () => {

            expect(classifyStatements('-- just a comment', 'postgres')).toBe('read');

        });

        it('should classify all-SELECT multi-statement input as read', () => {

            expect(classifyStatements('SELECT 1; SELECT 2', 'postgres')).toBe('read');

        });

        it("should classify SELECT with 'INTO' inside a string literal as read (no false positive)", () => {

            expect(classifyStatements("SELECT * FROM users WHERE name = 'INTO table'", 'postgres')).toBe('read');

        });

        it('should classify a leading line comment followed by SELECT as read', () => {

            expect(classifyStatements('-- this is a comment\nSELECT 1', 'postgres')).toBe('read');

        });

        it('should classify a leading block comment followed by SELECT as read', () => {

            expect(classifyStatements('/* comment */ SELECT 1', 'postgres')).toBe('read');

        });

        it('should classify SELECT with a semicolon inside a string literal as read (no false split)', () => {

            expect(classifyStatements("SELECT 'a;b' FROM t", 'mssql')).toBe('read');

        });

    });

    describe('write', () => {

        it('should classify INSERT as write', () => {

            expect(classifyStatements("INSERT INTO users (name) VALUES ('alice')", 'postgres')).toBe('write');

        });

        it('should classify UPDATE as write', () => {

            expect(classifyStatements("UPDATE users SET name = 'bob'", 'postgres')).toBe('write');

        });

        it('should classify DELETE as write', () => {

            expect(classifyStatements('DELETE FROM users', 'postgres')).toBe('write');

        });

        it('should classify MERGE as write', () => {

            expect(classifyStatements(
                'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET t.x = s.x',
                'postgres',
            )).toBe('write');

        });

        it('should classify INSERT as write on mssql (keyword fallback)', () => {

            expect(classifyStatements("INSERT INTO users (name) VALUES ('alice')", 'mssql')).toBe('write');

        });

    });

    describe('ddl', () => {

        it('should classify DROP as ddl', () => {

            expect(classifyStatements('DROP TABLE users', 'postgres')).toBe('ddl');

        });

        it('should classify CREATE as ddl', () => {

            expect(classifyStatements('CREATE TABLE users (id INT)', 'postgres')).toBe('ddl');

        });

        it('should classify ALTER as ddl', () => {

            expect(classifyStatements('ALTER TABLE users ADD COLUMN email TEXT', 'postgres')).toBe('ddl');

        });

        it('should classify TRUNCATE as ddl', () => {

            expect(classifyStatements('TRUNCATE TABLE users', 'postgres')).toBe('ddl');

        });

        it('should classify GRANT as ddl', () => {

            expect(classifyStatements('GRANT SELECT ON t TO role1', 'postgres')).toBe('ddl');

        });

        it('should classify REVOKE as ddl', () => {

            expect(classifyStatements('REVOKE SELECT ON t FROM role1', 'postgres')).toBe('ddl');

        });

        it('should classify SET as ddl', () => {

            expect(classifyStatements('SET search_path TO foo', 'postgres')).toBe('ddl');

        });

        it('should classify CALL as ddl (postgres, parses via CST)', () => {

            expect(classifyStatements('CALL my_proc(1, 2)', 'postgres')).toBe('ddl');

        });

        it('should classify EXEC as ddl on mssql (keyword fallback)', () => {

            expect(classifyStatements('EXEC sp_who2', 'mssql')).toBe('ddl');

        });

        it('should classify EXECUTE as ddl on mssql (keyword fallback)', () => {

            expect(classifyStatements('EXECUTE sp_help', 'mssql')).toBe('ddl');

        });

        it('should classify unparseable input as ddl (fail closed)', () => {

            expect(classifyStatements('this is not sql at all !!', 'postgres')).toBe('ddl');

        });

        it('should classify DROP hidden behind comment markers in string literals as ddl', () => {

            expect(classifyStatements(
                "SELECT TOP 1 'safe /* ' FROM t; DROP TABLE users -- */'",
                'mssql',
            )).toBe('ddl');

        });

        it('should classify SELECT ... INTO new_table as ddl (postgres, CST path)', () => {

            expect(classifyStatements('SELECT * INTO new_table FROM users', 'postgres')).toBe('ddl');

        });

        it('should classify SELECT ... INTO #tmp as ddl on mssql (keyword fallback)', () => {

            expect(classifyStatements('SELECT * INTO #tmp FROM users', 'mssql')).toBe('ddl');

        });

        it('should classify SELECT ... INTO OUTFILE as ddl on mysql (CST path)', () => {

            expect(classifyStatements("SELECT * FROM users INTO OUTFILE '/tmp/x'", 'mysql')).toBe('ddl');

        });

    });

    describe('multi-statement — highest class wins', () => {

        it('should classify SELECT + DROP as ddl', () => {

            expect(classifyStatements('SELECT 1; DROP TABLE users', 'postgres')).toBe('ddl');

        });

        it('should classify SELECT + INSERT as write', () => {

            expect(classifyStatements('SELECT 1; INSERT INTO t VALUES (1)', 'postgres')).toBe('write');

        });

        it('should classify SELECT + INSERT + DROP as ddl', () => {

            expect(classifyStatements('SELECT 1; INSERT INTO t VALUES (1); DROP TABLE t', 'postgres')).toBe('ddl');

        });

    });

    describe('CTE handling', () => {

        it('should classify WITH ... SELECT as read (CST, postgres)', () => {

            expect(classifyStatements('WITH cte AS (SELECT 1) SELECT * FROM cte', 'postgres')).toBe('read');

        });

        it('should classify WITH ... INSERT as write (CST, postgres)', () => {

            expect(classifyStatements(
                'WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte',
                'postgres',
            )).toBe('write');

        });

        it('should classify WITH ... SELECT as read via keyword fallback (mssql-only syntax)', () => {

            expect(classifyStatements(
                'WITH cte AS (SELECT TOP 1 * FROM t) SELECT * FROM cte',
                'mssql',
            )).toBe('read');

        });

        it('should classify WITH ... DELETE as write via keyword fallback (mssql-only syntax)', () => {

            expect(classifyStatements(
                'WITH cte AS (SELECT TOP 1 * FROM t) DELETE FROM cte',
                'mssql',
            )).toBe('write');

        });

    });

});
