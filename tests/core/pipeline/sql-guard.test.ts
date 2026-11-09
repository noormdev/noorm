import { describe, expect, it } from 'bun:test';
import { assertManagedPipelineSql, hasAuthorTransactionControl } from '../../../src/core/pipeline/sql-guard.js';
import type { Dialect } from '../../../src/core/connection/types.js';
import type { PipelineTransaction } from '../../../src/core/pipeline/types.js';

const transactions: PipelineTransaction[] = ['pipeline', 'step'];

function expectRejected(body: string, dialect: Dialect): void {

    for (const transaction of transactions) {

        expect(() => assertManagedPipelineSql(body, dialect, transaction)).toThrow();

    }
    expect(hasAuthorTransactionControl(body, dialect)).toBe(true);

}

describe('pipeline: sql guard', () => {

    const forbidden: Array<[Dialect, string]> = [
        ['postgres', 'begin'], ['postgres', 'start transaction'], ['postgres', 'commit'],
        ['postgres', 'rollback'], ['postgres', 'savepoint sp'], ['postgres', 'release savepoint sp'],
        ['postgres', 'end'], ['postgres', 'abort'], ['postgres', "prepare transaction 'tx'"],
        ['sqlite', 'begin'], ['sqlite', 'commit'], ['sqlite', 'rollback'],
        ['sqlite', 'savepoint sp'], ['sqlite', 'release sp'], ['sqlite', 'end'],
        ['mysql', 'start transaction'], ['mysql', 'commit'], ['mysql', 'rollback'],
        ['mysql', 'savepoint sp'], ['mysql', 'release savepoint sp'],
        ['mysql', 'create table x (id int)'], ['mysql', 'alter table x add y int'],
        ['mysql', 'drop table x'], ['mysql', 'truncate table x'], ['mysql', 'rename table x to y'],
        ['mysql', 'lock tables x write'], ['mysql', 'unlock tables'], ['mysql', 'set autocommit = 1'],
        ['mysql', "xa start 'x'"],
        ['mssql', 'begin transaction'], ['mssql', 'begin tran'], ['mssql', 'commit'],
        ['mssql', 'rollback'], ['mssql', 'save transaction sp'], ['mssql', 'save tran sp'],
    ];

    for (const [dialect, control] of forbidden) {

        it(`should reject ${dialect} control at a later statement boundary: ${control}`, () => {

            for (const transaction of transactions) {

                expect(() => assertManagedPipelineSql(`select 1; /* comment */\n${control}`, dialect, transaction)).toThrow();

            }
            expect(() => assertManagedPipelineSql(`select 1; ${control}`, dialect, 'none')).not.toThrow();

        });

    }

    it('should recognize controls after MSSQL batch separators and line comments', () => {

        expect(() => assertManagedPipelineSql('select 1\nGO\n-- comment\nBEGIN TRAN', 'mssql', 'step')).toThrow();
        expect(() => assertManagedPipelineSql('select 1; -- comment\nROLLBACK', 'sqlite', 'pipeline')).toThrow();

    });

    it('should not treat quoted controls or comments as statements', () => {

        for (const dialect of ['postgres', 'mysql', 'sqlite', 'mssql'] as const) {

            const body = "select 'commit; rollback', \"begin\"; -- rollback\n/* commit; */ select 1";
            expect(() => assertManagedPipelineSql(body, dialect, 'pipeline')).not.toThrow();

        }

    });

    it('should allow MSSQL blocks and SQLite trigger bodies without interpreting their END as a transaction', () => {

        expect(() => assertManagedPipelineSql(
            'BEGIN TRY\n BEGIN\n SELECT 1;\n END\nEND TRY\nBEGIN CATCH\n SELECT 2;\nEND CATCH', 'mssql', 'pipeline',
        )).not.toThrow();
        expect(() => assertManagedPipelineSql(
            'CREATE TRIGGER trig AFTER INSERT ON x BEGIN INSERT INTO y VALUES (1); INSERT INTO y VALUES (2); END;',
            'sqlite', 'step',
        )).not.toThrow();
        expect(() => assertManagedPipelineSql(
            'CREATE TRIGGER trig AFTER INSERT ON x BEGIN INSERT INTO y VALUES (1); END; ROLLBACK;',
            'sqlite', 'step',
        )).toThrow();

    });

    it('should not turn the bounded recognizer into an arbitrary SQL syntax validator', () => {

        expect(() => assertManagedPipelineSql('select from this is not valid SQL', 'sqlite', 'step')).not.toThrow();

    });

    it('should reject MSSQL transaction control at any token boundary without semicolons', () => {

        const bodies = [
            'UPDATE t SET x = 1\nCOMMIT',
            'BEGIN TRY BEGIN TRAN UPDATE t SET x = 1 COMMIT END TRY BEGIN CATCH ROLLBACK END CATCH',
            'IF @x = 1 COMMIT',
            'SELECT 1\nSET IMPLICIT_TRANSACTIONS ON',
            'SELECT 1\nSAVE TRAN sp',
        ];
        for (const body of bodies) {

            expect(() => assertManagedPipelineSql(body, 'mssql', 'step')).toThrow();

        }

    });

    it('should not flag MSSQL identifiers or variables that contain control keywords', () => {

        const body = 'DECLARE @commit INT = 1; SELECT t.commit, [rollback], committed_at FROM t';
        expect(() => assertManagedPipelineSql(body, 'mssql', 'step')).not.toThrow();

    });

    it('should treat a trailing backslash as a plain character in standard strings', () => {

        const dialects: Dialect[] = ['postgres', 'sqlite', 'mssql'];
        for (const dialect of dialects) {

            expect(() => assertManagedPipelineSql("SELECT 'C:\\'; COMMIT; SELECT '1';", dialect, 'step')).toThrow();

        }

    });

    it('should keep backslash escapes in PostgreSQL E strings', () => {

        expect(() => assertManagedPipelineSql("SELECT E'it\\'s; commit'", 'postgres', 'step')).not.toThrow();

    });

    it('should reject a MySQL COMMIT that any backslash or ANSI_QUOTES reading exposes, without knowing the session mode', () => {

        expectRejected('SELECT "a\\"; COMMIT; -- "', 'mysql');
        expectRejected("SELECT 'a\\'; COMMIT; -- '", 'mysql');

    });

    it('should pass MySQL strings that hide the keyword under every reading', () => {

        expect(() => assertManagedPipelineSql("SELECT 'it''s; commit'", 'mysql', 'step')).not.toThrow();

    });

    it('should treat a trailing backslash as a plain character in MySQL backtick identifiers', () => {

        expect(() => assertManagedPipelineSql('SELECT `C:\\` FROM t; COMMIT; SELECT `x`;', 'mysql', 'step')).toThrow();

    });


    it('should reject PostgreSQL BEGIN ATOMIC bodies because their END is not distinguishable from a transaction end', () => {

        const fn = 'CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END;';
        expectRejected(fn, 'postgres');

    });

    const bypasses: Array<[string, Dialect, string]> = [
        ['a BEGIN ATOMIC parameter name', 'postgres',
            'CREATE FUNCTION f(begin atomic) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$; COMMIT; END;'],
        ['a numeric literal ending in a dot inside BEGIN ATOMIC', 'postgres',
            'CREATE FUNCTION f() RETURNS numeric LANGUAGE sql BEGIN ATOMIC SELECT CASE WHEN true THEN 1. END; END; COMMIT; END;'],
        ['a PostgreSQL identifier containing dollars', 'postgres', 'SELECT 1 AS t$a$, 2; COMMIT; SELECT 3 AS t$a$'],
        ['an MSSQL identifier containing dollars', 'mssql', 'SELECT 1 AS t$a$, 2; COMMIT; SELECT 3 AS t$a$'],
        ['MSSQL BEGIN DISTRIBUTED TRAN', 'mssql', 'BEGIN DISTRIBUTED TRAN'],
        ['MSSQL BEGIN DISTRIBUTED TRANSACTION', 'mssql', 'BEGIN DISTRIBUTED TRANSACTION'],
        ['a MySQL hash comment', 'mysql', '# note\nCOMMIT'],
        ['a MySQL executable comment', 'mysql', '/*!COMMIT*/'],
        ['a MySQL versioned executable comment', 'mysql', '/*!50000 COMMIT */'],
        ['a MySQL comment that does not nest', 'mysql', '/* /* */ COMMIT /* */'],
        ['a SQLite comment that does not nest', 'sqlite', '/* /* */ COMMIT;'],
        ['an MSSQL bracket identifier with an escaped bracket', 'mssql', "SELECT 1 AS [a]]']; COMMIT; --'"],
        ['a PostgreSQL array subscript', 'postgres', "SELECT (ARRAY['a'])[(SELECT 1 WHERE ']' <> '')]; COMMIT; SELECT 'x'"],
    ];

    for (const [name, dialect, body] of bypasses) {

        it(`should reject control hidden behind ${name}`, () => {

            expectRejected(body, dialect);

        });

    }

    it('should still mask PostgreSQL dollar-quoted bodies', () => {

        expect(() => assertManagedPipelineSql('SELECT $a$ COMMIT $a$, $$ COMMIT; $$', 'postgres', 'step')).not.toThrow();

    });

    it('should mask PostgreSQL dollar tags of any length, so an unmasked opener cannot hide a later control', () => {

        const tag = `$${'a'.repeat(70)}$`;
        expectRejected(`SELECT ${tag} ' ${tag}; COMMIT; SELECT '--'`, 'postgres');
        expect(() => assertManagedPipelineSql(`SELECT ${tag} COMMIT; ${tag}`, 'postgres', 'step')).not.toThrow();

    });

    it('should reject a control hidden behind an unmasked non-ASCII dollar tag', () => {

        expectRejected("SELECT $é$ ' $é$; COMMIT; SELECT '--'", 'postgres');

    });

    it('should still mask MSSQL escaped bracket identifiers', () => {

        expect(() => assertManagedPipelineSql('SELECT [col]]name] FROM t; SELECT [commit]]x]', 'mssql', 'step')).not.toThrow();

    });

    it('should still pass a MySQL optimizer hint comment', () => {

        expect(() => assertManagedPipelineSql('/*+ hint */ SELECT 1', 'mysql', 'step')).not.toThrow();

    });

    it('should treat MySQL -- as a comment only when whitespace or a control character follows', () => {

        expectRejected('SELECT 1--1;\nCOMMIT', 'mysql');
        expect(() => assertManagedPipelineSql('SELECT 1 -- COMMIT\n', 'mysql', 'step')).not.toThrow();
        expect(() => assertManagedPipelineSql('SELECT 1 --\tCOMMIT', 'mysql', 'step')).not.toThrow();

    });

});
