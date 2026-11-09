/**
 * Access policy: classifyStatements.
 *
 * Tests whose name claims a classification path call `classifyVia`, which
 * asserts the claim. They used to just call `classifyStatements` and trust
 * the name — so a CST/fallback divergence, which is the shape of every
 * classifier bypass the v1 audit found, could not fail any of them. The
 * adversarial input set lives in `classify-corpus.test.ts`.
 */
import { describe, it, expect } from 'bun:test';
import { attemptSync } from '@logosdx/utils';
import { parse } from 'sql-parser-cst';

import { attachPolicyContext, classifyStatements, getConfigPermission, sqlPermissionsFor } from '../../../src/core/policy/index.js';
import type { SqlClass } from '../../../src/core/policy/index.js';
import type { Dialect } from '../../../src/core/connection/types.js';

/** sql-parser-cst grammar per noorm dialect — mirrors `DIALECT_MAP` in classify.ts. */
const CST_DIALECT: Record<Dialect, 'sqlite' | 'postgresql' | 'mysql'> = {
    sqlite: 'sqlite',
    postgres: 'postgresql',
    mysql: 'mysql',
    mssql: 'postgresql',
};

/**
 * Classifies `sql`, first asserting it takes the `expectedPath`.
 *
 * @param expectedPath - `cst` when the parser accepts the input, `fallback`
 * when it throws and keyword analysis takes over.
 */
function classifyVia(expectedPath: 'cst' | 'fallback', sql: string, dialect: Dialect): SqlClass {

    const [, err] = attemptSync(() => parse(sql.trim(), {
        dialect: CST_DIALECT[dialect],
        includeComments: false,
        includeSpaces: false,
        includeNewlines: false,
    }));

    expect(err ? 'fallback' : 'cst').toBe(expectedPath);

    return classifyStatements(sql, dialect);

}

describe('policy: classifyStatements', () => {

    it('collects every represented permission without imposing read on DDL alone', () => {

        expect(sqlPermissionsFor('CREATE TABLE marker (id int)', 'sqlite')).toEqual(['sql:ddl']);
        expect(sqlPermissionsFor('DELETE FROM records; CREATE TABLE marker (id int)', 'sqlite'))
            .toEqual(['sql:write', 'sql:ddl']);
        expect(sqlPermissionsFor('WITH gone AS (DELETE FROM records RETURNING *) SELECT * FROM gone', 'postgres'))
            .toEqual(['sql:read', 'sql:write']);
        expect(sqlPermissionsFor('SELECT pg_terminate_backend(1); CREATE TABLE marker (id int)', 'postgres'))
            .toEqual(['sql:read', 'sql:write', 'sql:ddl']);
        expect(sqlPermissionsFor('DELETE FROM [records]; CREATE TABLE [marker] ([id] int)', 'mssql'))
            .toEqual(['sql:write', 'sql:ddl']);
        expect(sqlPermissionsFor('EXPLAIN (ANALYZE) WITH gone AS (DELETE FROM records RETURNING *) SELECT * FROM gone; CREATE TABLE marker (id int)', 'postgres'))
            .toEqual(['sql:read', 'sql:write', 'sql:ddl']);
        expect(sqlPermissionsFor('CREATE TABLE [marker] AS SELECT pg_terminate_backend(1)', 'mssql'))
            .toEqual(['sql:read', 'sql:write', 'sql:ddl']);
        expect(sqlPermissionsFor('EXEC mystery', 'mssql')).toEqual(['sql:ddl']);

    });
    it('retains permissions across semicolonless MSSQL batches', () => {

        const batches = [
            ['SELECT 1\nDELETE FROM t', ['sql:read', 'sql:write']],
            ['SELECT 1\nEXEC xp_cmdshell \'whoami\'', ['sql:read', 'sql:ddl']],
            ['SELECT 1\nDELETE FROM t\nCREATE TABLE x (id int)', ['sql:read', 'sql:write', 'sql:ddl']],
            ['UPDATE t SET id = 1\nDROP TABLE x', ['sql:write', 'sql:ddl']],
            ['SELECT 1\nDENY SELECT ON OBJECT::dbo.records TO app_reader', ['sql:read', 'sql:ddl']],
        ] as const;
        for (const [sql, permissions] of batches) {

            expect(sqlPermissionsFor(sql, 'mssql')).toEqual([...permissions]);

        }
        for (const verb of ['EXEC', 'EXECUTE', 'KILL', 'DBCC', 'BACKUP', 'RESTORE', 'SHUTDOWN']) {

            expect(sqlPermissionsFor(`SELECT 1\n${verb} something`, 'mssql')).toContain('sql:ddl');
            expect(classifyStatements(`SELECT 1\n${verb} something`, 'mssql')).toBe('ddl');

        }

    });

    it('retains privileged T-SQL statement forms in semicolonless batches', () => {

        for (const statement of [
            'ENABLE TRIGGER ALL ON dbo.records',
            'DISABLE TRIGGER ALL ON dbo.records',
            'SET NOCOUNT ON',
            "SETUSER 'dbo'\nSELECT USER_NAME()",
            'SET FMTONLY ON',
            'SET ANSI_NULLS, QUOTED_IDENTIFIER ON',
            'SET ANSI_NULL_DFLT_OFF ON',
            'SET SHOWPLAN_XML ON',
            'SET REMOTE_PROC_TRANSACTIONS OFF',
            'OPEN cursor_name\nSELECT 2',
            'WAITFOR DELAY \'00:00:01\'',
            'RECONFIGURE',
            'COMMIT\nSELECT 2',
            'ROLLBACK\nSELECT 2',
            'MOVE CONVERSATION @handle TO @group',
            'FETCH NEXT FROM cursor_name INTO @value',
            'FETCH @cursor INTO @value',
            'USE other_db',
            'USE [other_db]',
            'CHECKPOINT',
            'REVERT',
            'SET @value = 1',
            'BEGIN TRANSACTION',
            'END CONVERSATION @handle',
            'SEND ON CONVERSATION @handle MESSAGE TYPE [message] (\'body\')',
        ]) {

            expect(sqlPermissionsFor(`SELECT 1\n${statement}`, 'mssql')).toEqual(['sql:read', 'sql:ddl']);
            expect(sqlPermissionsFor(statement, 'mssql')).toContain('sql:ddl');

        }
        expect(sqlPermissionsFor('SOME_UNRECOGNIZED_STATEMENT anything', 'mssql')).toEqual(['sql:ddl']);

    });

    it('keeps CASE, CTEs, assignments and masked T-SQL names in their proper classes', () => {

        for (const sql of [
            'SELECT CASE WHEN id = 1 THEN 2 ELSE 3 END FROM dbo.records',
            'WITH items AS (SELECT id FROM dbo.records) SELECT id FROM items',
            'SELECT id FROM dbo.records ORDER BY id OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY',
            'SELECT id FROM dbo.records ORDER BY id OFFSET 0 ROWS FETCH FIRST 10 ROWS ONLY',
            "SELECT 'DISABLE TRIGGER ALL ON dbo.records', [ENABLE TRIGGER], \"SET NOCOUNT ON\" -- WAITFOR DELAY\n FROM dbo.records",
        ]) {

            expect(sqlPermissionsFor(sql, 'mssql')).toEqual(['sql:read']);

        }
        expect(sqlPermissionsFor('UPDATE dbo.records SET value = 1, [NOCOUNT] = 2 WHERE id = 1', 'mssql'))
            .toEqual(['sql:write']);
        expect(sqlPermissionsFor('UPDATE dbo.records SET NOCOUNT   = 1 WHERE id = 1', 'mssql'))
            .toEqual(['sql:write']);
        expect(sqlPermissionsFor('WITH items AS (SELECT id FROM dbo.records) UPDATE items SET id = 2', 'mssql'))
            .toEqual(['sql:read', 'sql:write']);

    });

    it('preserves independently configured write and DDL decisions in mixed batches', () => {

        const access = { user: 'writer', agent: 'writer' };
        attachPolicyContext(access, { roles: {
            writer: { permissions: { 'sql:read': 'allow', 'sql:write': 'allow', 'sql:ddl': 'deny' } },
        } });
        const config = { name: 'test', access };
        const permissions = sqlPermissionsFor('SELECT 1\nDELETE FROM t\nCREATE TABLE x (id int)', 'mssql');
        expect(permissions.map((permission) => getConfigPermission('agent', config, permission)))
            .toEqual(['allow', 'allow', 'deny']);

    });

    it('applies both read and DDL decisions to semicolonless DENY', () => {

        const permissions = sqlPermissionsFor('SELECT 1\nDENY SELECT ON OBJECT::dbo.records TO app_reader', 'mssql');
        const viewerAccess = { user: 'viewer', agent: 'viewer' };
        attachPolicyContext(viewerAccess, {});
        expect(permissions.map((permission) => getConfigPermission('user', { name: 'test', access: viewerAccess }, permission)))
            .toEqual(['allow', 'deny']);

        const confirmAccess = { user: 'reviewer', agent: 'reviewer' };
        attachPolicyContext(confirmAccess, { roles: {
            reviewer: { permissions: { 'sql:read': 'confirm', 'sql:ddl': 'confirm' } },
        } });
        expect(permissions.map((permission) => getConfigPermission('user', { name: 'test', access: confirmAccess }, permission)))
            .toEqual(['allow', 'confirm']);

        const agentAccess = { user: 'viewer', agent: 'reviewer' };
        attachPolicyContext(agentAccess, { roles: {
            reviewer: { permissions: { 'sql:read': 'confirm', 'sql:ddl': 'confirm' } },
        } });
        expect(permissions.map((permission) => getConfigPermission('agent', { name: 'test', access: agentAccess }, permission)))
            .toEqual(['confirm', 'confirm']);

    });

    it('does not turn MSSQL literals, identifiers or comments into statements', () => {

        const sql = "SELECT 'DELETE FROM t; EXEC x', [DROP TABLE t], \"UPDATE t SET x = 1\" -- EXEC x\n/* outer /* DELETE FROM t */ EXEC x */ FROM [users]";
        expect(sqlPermissionsFor(sql, 'mssql')).toEqual(['sql:read']);
        expect(classifyStatements(sql, 'mssql')).toBe('read');

    });

    it('classifies MySQL and MariaDB executable comments without treating ordinary comments as code', () => {

        for (const sql of ['/*!DELETE FROM t*/', '/*!50000 DELETE FROM t*/', '/*M!100100 DELETE FROM t*/']) {

            expect(sqlPermissionsFor(sql, 'mysql')).toContain('sql:write');
            expect(classifyStatements(sql, 'mysql')).not.toBe('read');

        }
        expect(sqlPermissionsFor('SELECT 1; /*! DELETE FROM t */; CREATE TABLE x (id int)', 'mysql'))
            .toEqual(['sql:read', 'sql:write', 'sql:ddl']);
        expect(sqlPermissionsFor("SELECT '/*! DELETE FROM t */'; /* DELETE FROM t */ SELECT 1", 'mysql'))
            .toEqual(['sql:read']);

    });

    it('uses MySQL comment and escape rules when checking executable SQL', () => {

        for (const sql of [
            "SELECT 1--1 /*!INTO OUTFILE '/var/lib/mysql-files/noorm-review'*/",
            String.raw`SELECT 'a\'-- fake comment' /*! INTO OUTFILE '/tmp/result' */`,
            String.raw`SELECT "a\"-- fake comment" /*M! INTO OUTFILE '/tmp/result' */`,
        ]) {

            expect(sqlPermissionsFor(sql, 'mysql')).toContain('sql:ddl');
            expect(classifyStatements(sql, 'mysql')).toBe('ddl');

        }
        for (const sql of [
            'SELECT 1--1',
            String.raw`SELECT 'a\'-- fake comment; DROP TABLE t'`,
            String.raw`SELECT "a\"-- fake comment; DELETE FROM t"`,
            'SELECT `INTO OUTFILE`, 1 -- /*! INTO OUTFILE x */\n',
            'SELECT 1 # /*! DELETE FROM t */\n',
            'SELECT 1 /* /*! INTO OUTFILE x */',
        ]) {

            expect(sqlPermissionsFor(sql, 'mysql')).toEqual(['sql:read']);

        }
        expect(sqlPermissionsFor('SELECT 1--1; DELETE FROM t; CREATE TABLE x (id int)', 'mysql'))
            .toEqual(['sql:read', 'sql:write', 'sql:ddl']);

    });

    it('requires elevated permissions for remote execution and configuration functions', () => {

        for (const [sql, dialect] of [
            ["SELECT * FROM dblink('conn', 'DELETE FROM t RETURNING *') AS x(id int)", 'postgres'],
            ["SELECT dblink_exec('conn', 'DROP TABLE t')", 'postgres'],
            ["SELECT * FROM [OPENQUERY](linked, 'DELETE FROM t')", 'mssql'],
            ["SELECT set_config('role', 'admin', false)", 'postgres'],
            ["SELECT * FROM OPENQUERY(linked, 'DELETE FROM t')", 'mssql'],
            ["SELECT * FROM OPENROWSET('provider', 'connection', 'query')", 'mssql'],
            ["SELECT * FROM OPENDATASOURCE('provider', 'connection').db.dbo.t", 'mssql'],
        ] as const) {

            expect(sqlPermissionsFor(sql, dialect)).toContain('sql:ddl');
            expect(classifyStatements(sql, dialect)).toBe('ddl');

        }
        expect(sqlPermissionsFor("SELECT 'dblink('", 'postgres')).toEqual(['sql:read']);

    });

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

            expect(classifyVia('fallback', 'DESCRIBE users', 'mssql')).toBe('read');

        });

        it('should classify DESC as read on mssql (keyword fallback)', () => {

            expect(classifyVia('fallback', 'DESC users', 'mssql')).toBe('read');

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

        // Named "(keyword fallback)" before `classifyVia` existed to check the
        // claim: plain INSERT is valid postgres, so on mssql it takes the CST
        // path like everywhere else. The OUTPUT clause below is the genuinely
        // mssql-only form that reaches the fallback.
        it('should classify INSERT as write on mssql (parses via CST)', () => {

            expect(classifyVia('cst', "INSERT INTO users (name) VALUES ('alice')", 'mssql')).toBe('write');

        });

        it('should classify INSERT ... OUTPUT as write on mssql (keyword fallback)', () => {

            expect(classifyVia('fallback', "INSERT INTO users (name) OUTPUT INSERTED.id VALUES ('alice')", 'mssql')).toBe('write');

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

            expect(classifyVia('cst', 'CALL my_proc(1, 2)', 'postgres')).toBe('ddl');

        });

        it('should classify EXEC as ddl on mssql (keyword fallback)', () => {

            expect(classifyVia('fallback', 'EXEC sp_who2', 'mssql')).toBe('ddl');

        });

        // `EXECUTE` is postgres syntax too (for prepared statements), so this
        // one parses; only the `EXEC` abbreviation above reaches the fallback.
        it('should classify EXECUTE as ddl on mssql (parses via CST)', () => {

            expect(classifyVia('cst', 'EXECUTE sp_help', 'mssql')).toBe('ddl');

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

            expect(classifyVia('cst', 'SELECT * INTO new_table FROM users', 'postgres')).toBe('ddl');

        });

        it('should classify SELECT ... INTO #tmp as ddl on mssql (keyword fallback)', () => {

            expect(classifyVia('fallback', 'SELECT * INTO #tmp FROM users', 'mssql')).toBe('ddl');

        });

        it('should classify SELECT ... INTO OUTFILE as ddl on mysql (CST path)', () => {

            expect(classifyVia('cst', "SELECT * FROM users INTO OUTFILE '/tmp/x'", 'mysql')).toBe('ddl');

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

            expect(classifyVia('cst', 'WITH cte AS (SELECT 1) SELECT * FROM cte', 'postgres')).toBe('read');

        });

        it('should classify WITH ... INSERT as write (CST, postgres)', () => {

            expect(classifyVia('cst',
                'WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte',
                'postgres',
            )).toBe('write');

        });

        it('should classify WITH ... SELECT as read via keyword fallback (mssql-only syntax)', () => {

            expect(classifyVia('fallback',
                'WITH cte AS (SELECT TOP 1 * FROM t) SELECT * FROM cte',
                'mssql',
            )).toBe('read');

        });

        it('should classify WITH ... DELETE as write via keyword fallback (mssql-only syntax)', () => {

            expect(classifyVia('fallback',
                'WITH cte AS (SELECT TOP 1 * FROM t) DELETE FROM cte',
                'mssql',
            )).toBe('write');

        });

    });

    describe('CTE-DML — data-modifying CTE definitions bypass the read gate', () => {

        it('should classify WITH t AS (DELETE ... RETURNING ...) SELECT as write (CST, postgres)', () => {

            expect(classifyVia('cst',
                'WITH t AS (DELETE FROM users WHERE id=1 RETURNING id) SELECT * FROM t',
                'postgres',
            )).toBe('write');

        });

        it('should classify WITH t AS (INSERT ... RETURNING ...) SELECT as write (CST, postgres)', () => {

            expect(classifyVia('cst',
                "WITH t AS (INSERT INTO users(name) VALUES ('x') RETURNING id) SELECT * FROM t",
                'postgres',
            )).toBe('write');

        });

        it('should classify WITH t AS (UPDATE ... RETURNING ...) SELECT as write (CST, postgres)', () => {

            expect(classifyVia('cst',
                "WITH t AS (UPDATE users SET name='y' WHERE id=1 RETURNING id) SELECT * FROM t",
                'postgres',
            )).toBe('write');

        });

        it('should classify WITH t AS (DELETE ...) SELECT as write via keyword fallback (mssql TOP forces fallback)', () => {

            expect(classifyVia('fallback',
                'WITH t AS (DELETE TOP (1) FROM users) SELECT * FROM t',
                'mssql',
            )).toBe('write');

        });

        it('should still classify a pure WITH t AS (SELECT ...) SELECT as read (CST, postgres — no false positive)', () => {

            expect(classifyVia('cst', 'WITH t AS (SELECT 1) SELECT * FROM t', 'postgres')).toBe('read');

        });

        it('should still classify a pure WITH t AS (SELECT ...) SELECT as read via keyword fallback (mssql — no false positive)', () => {

            expect(classifyVia('fallback',
                'WITH t AS (SELECT TOP 1 * FROM t) SELECT * FROM t',
                'mssql',
            )).toBe('read');

        });

    });

    describe('destructive function denylist', () => {

        it('should classify SELECT pg_terminate_backend(...) as write (CST, postgres)', () => {

            expect(classifyVia('cst', 'SELECT pg_terminate_backend(123)', 'postgres')).toBe('write');

        });

        it('should classify SELECT pg_terminate_backend(...) as write via keyword fallback (mssql TOP forces fallback)', () => {

            expect(classifyVia('fallback', 'SELECT TOP 1 pg_terminate_backend(123)', 'mssql')).toBe('write');

        });

        it('should stay write when a denylisted function is called inside an already-write statement', () => {

            expect(classifyStatements(
                'UPDATE t SET x = pg_terminate_backend(1) WHERE id = 1',
                'postgres',
            )).toBe('write');

        });

        it('should classify SELECT count(*) as read (pure function, not on the denylist)', () => {

            expect(classifyStatements('SELECT count(*) FROM t', 'postgres')).toBe('read');

        });

        it('should classify SELECT now() as read (pure function, not on the denylist)', () => {

            expect(classifyStatements('SELECT now()', 'postgres')).toBe('read');

        });

        it('should classify SELECT delete_user(1) as read — documented limitation: unlisted side-effecting functions are not caught', () => {

            expect(classifyStatements('SELECT delete_user(1)', 'postgres')).toBe('read');

        });

        it('should classify a schema-qualified denylisted function call as write (member_expr name)', () => {

            expect(classifyStatements('SELECT pg_catalog.pg_terminate_backend(1)', 'postgres')).toBe('write');

        });

        it('should classify a quoted-schema-qualified denylisted function call as write (member_expr name)', () => {

            expect(classifyStatements('SELECT "pg_catalog".pg_terminate_backend(1)', 'postgres')).toBe('write');

        });

        it('should classify a doubly-qualified denylisted function call as write (nested member_expr, rightmost property wins)', () => {

            expect(classifyStatements('SELECT db.pg_catalog.pg_terminate_backend(1)', 'postgres')).toBe('write');

        });

        it('should classify a schema-qualified pure function call as read (no false positive from qualification alone)', () => {

            expect(classifyStatements('SELECT pg_catalog.count(x) FROM t', 'postgres')).toBe('read');

        });

        it('should classify a denylisted name used as a column qualifier (not a function call) as read', () => {

            expect(classifyStatements('SELECT pg_terminate_backend.x FROM t', 'postgres')).toBe('read');

        });

        it('should classify SELECT query_to_xml(...) as write (arbitrary-SQL-executing XML function)', () => {

            expect(classifyStatements("SELECT query_to_xml('DELETE FROM users', false, false, '')", 'postgres')).toBe('write');

        });

    });

    describe('MSSQL identifiers named like statements stay reads; no-separator privileged statements stay ddl', () => {

        it.each([
            'SELECT [close] FROM stock_prices',
            'SELECT "use" FROM t',
            'SELECT receive FROM t',
            'SELECT a, receive FROM t',
            'SELECT * FROM t WHERE receive = 1',
            'SELECT t.receive FROM t',
        ])('should classify %s as read', (sql) => {

            expect(classifyStatements(sql, 'mssql')).toBe('read');

        });

        it.each([
            'SELECT 1 USE master',
            'SELECT 1 KILL 52',
            "SELECT 1 PRINT 'x'",
            'SELECT 1 RETURN',
            'SELECT * FROM t WHERE 1=1 COMMIT',
            'SELECT 1 CHECKPOINT',
            'SELECT 1 REVERT',
            'SELECT 1 OPEN c',
            "SELECT 'a' USE master",
            'SELECT (1) USE master',
            'SELECT 1 /*x*/ USE master',
            'SELECT 1\tKILL 52',
            'RECEIVE * FROM q',
            'SELECT 1 AS a WAITFOR (RECEIVE [message_body] FROM q)',
            'SELECT 1 AS a WAITFOR (RECEIVE (message_body) FROM q)',
            "SELECT 1 AS a WAITFOR (RECEIVE 'x' FROM q)",
            'SELECT 1 AS a WAITFOR (RECEIVE -1 FROM q)',
            'SELECT 1 AS a WAITFOR ( RECEIVE "message_body" FROM q )',
            'SELECT 1 AS a WAITFOR(RECEIVE [message_body] FROM q)',
            'SELECT 1 AS a WAITFOR (RECEIVE [message_body] FROM q), TIMEOUT 10',
            'SELECT 1 AS a lbl: RECEIVE [message_body] FROM q',
            'SELECT 1 AS a lbl:RECEIVE (message_body) FROM q',
            'SELECT 1 AS a lbl: /* c */ RECEIVE -1 FROM q',
            'SELECT 1 AS a lbl: -- c\nRECEIVE [message_body] FROM q',
        ])('should classify %s as ddl', (sql) => {

            expect(classifyStatements(sql, 'mssql')).toBe('ddl');

        });

    });

    describe('CTE final statement — own subquery parens must not be mistaken for the CTE boundary', () => {

        it('should classify a CTE with a SELECT final statement containing a subquery as read via keyword fallback (mssql)', () => {

            expect(classifyVia('fallback',
                'WITH t AS (SELECT TOP 1 * FROM x) SELECT * FROM users WHERE id IN (SELECT id FROM t)',
                'mssql',
            )).toBe('read');

        });

        it('should classify a CTE with a DELETE final statement containing a subquery as write via keyword fallback (mssql), not over-denied to ddl', () => {

            expect(classifyVia('fallback',
                'WITH t AS (SELECT TOP 1 * FROM x) DELETE FROM users WHERE id IN (SELECT id FROM t)',
                'mssql',
            )).toBe('write');

        });

    });

});
