/**
 * Unit tests for SQL statement splitter.
 *
 * Ensures the splitter correctly handles dollar-quoted strings and other SQL constructs.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { splitSqlStatements } from './db.js';


describe('utils: splitSqlStatements', () => {

    it('should split simple statements on semicolon + newline', () => {

        const sql = `CREATE TABLE foo (id INT);
CREATE TABLE bar (id INT);`;

        const statements = splitSqlStatements(sql);

        expect(statements).toHaveLength(2);
        expect(statements[0]).toBe('CREATE TABLE foo (id INT);');
        expect(statements[1]).toBe('CREATE TABLE bar (id INT);');

    });

    it('should handle statements without trailing newline', () => {

        const sql = 'CREATE TABLE foo (id INT);';

        const statements = splitSqlStatements(sql);

        expect(statements).toHaveLength(1);
        expect(statements[0]).toBe('CREATE TABLE foo (id INT);');

    });

    it('should preserve semicolons inside dollar-quoted strings', () => {

        const sql = `CREATE FUNCTION test() RETURNS void AS $$
BEGIN
    INSERT INTO foo VALUES (1);
    INSERT INTO foo VALUES (2);
END;
$$ LANGUAGE plpgsql;
SELECT 1;`;

        const statements = splitSqlStatements(sql);

        expect(statements).toHaveLength(2);
        expect(statements[0]).toContain('INSERT INTO foo VALUES (1);');
        expect(statements[0]).toContain('INSERT INTO foo VALUES (2);');
        expect(statements[1]).toBe('SELECT 1;');

    });

    it('should handle named dollar-quote tags', () => {

        const sql = `CREATE FUNCTION test() RETURNS void AS $body$
BEGIN
    RETURN;
END;
$body$ LANGUAGE plpgsql;`;

        const statements = splitSqlStatements(sql);

        expect(statements).toHaveLength(1);
        expect(statements[0]).toContain('$body$');

    });

    it('should correctly parse postgres tables fixture', async () => {

        const fixturesDir = join(import.meta.dirname, '..', 'fixtures', 'sql', 'postgres');
        const content = await readFile(join(fixturesDir, '001_tables.sql'), 'utf-8');

        // Remove comment lines as done in executeSqlFile
        const cleanedContent = content
            .split('\n')
            .filter((line) => !line.trim().startsWith('--'))
            .join('\n');

        const statements = splitSqlStatements(cleanedContent);

        // Should have: 3 tables + 6 indexes = 9 statements
        expect(statements.length).toBeGreaterThanOrEqual(9);

        // First statement should be CREATE TABLE users
        expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS users');
        expect(statements[0]).toContain('id UUID PRIMARY KEY');

    });

    it('should correctly parse postgres functions fixture', async () => {

        const fixturesDir = join(import.meta.dirname, '..', 'fixtures', 'sql', 'postgres');
        const content = await readFile(join(fixturesDir, '003_functions.sql'), 'utf-8');

        // Remove comment lines
        const cleanedContent = content
            .split('\n')
            .filter((line) => !line.trim().startsWith('--'))
            .join('\n');

        const statements = splitSqlStatements(cleanedContent);

        // Should have 16 functions
        expect(statements.length).toBeGreaterThanOrEqual(16);

        // Each function should be a complete statement
        for (const stmt of statements) {

            expect(stmt).toContain('CREATE OR REPLACE FUNCTION');
            expect(stmt).toContain('$$ LANGUAGE plpgsql;');
            // Should NOT be split in the middle
            expect(stmt.match(/\$\$/g)?.length).toBe(2); // Exactly 2 $$ markers

        }

    });

    it('should not produce any invalid SQL statements in tables fixture', async () => {

        const fixturesDir = join(import.meta.dirname, '..', 'fixtures', 'sql', 'postgres');
        const content = await readFile(join(fixturesDir, '001_tables.sql'), 'utf-8');

        // Remove comment lines
        const cleanedContent = content
            .split('\n')
            .filter((line) => !line.trim().startsWith('--'))
            .join('\n');

        const statements = splitSqlStatements(cleanedContent);

        // Check each statement starts with valid SQL keywords
        for (const stmt of statements) {

            const firstWord = stmt.split(/\s+/)[0]?.toUpperCase();

            expect(
                ['CREATE', 'ALTER', 'DROP', 'INSERT', 'UPDATE', 'DELETE', 'SELECT', 'TRUNCATE', 'WITH'],
            ).toContain(firstWord);

        }

    });

    it('should preserve semicolons inside BEGIN...END blocks', () => {

        const sql = `CREATE PROCEDURE test()
BEGIN
    INSERT INTO foo VALUES (1);
    INSERT INTO foo VALUES (2);
END;
SELECT 1;`;

        const statements = splitSqlStatements(sql);

        expect(statements).toHaveLength(2);
        expect(statements[0]).toContain('INSERT INTO foo VALUES (1);');
        expect(statements[0]).toContain('INSERT INTO foo VALUES (2);');
        expect(statements[0]).toContain('BEGIN');
        expect(statements[0]).toContain('END;');
        expect(statements[1]).toBe('SELECT 1;');

    });

    it('should handle nested BEGIN...END blocks', () => {

        const sql = `CREATE PROCEDURE test()
BEGIN
    IF condition THEN
    BEGIN
        INSERT INTO foo VALUES (1);
    END;
    END IF;
END;
SELECT 1;`;

        const statements = splitSqlStatements(sql);

        expect(statements).toHaveLength(2);
        expect(statements[0]).toContain('INSERT INTO foo VALUES (1);');
        expect(statements[1]).toBe('SELECT 1;');

    });

    it('should handle case-insensitive BEGIN/END keywords', () => {

        const sql = `CREATE PROCEDURE test()
begin
    INSERT INTO foo VALUES (1);
end;
SELECT 1;`;

        const statements = splitSqlStatements(sql);

        expect(statements).toHaveLength(2);
        expect(statements[0]).toContain('INSERT INTO foo VALUES (1);');
        expect(statements[1]).toBe('SELECT 1;');

    });

    it('should not match BEGIN inside identifiers', () => {

        const sql = `SELECT beginning FROM table1;
SELECT 1;`;

        const statements = splitSqlStatements(sql);

        expect(statements).toHaveLength(2);
        expect(statements[0]).toBe('SELECT beginning FROM table1;');
        expect(statements[1]).toBe('SELECT 1;');

    });

    it('should not match END inside identifiers', () => {

        const sql = `SELECT weekend FROM table1;
SELECT 1;`;

        const statements = splitSqlStatements(sql);

        expect(statements).toHaveLength(2);
        expect(statements[0]).toBe('SELECT weekend FROM table1;');
        expect(statements[1]).toBe('SELECT 1;');

    });

    it('should handle BEGIN inside string literals without incrementing depth', () => {

        const sql = `INSERT INTO foo VALUES ('BEGIN test END');
SELECT 1;`;

        const statements = splitSqlStatements(sql);

        expect(statements).toHaveLength(2);
        expect(statements[0]).toBe("INSERT INTO foo VALUES ('BEGIN test END');");
        expect(statements[1]).toBe('SELECT 1;');

    });

    it('should correctly parse mysql procedures after DELIMITER preprocessing', async () => {

        const fixturesDir = join(import.meta.dirname, '..', 'fixtures', 'sql', 'mysql');
        const content = await readFile(join(fixturesDir, '003_procedures.sql'), 'utf-8');

        // Simulate preprocessMySqlDelimiter
        const delimiterMatch = content.match(/DELIMITER\s+(\S+)/);
        const customDelimiter = delimiterMatch![1]!;

        let processed = content.replace(/DELIMITER\s+\S+[\r\n]*/g, '');
        processed = processed.replace(new RegExp(customDelimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ';');

        // Remove comment lines
        const cleanedContent = processed
            .split('\n')
            .filter((line) => !line.trim().startsWith('--'))
            .join('\n');

        const statements = splitSqlStatements(cleanedContent);

        // Should have 16 procedures
        expect(statements.length).toBe(16);

        // Each procedure should be complete
        for (const stmt of statements) {

            expect(stmt).toContain('CREATE PROCEDURE');
            expect(stmt).toContain('BEGIN');
            expect(stmt).toContain('END;');
            // Should not contain empty lines only
            expect(stmt.trim().length).toBeGreaterThan(10);

        }

    });

});
