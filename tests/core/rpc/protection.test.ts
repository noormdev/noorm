import { describe, it, expect } from 'bun:test';
import { isReadOnlyStatement } from '../../../src/rpc/protection.js';

describe('rpc: protection', () => {

    describe('isReadOnlyStatement', () => {

        // === Allowed statements ===

        it('should allow SELECT', () => {

            expect(isReadOnlyStatement('SELECT * FROM users', 'postgres')).toBe(true);

        });

        it('should allow select (lowercase)', () => {

            expect(isReadOnlyStatement('select 1', 'postgres')).toBe(true);

        });

        it('should allow EXPLAIN', () => {

            expect(isReadOnlyStatement('EXPLAIN SELECT * FROM users', 'postgres')).toBe(true);

        });

        it('should allow SHOW', () => {

            expect(isReadOnlyStatement('SHOW TABLES', 'mysql')).toBe(true);

        });

        it('should allow DESCRIBE', () => {

            expect(isReadOnlyStatement('DESCRIBE users', 'mysql')).toBe(true);

        });

        it('should allow DESC', () => {

            expect(isReadOnlyStatement('DESC users', 'mysql')).toBe(true);

        });

        it('should allow WITH ... SELECT (CTE)', () => {

            expect(isReadOnlyStatement('WITH cte AS (SELECT 1) SELECT * FROM cte', 'postgres')).toBe(true);

        });

        // === Blocked statements ===

        it('should block INSERT', () => {

            expect(isReadOnlyStatement('INSERT INTO users (name) VALUES (\'alice\')', 'postgres')).toBe(false);

        });

        it('should block UPDATE', () => {

            expect(isReadOnlyStatement('UPDATE users SET name = \'bob\'', 'postgres')).toBe(false);

        });

        it('should block DELETE', () => {

            expect(isReadOnlyStatement('DELETE FROM users', 'postgres')).toBe(false);

        });

        it('should block DROP', () => {

            expect(isReadOnlyStatement('DROP TABLE users', 'postgres')).toBe(false);

        });

        it('should block CREATE', () => {

            expect(isReadOnlyStatement('CREATE TABLE users (id INT)', 'postgres')).toBe(false);

        });

        it('should block ALTER', () => {

            expect(isReadOnlyStatement('ALTER TABLE users ADD COLUMN email TEXT', 'postgres')).toBe(false);

        });

        it('should block TRUNCATE', () => {

            expect(isReadOnlyStatement('TRUNCATE TABLE users', 'postgres')).toBe(false);

        });

        // === Edge cases ===

        it('should handle SQL with leading comments', () => {

            expect(isReadOnlyStatement('-- this is a comment\nSELECT 1', 'postgres')).toBe(true);

        });

        it('should handle SQL with block comments', () => {

            expect(isReadOnlyStatement('/* comment */ SELECT 1', 'postgres')).toBe(true);

        });

        it('should handle comment hiding a dangerous statement', () => {

            expect(isReadOnlyStatement('-- SELECT 1\nDROP TABLE users', 'postgres')).toBe(false);

        });

        it('should block multi-statement with mixed intent', () => {

            expect(isReadOnlyStatement('SELECT 1; DROP TABLE users', 'postgres')).toBe(false);

        });

        it('should allow multi-statement all SELECT', () => {

            expect(isReadOnlyStatement('SELECT 1; SELECT 2', 'postgres')).toBe(true);

        });

        it('should block WITH ... INSERT', () => {

            expect(isReadOnlyStatement('WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte', 'postgres')).toBe(false);

        });

        it('should handle empty string', () => {

            expect(isReadOnlyStatement('', 'postgres')).toBe(true);

        });

        it('should handle whitespace only', () => {

            expect(isReadOnlyStatement('   \n  ', 'postgres')).toBe(true);

        });

        // === String literal edge cases ===

        it('should block DROP hidden by comment markers in string literals', () => {

            expect(isReadOnlyStatement(
                "SELECT TOP 1 'safe /* ' FROM t; DROP TABLE users -- */'",
                'mssql',
            )).toBe(false);

        });

        it('should allow SELECT with semicolon inside string literal', () => {

            expect(isReadOnlyStatement(
                "SELECT 'a;b' FROM t",
                'mssql',
            )).toBe(true);

        });

        // === MSSQL fallback ===

        it('should block EXEC on mssql (keyword fallback)', () => {

            expect(isReadOnlyStatement('EXEC sp_who2', 'mssql')).toBe(false);

        });

        it('should block EXECUTE on mssql', () => {

            expect(isReadOnlyStatement('EXECUTE sp_help', 'mssql')).toBe(false);

        });

        it('should allow SELECT on mssql', () => {

            expect(isReadOnlyStatement('SELECT TOP 10 * FROM users', 'mssql')).toBe(true);

        });

    });

});
