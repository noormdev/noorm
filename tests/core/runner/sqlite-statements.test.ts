/**
 * Unit tests for the SQLite statement splitter.
 *
 * The splitter exists because bun:sqlite compiles only the first statement
 * of a string and drops the rest without erroring. Its job is to find the
 * places a statement can legally end, so the cases worth pinning are the
 * places a semicolon is *not* a boundary.
 */
import { describe, it, expect } from 'bun:test';

import { splitSqliteStatements } from '../../../src/core/runner/sqlite-statements.js';

describe('runner: splitSqliteStatements', () => {

    it('should split on top-level semicolons', () => {

        const result = splitSqliteStatements('CREATE TABLE a (id INT);\nCREATE TABLE b (id INT);\n');

        expect(result).toEqual(['CREATE TABLE a (id INT);', 'CREATE TABLE b (id INT);']);

    });

    it('should keep a trailing statement with no terminator', () => {

        const result = splitSqliteStatements('SELECT 1;\nSELECT 2');

        expect(result).toEqual(['SELECT 1;', 'SELECT 2']);

    });

    it('should not split inside a string literal', () => {

        const result = splitSqliteStatements("INSERT INTO t VALUES ('a;b');");

        expect(result).toEqual(["INSERT INTO t VALUES ('a;b');"]);

    });

    it('should handle a doubled quote inside a string literal', () => {

        const result = splitSqliteStatements("INSERT INTO t VALUES ('O''Brien; Esq');\nSELECT 1;");

        expect(result).toHaveLength(2);
        expect(result[0]).toBe("INSERT INTO t VALUES ('O''Brien; Esq');");

    });

    it('should not split inside quoted identifiers', () => {

        const result = splitSqliteStatements('SELECT "a;b", `c;d`, [e;f] FROM t;');

        expect(result).toHaveLength(1);

    });

    it('should not split inside comments', () => {

        const result = splitSqliteStatements(
            '-- leading; comment\nSELECT 1;\n/* block; comment */\nSELECT 2;\n',
        );

        expect(result).toHaveLength(2);

    });

    it('should drop comment-only fragments', () => {

        expect(splitSqliteStatements('-- nothing here\n')).toEqual([]);
        expect(splitSqliteStatements('/* nothing\n   here */\n')).toEqual([]);
        expect(splitSqliteStatements('')).toEqual([]);

    });

    it('should keep a trigger body whole', () => {

        const sql = 'CREATE TRIGGER t AFTER INSERT ON src\n' +
            'BEGIN\n' +
            '    INSERT INTO log (n) VALUES (NEW.n);\n' +
            '    DELETE FROM log WHERE n < 0;\n' +
            'END;\n' +
            'SELECT 1;';

        const result = splitSqliteStatements(sql);

        expect(result).toHaveLength(2);
        expect(result[0]).toContain('END;');
        expect(result[1]).toBe('SELECT 1;');

    });

    it('should not let a CASE inside a trigger close the trigger body', () => {

        // `END;` here belongs to the CASE, not the trigger. Pairing
        // BEGIN/CASE against END is what tells them apart — a rule that
        // only looks for `END;` splits this file in the wrong place.
        const sql = 'CREATE TRIGGER t AFTER INSERT ON src\n' +
            'BEGIN\n' +
            '    UPDATE log SET n = CASE WHEN NEW.n > 0 THEN 1 ELSE 2 END;\n' +
            '    DELETE FROM log WHERE n < 0;\n' +
            'END;\n' +
            'SELECT 1;';

        const result = splitSqliteStatements(sql);

        expect(result).toHaveLength(2);
        expect(result[0]).toContain('DELETE FROM log');
        expect(result[1]).toBe('SELECT 1;');

    });

    it('should treat a standalone BEGIN as transaction control', () => {

        const result = splitSqliteStatements(
            'BEGIN;\nCREATE TABLE a (id INT);\nCOMMIT;\nCREATE TABLE b (id INT);\n',
        );

        expect(result).toEqual([
            'BEGIN;',
            'CREATE TABLE a (id INT);',
            'COMMIT;',
            'CREATE TABLE b (id INT);',
        ]);

    });

    it('should not treat identifiers containing keywords as keywords', () => {

        const result = splitSqliteStatements(
            'CREATE TABLE beginning (trigger_at INT, ended INT);\nSELECT 1;',
        );

        expect(result).toHaveLength(2);

    });

    it('should split a DROP TRIGGER normally', () => {

        const result = splitSqliteStatements('DROP TRIGGER t;\nSELECT 1;');

        expect(result).toEqual(['DROP TRIGGER t;', 'SELECT 1;']);

    });

});
