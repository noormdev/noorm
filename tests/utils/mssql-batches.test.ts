/**
 * Unit tests for the MSSQL GO batch splitter.
 *
 * Covers the edge cases enumerated in the slice 3 spec: leading/trailing GO,
 * lowercase, whitespace, `GO;`, identifiers that begin with `GO`, comment-only
 * files. Each case is a regression guard — the runner now feeds batches one at
 * a time to the driver so accidental over-splitting will execute incomplete
 * statements.
 */
import { describe, it, expect } from 'bun:test';

import { splitMssqlBatches } from '../../src/core/runner/mssql-batches.js';


describe('runner: splitMssqlBatches', () => {

    it('should split a two-batch file on GO', () => {

        const sql = [
            'CREATE TABLE A (id INT);',
            'GO',
            'CREATE TABLE B (id INT);',
        ].join('\n');

        const batches = splitMssqlBatches(sql);

        expect(batches).toHaveLength(2);
        expect(batches[0]).toBe('CREATE TABLE A (id INT);');
        expect(batches[1]).toBe('CREATE TABLE B (id INT);');

    });

    it('should return a single batch when there is no GO', () => {

        const sql = 'SELECT 1;\nSELECT 2;\n';

        const batches = splitMssqlBatches(sql);

        expect(batches).toHaveLength(1);
        expect(batches[0]).toBe('SELECT 1;\nSELECT 2;');

    });

    it('should return an empty array for an empty file', () => {

        expect(splitMssqlBatches('')).toEqual([]);
        expect(splitMssqlBatches('   \n  \n')).toEqual([]);

    });

    it('should return an empty array for a comment-only file', () => {

        const sql = '-- only comments\n-- nothing else\n';

        expect(splitMssqlBatches(sql)).toEqual([]);

    });

    it('should drop a trailing GO with no batch after it', () => {

        const sql = 'CREATE TABLE A (id INT);\nGO\n';

        const batches = splitMssqlBatches(sql);

        expect(batches).toHaveLength(1);
        expect(batches[0]).toBe('CREATE TABLE A (id INT);');

    });

    it('should drop a leading GO with no batch before it', () => {

        const sql = 'GO\nCREATE TABLE A (id INT);';

        const batches = splitMssqlBatches(sql);

        expect(batches).toHaveLength(1);
        expect(batches[0]).toBe('CREATE TABLE A (id INT);');

    });

    it('should treat lowercase `go` as a separator (case-insensitive)', () => {

        const sql = 'CREATE TABLE A (id INT);\ngo\nCREATE TABLE B (id INT);';

        const batches = splitMssqlBatches(sql);

        expect(batches).toHaveLength(2);
        expect(batches[0]).toBe('CREATE TABLE A (id INT);');
        expect(batches[1]).toBe('CREATE TABLE B (id INT);');

    });

    it('should treat mixed-case `Go` as a separator', () => {

        const sql = 'CREATE TABLE A (id INT);\nGo\nCREATE TABLE B (id INT);';

        const batches = splitMssqlBatches(sql);

        expect(batches).toHaveLength(2);

    });

    it('should accept surrounding whitespace around GO', () => {

        const sql = 'CREATE TABLE A (id INT);\n  GO  \nCREATE TABLE B (id INT);';

        const batches = splitMssqlBatches(sql);

        expect(batches).toHaveLength(2);
        expect(batches[0]).toBe('CREATE TABLE A (id INT);');
        expect(batches[1]).toBe('CREATE TABLE B (id INT);');

    });

    it('should accept tabs around GO', () => {

        const sql = 'CREATE TABLE A (id INT);\n\tGO\t\nCREATE TABLE B (id INT);';

        const batches = splitMssqlBatches(sql);

        expect(batches).toHaveLength(2);

    });

    it('should NOT split on `GO;` (GO followed by semicolon)', () => {

        const sql = 'SELECT 1;\nGO;\nSELECT 2;';

        const batches = splitMssqlBatches(sql);

        expect(batches).toHaveLength(1);
        expect(batches[0]).toBe(sql);

    });

    it('should NOT split on identifiers that start with GO', () => {

        const sql = [
            'SELECT 1;',
            'GOLANG',
            'GONNA',
            'GODZILLA',
            'SELECT 2;',
        ].join('\n');

        const batches = splitMssqlBatches(sql);

        // No GO on its own line — entire content is a single batch
        expect(batches).toHaveLength(1);
        expect(batches[0]).toContain('GOLANG');
        expect(batches[0]).toContain('GONNA');

    });

    it('should NOT split when GO appears mid-line', () => {

        const sql = 'SELECT 1; GO SELECT 2;';

        const batches = splitMssqlBatches(sql);

        expect(batches).toHaveLength(1);
        expect(batches[0]).toBe(sql);

    });

    it('should handle multiple consecutive GO separators (drops the empty batch between them)', () => {

        const sql = 'SELECT 1;\nGO\nGO\nSELECT 2;';

        const batches = splitMssqlBatches(sql);

        expect(batches).toHaveLength(2);
        expect(batches[0]).toBe('SELECT 1;');
        expect(batches[1]).toBe('SELECT 2;');

    });

    it('should preserve batches that contain comments alongside code', () => {

        const sql = [
            '-- create the first table',
            'CREATE TABLE A (id INT);',
            'GO',
            '-- create the second table',
            'CREATE TABLE B (id INT);',
        ].join('\n');

        const batches = splitMssqlBatches(sql);

        expect(batches).toHaveLength(2);
        expect(batches[0]).toContain('CREATE TABLE A');
        expect(batches[0]).toContain('-- create the first table');
        expect(batches[1]).toContain('CREATE TABLE B');

    });

    it('should drop batches that are entirely comments', () => {

        const sql = [
            '-- header only batch',
            '-- more comments',
            'GO',
            'CREATE TABLE A (id INT);',
        ].join('\n');

        const batches = splitMssqlBatches(sql);

        expect(batches).toHaveLength(1);
        expect(batches[0]).toBe('CREATE TABLE A (id INT);');

    });

    it('should handle three-batch files in source order', () => {

        const sql = [
            'CREATE TABLE A (id INT);',
            'GO',
            'CREATE TABLE B (id INT);',
            'GO',
            'CREATE TABLE C (id INT);',
        ].join('\n');

        const batches = splitMssqlBatches(sql);

        expect(batches).toHaveLength(3);
        expect(batches[0]).toContain('TABLE A');
        expect(batches[1]).toContain('TABLE B');
        expect(batches[2]).toContain('TABLE C');

    });

    it('should preserve CRLF line endings inside batches', () => {

        const sql = 'CREATE TABLE A (\r\n  id INT\r\n);\r\nGO\r\nCREATE TABLE B (id INT);';

        const batches = splitMssqlBatches(sql);

        expect(batches).toHaveLength(2);
        // Inner CRLF preserved in the first batch
        expect(batches[0]).toContain('\r\n');

    });

    it('should handle a realistic two-procedure file', () => {

        const sql = [
            'CREATE PROCEDURE dbo.sp_first',
            'AS',
            'BEGIN',
            '    SELECT 1 AS one;',
            'END',
            'GO',
            'CREATE PROCEDURE dbo.sp_second',
            'AS',
            'BEGIN',
            '    SELECT 2 AS two;',
            'END',
            'GO',
        ].join('\n');

        const batches = splitMssqlBatches(sql);

        expect(batches).toHaveLength(2);
        expect(batches[0]).toContain('sp_first');
        expect(batches[0]).toContain('END');
        expect(batches[1]).toContain('sp_second');

    });

});
