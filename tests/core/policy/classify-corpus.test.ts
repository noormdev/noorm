/**
 * Access policy: classifyStatements adversarial corpus.
 *
 * `classifyStatements` is the only thing standing between a `viewer` role and
 * arbitrary SQL, and it predicts what a database will do from ~800 lines of
 * hand-rolled parsing. `classify.test.ts` covers the happy shapes; this file
 * covers the shapes an attacker — or a careless copy-paste from the postgres
 * docs — actually produces, the ones that historically slipped through.
 *
 * Table-driven on purpose: a new bypass class is one row, not one `it()`, so
 * covering the next variant costs nothing. Each row carries a `why` because
 * an expectation without a reason is the exact failure mode that let
 * `EXPLAIN (ANALYZE) DELETE FROM t` ship classified as `read`.
 *
 * Each row also declares which of the two classification paths it exercises
 * (`cst` or `fallback`) and that is asserted, not assumed. The pre-existing
 * suite had six tests *named* "(keyword fallback)" that never checked which
 * path ran — so when the CST path and the fallback disagreed, which is
 * precisely the shape of every bypass here, nothing failed.
 */
import { describe, it, expect } from 'bun:test';
import { attemptSync } from '@logosdx/utils';
import { parse } from 'sql-parser-cst';

import { classifyStatements } from '../../../src/core/policy/index.js';
import type { SqlClass } from '../../../src/core/policy/index.js';
import type { Dialect } from '../../../src/core/connection/types.js';

/** sql-parser-cst grammar per noorm dialect — mirrors `DIALECT_MAP` in classify.ts. */
const CST_DIALECT: Record<Dialect, 'sqlite' | 'postgresql' | 'mysql'> = {
    sqlite: 'sqlite',
    postgres: 'postgresql',
    mysql: 'mysql',
    mssql: 'postgresql',
};

/** Which classification path an input takes. */
type Path = 'cst' | 'fallback';

/**
 * The path `classifyStatements` will take for this input: `cst` when the
 * parser accepts it, `fallback` when it throws. Recomputed here rather than
 * inferred from the dialect so a grammar upgrade that starts accepting an
 * input surfaces as a failing row instead of silently retargeting the test.
 */
function pathFor(sql: string, dialect: Dialect): Path {

    const [, err] = attemptSync(() => parse(sql.trim(), {
        dialect: CST_DIALECT[dialect],
        includeComments: false,
        includeSpaces: false,
        includeNewlines: false,
    }));

    return err ? 'fallback' : 'cst';

}

interface Row {
    /** Raw input handed to `classifyStatements`. */
    sql: string;
    dialect: Dialect;
    expected: SqlClass;
    /** Path this row is meant to exercise — asserted, not assumed. */
    path: Path;
    /** Why this classification is correct. Not optional: see file header. */
    why: string;
}

/**
 * `EXPLAIN` must inherit the class of the statement it wraps.
 *
 * Postgres `EXPLAIN ANALYZE` *executes* the plan, so `EXPLAIN (ANALYZE)
 * DELETE FROM t` deletes rows. Treating the `EXPLAIN` keyword as a terminal
 * `read` verdict handed a `viewer` role arbitrary DML on the CLI and over
 * MCP. Both paths had to be fixed: the CST parser accepts only the bare
 * `EXPLAIN ANALYZE <stmt>` form and rejects every parenthesised-option
 * variant, which is the form the postgres docs lead with.
 */
const explainRows: Row[] = [
    {
        sql: 'EXPLAIN SELECT * FROM users',
        dialect: 'postgres',
        expected: 'read',
        path: 'cst',
        why: 'planning a SELECT reads nothing else — the benign baseline this family must not over-deny',
    },
    {
        sql: 'EXPLAIN ANALYZE SELECT 1',
        dialect: 'postgres',
        expected: 'read',
        path: 'cst',
        why: 'ANALYZE executes the wrapped SELECT, which is still only a read',
    },
    {
        sql: 'EXPLAIN ANALYZE DELETE FROM todos',
        dialect: 'postgres',
        expected: 'write',
        path: 'cst',
        why: 'postgres executes the plan — rows are actually deleted',
    },
    {
        sql: 'EXPLAIN (ANALYZE) DELETE FROM todos',
        dialect: 'postgres',
        expected: 'write',
        path: 'fallback',
        why: 'the parenthesised option form is what the postgres docs lead with, and the CST parser rejects it',
    },
    {
        sql: 'EXPLAIN (ANALYZE, BUFFERS) DELETE FROM todos',
        dialect: 'postgres',
        expected: 'write',
        path: 'fallback',
        why: 'multiple options must not change the verdict of the wrapped DELETE',
    },
    {
        sql: 'EXPLAIN (ANALYZE, FORMAT JSON) UPDATE t SET a = 1',
        dialect: 'postgres',
        expected: 'write',
        path: 'fallback',
        why: 'option values inside the list are not statement keywords and must not terminate the scan',
    },
    {
        sql: 'EXPLAIN (COSTS OFF, ANALYZE ON) DELETE FROM t',
        dialect: 'postgres',
        expected: 'write',
        path: 'fallback',
        why: 'ANALYZE need not be the first option for the plan to execute',
    },
    {
        sql: 'EXPLAIN ANALYZE VERBOSE DELETE FROM todos',
        dialect: 'postgres',
        expected: 'write',
        path: 'fallback',
        why: 'bare option keywords stack, and the CST parser rejects the second one',
    },
    {
        sql: 'explain (analyze) delete from todos',
        dialect: 'postgres',
        expected: 'write',
        path: 'fallback',
        why: 'SQL keywords are case-insensitive; a lowercase bypass is still a bypass',
    },
    {
        sql: 'EXPLAIN (ANALYZE) INSERT INTO t VALUES (1)',
        dialect: 'postgres',
        expected: 'write',
        path: 'fallback',
        why: 'INSERT under EXPLAIN ANALYZE inserts for real',
    },
    {
        sql: 'EXPLAIN ANALYZE CREATE TABLE cli_pwned AS SELECT 1',
        dialect: 'postgres',
        expected: 'ddl',
        path: 'cst',
        why: 'CREATE TABLE AS is accepted by the parser under EXPLAIN and creates the table for real',
    },
    {
        sql: 'EXPLAIN ANALYZE CREATE MATERIALIZED VIEW mv AS SELECT 1',
        dialect: 'postgres',
        expected: 'ddl',
        path: 'cst',
        why: 'same shape as CREATE TABLE AS — the whole DDL family, not one instance, must escalate',
    },
    {
        sql: 'EXPLAIN ANALYZE SELECT * INTO x FROM y',
        dialect: 'postgres',
        expected: 'ddl',
        path: 'cst',
        why: 'SELECT INTO creates a table; wrapping it in EXPLAIN must not hide the INTO clause',
    },
    {
        sql: 'EXPLAIN (ANALYZE) CREATE INDEX i ON t (a)',
        dialect: 'postgres',
        expected: 'ddl',
        path: 'fallback',
        why: 'DDL under the option form has to escalate on the keyword path too',
    },
    {
        sql: 'EXPLAIN ANALYZE REFRESH MATERIALIZED VIEW mv',
        dialect: 'postgres',
        expected: 'ddl',
        path: 'cst',
        why: 'an unrecognised wrapped verb fails closed rather than inheriting EXPLAIN\'s read',
    },
    {
        sql: 'EXPLAIN QUERY PLAN SELECT 1',
        dialect: 'sqlite',
        expected: 'read',
        path: 'cst',
        why: 'sqlite EXPLAIN never executes; QUERY PLAN is an option prefix, not a statement',
    },
    {
        sql: 'EXPLAIN FORMAT=JSON SELECT 1',
        dialect: 'mysql',
        expected: 'read',
        path: 'fallback',
        why: 'mysql option syntax must be skipped, not mistaken for the wrapped statement',
    },
    {
        sql: 'EXPLAIN EXTENDED SELECT 1',
        dialect: 'mysql',
        expected: 'read',
        path: 'fallback',
        why: 'EXTENDED is a mysql option keyword the CST grammar does not know',
    },
    {
        sql: 'EXPLAIN ANALYZE DELETE FROM t',
        dialect: 'mysql',
        expected: 'write',
        path: 'cst',
        why: 'mysql 8.3+ executes EXPLAIN ANALYZE for DML; the gate must not depend on the server patch level',
    },
    {
        sql: 'EXPLAIN users',
        dialect: 'mysql',
        expected: 'read',
        path: 'fallback',
        why: 'mysql EXPLAIN <table> is a synonym for DESCRIBE — stripping the prefix must not over-deny it',
    },
    {
        sql: 'EXPLAIN (ANALYZE) DELETE FROM t',
        dialect: 'mssql',
        expected: 'write',
        path: 'fallback',
        why: 'mssql maps to the postgres grammar, so the fallback is its normal path, not a rare backstop',
    },
];

/**
 * Statement splitting must respect every quoting form the dialect has.
 *
 * The scanners tracked `'` only. An MSSQL bracket-quoted identifier holding
 * an odd number of apostrophes desynced the tracker into a phantom string
 * literal that swallowed the following `;` — hiding a whole second statement
 * from the gate. Proven live: a `viewer` dropped a table this way.
 */
const quotingRows: Row[] = [
    {
        sql: "SELECT 1 AS [a'b]; DROP TABLE aud_b",
        dialect: 'mssql',
        expected: 'ddl',
        path: 'fallback',
        why: 'the apostrophe is inside a bracket identifier and must not open a string literal',
    },
    {
        sql: "SELECT [it's] FROM (SELECT 1 AS [it's]) q; DROP TABLE aud_a",
        dialect: 'mssql',
        expected: 'ddl',
        path: 'fallback',
        why: 'two apostrophes rebalanced the old tracker by luck; the verdict must not depend on parity',
    },
    {
        sql: 'SELECT 1 AS [a;b]',
        dialect: 'mssql',
        expected: 'read',
        path: 'fallback',
        why: 'a semicolon inside a bracket identifier is not a statement boundary',
    },
    {
        sql: 'SELECT 1 AS [INTO] FROM t',
        dialect: 'mssql',
        expected: 'read',
        path: 'fallback',
        why: 'INTO inside a quoted identifier is not a SELECT ... INTO target',
    },
    {
        sql: 'SELECT `a;b` FROM t',
        dialect: 'mysql',
        expected: 'read',
        path: 'cst',
        why: 'backtick identifiers hide semicolons on mysql',
    },
    {
        sql: "SELECT `a'b` AS x FROM t LIMIT 1, 2, 3; DROP TABLE x",
        dialect: 'mysql',
        expected: 'ddl',
        path: 'fallback',
        why: 'an apostrophe inside a backtick identifier must not swallow the following statement',
    },
    {
        sql: 'SELECT "a;b" FROM t',
        dialect: 'postgres',
        expected: 'read',
        path: 'cst',
        why: 'double-quoted identifiers hide semicolons on postgres',
    },
    {
        sql: 'SELECT "a\'b" AS x FROM t GROUP BY 1, 2, 3, 4 HAVING; DROP TABLE x',
        dialect: 'postgres',
        expected: 'ddl',
        path: 'fallback',
        why: 'an apostrophe inside a double-quoted identifier must not swallow the following statement',
    },
    {
        sql: "SELECT 'a;b' FROM t",
        dialect: 'mssql',
        expected: 'read',
        path: 'cst',
        why: 'the original single-quote case still has to work after the scanner was generalised',
    },
    {
        sql: 'SELECT $$;DROP TABLE x$$',
        dialect: 'postgres',
        expected: 'read',
        path: 'cst',
        why: 'dollar-quoted bodies are string literals — the DROP inside one is data, not a statement',
    },
    {
        sql: "SELECT $tag$ ' $tag$ AS a FROM t GROUP BY 1, 2, 3 HAVING; DROP TABLE x",
        dialect: 'postgres',
        expected: 'ddl',
        path: 'fallback',
        why: 'a lone apostrophe inside a tagged dollar-quote must not open a string that hides the DROP',
    },
    {
        sql: 'SELECT * INTO #tmp FROM users',
        dialect: 'mssql',
        expected: 'ddl',
        path: 'fallback',
        why: 'mssql temp-table INTO creates a table and `#` must not be read as a comment on mssql',
    },
];

/**
 * Comments must be neutralised without becoming a hiding place, and without
 * a comment marker inside a string literal starting a comment.
 */
const commentRows: Row[] = [
    {
        sql: '-- leading comment\nSELECT 1',
        dialect: 'postgres',
        expected: 'read',
        path: 'cst',
        why: 'a leading line comment does not change what the statement is',
    },
    {
        sql: '/* leading comment */ DROP TABLE x',
        dialect: 'postgres',
        expected: 'ddl',
        path: 'cst',
        why: 'a block comment must not shift the leading-keyword scan off the real verb',
    },
    {
        sql: '-- DROP TABLE x\nSELECT 1',
        dialect: 'mssql',
        expected: 'read',
        path: 'cst',
        why: 'DDL inside a comment is inert and must not over-deny',
    },
    {
        sql: 'SELECT 1 -- ; DROP TABLE x',
        dialect: 'mssql',
        expected: 'read',
        path: 'cst',
        why: 'a commented-out statement separator is not a separator',
    },
    {
        sql: "SELECT TOP 1 'safe /* ' FROM t; DROP TABLE users -- */'",
        dialect: 'mssql',
        expected: 'ddl',
        path: 'fallback',
        why: 'a comment marker inside a string literal must not open a comment that swallows the DROP',
    },
    {
        sql: '/* multi\nline\ncomment */ DELETE FROM t',
        dialect: 'postgres',
        expected: 'write',
        path: 'cst',
        why: 'newlines inside a block comment must not terminate it early or hide the verb',
    },
];

/**
 * Data-modifying CTE bodies. The final statement is a plain SELECT, so
 * keying off the outer verb alone reads them as `read`.
 */
const cteRows: Row[] = [
    {
        sql: 'WITH t AS (DELETE FROM users WHERE id = 1 RETURNING id) SELECT * FROM t',
        dialect: 'postgres',
        expected: 'write',
        path: 'cst',
        why: 'the CTE body deletes rows even though the statement returns a result set',
    },
    {
        sql: 'WITH a AS (WITH b AS (DELETE FROM u RETURNING id) SELECT * FROM b) SELECT * FROM a',
        dialect: 'postgres',
        expected: 'write',
        path: 'cst',
        why: 'nesting the DML one level deeper must not hide it',
    },
    {
        sql: 'WITH t (id) AS (DELETE FROM u RETURNING id) SELECT * FROM t',
        dialect: 'postgres',
        expected: 'write',
        path: 'cst',
        why: 'an explicit CTE column list changes the syntax around AS, not the danger',
    },
    {
        sql: 'WITH t AS MATERIALIZED (DELETE FROM u RETURNING id) SELECT * FROM t',
        dialect: 'postgres',
        expected: 'write',
        path: 'cst',
        why: 'AS MATERIALIZED puts a keyword between AS and the body paren',
    },
    {
        sql: 'WITH t AS (SELECT TOP 1 * FROM x) DELETE FROM users WHERE id IN (SELECT id FROM t)',
        dialect: 'mssql',
        expected: 'write',
        path: 'fallback',
        why: 'the final statement is the DELETE; its own subquery parens are not the CTE boundary',
    },
    {
        sql: 'WITH t AS (SELECT TOP 1 * FROM x) SELECT * FROM users WHERE id IN (SELECT id FROM t)',
        dialect: 'mssql',
        expected: 'read',
        path: 'fallback',
        why: 'a read CTE with a read final statement must not be over-denied',
    },
];

/**
 * Leading bytes that are not SQL. `String.prototype.trim` removes Unicode
 * whitespace, but control characters survive — and a leading-keyword regex
 * that finds no word character used to answer `read`, which is fail-open at
 * the one place in this file that must fail closed.
 */
const junkPrefixRows: Row[] = [
    {
        sql: '\u00A0SELECT 1',
        dialect: 'postgres',
        expected: 'read',
        path: 'cst',
        why: 'NBSP is Unicode whitespace and is trimmed before parsing',
    },
    {
        sql: '\uFEFFDROP TABLE x',
        dialect: 'postgres',
        expected: 'ddl',
        path: 'cst',
        why: 'a BOM prefix is trimmed and must not disguise the DROP',
    },
    {
        sql: '\u0000DROP TABLE x',
        dialect: 'postgres',
        expected: 'ddl',
        path: 'fallback',
        why: 'a NUL prefix defeats the leading-word regex — unrecognised input fails closed, never to read',
    },
    {
        sql: '\u0001\u0002 DELETE FROM t',
        dialect: 'postgres',
        expected: 'ddl',
        path: 'fallback',
        why: 'any unrecognised leading control byte fails closed rather than answering read',
    },
];

/** Multi-statement input takes the highest class present. */
const multiRows: Row[] = [
    {
        sql: 'SELECT 1; DROP TABLE x',
        dialect: 'postgres',
        expected: 'ddl',
        path: 'cst',
        why: 'the gate sees one string; the database sees two statements',
    },
    {
        sql: 'SELECT 1;;SELECT 2',
        dialect: 'postgres',
        expected: 'read',
        path: 'cst',
        why: 'an empty statement between separators is not an unrecognised statement',
    },
    {
        sql: 'SELECT 1; INSERT INTO t VALUES (1); DROP TABLE t',
        dialect: 'postgres',
        expected: 'ddl',
        path: 'cst',
        why: 'the highest class present wins, not the first or the last',
    },
];

/**
 * `SELECT ... INTO` redirects a result set into a new table or a file, and
 * procedural blocks carry arbitrary statements the classifier cannot see
 * into.
 */
const redirectRows: Row[] = [
    {
        sql: 'SELECT * INTO new_table FROM users',
        dialect: 'postgres',
        expected: 'ddl',
        path: 'cst',
        why: 'SELECT INTO creates a table',
    },
    {
        sql: "SELECT * FROM users INTO OUTFILE '/tmp/x'",
        dialect: 'mysql',
        expected: 'ddl',
        path: 'cst',
        why: 'INTO OUTFILE writes to the server filesystem',
    },
    {
        sql: "SELECT * FROM users WHERE name = 'INTO x'",
        dialect: 'postgres',
        expected: 'read',
        path: 'cst',
        why: 'INTO inside a string literal is data, not a clause — no false positive',
    },
    {
        sql: 'DO $$ BEGIN DELETE FROM t; END $$',
        dialect: 'postgres',
        expected: 'ddl',
        path: 'cst',
        why: 'a DO block runs opaque procedural code; the classifier cannot see inside it, so it fails closed',
    },
];

/**
 * Compound selects are reads. They were classified `ddl` because
 * `compound_select_stmt` was missing from the read set — harmless while it
 * only over-denied the outer statement, but it also appears nested inside
 * ordinary subqueries, so the nested-statement scan would escalate those too.
 */
const compoundRows: Row[] = [
    {
        sql: 'SELECT 1 UNION SELECT 2',
        dialect: 'postgres',
        expected: 'read',
        path: 'cst',
        why: 'a UNION of two SELECTs reads and nothing else',
    },
    {
        sql: 'SELECT * FROM (SELECT 1 UNION SELECT 2) x',
        dialect: 'postgres',
        expected: 'read',
        path: 'cst',
        why: 'a compound select nested in a subquery must not escalate the whole statement',
    },
    {
        sql: 'SELECT 1 INTERSECT SELECT 2',
        dialect: 'postgres',
        expected: 'read',
        path: 'cst',
        why: 'same for the other set operators',
    },
];

/**
 * The builtin denylist. Named `DESTRUCTIVE_FUNCTIONS`, but its real job is
 * "must not be reachable from a role whose promise is read-only" — which
 * includes reading the database server's filesystem.
 */
const builtinRows: Row[] = [
    {
        sql: 'SELECT pg_terminate_backend(123)',
        dialect: 'postgres',
        expected: 'write',
        path: 'cst',
        why: 'a side-effecting builtin called from a SELECT is still a side effect',
    },
    {
        sql: "SELECT pg_read_file('postgresql.conf', 0, 90) AS f",
        dialect: 'postgres',
        expected: 'write',
        path: 'cst',
        why: 'a viewer reading the server filesystem is exfiltration, whatever the verb says',
    },
    {
        sql: "SELECT pg_ls_dir('.')",
        dialect: 'postgres',
        expected: 'write',
        path: 'cst',
        why: 'directory listing is the same family as pg_read_file',
    },
    {
        sql: "SELECT count(*) FROM t WHERE note = 'pg_read_file('",
        dialect: 'postgres',
        expected: 'read',
        path: 'cst',
        why: 'a denylisted name inside a string literal must not spoof a match',
    },
    {
        sql: 'SELECT count(*) FROM t',
        dialect: 'postgres',
        expected: 'read',
        path: 'cst',
        why: 'pure aggregates stay read — the denylist must not become an allowlist',
    },
];

const corpus: ReadonlyArray<readonly [string, Row[]]> = [
    ['EXPLAIN wrapping', explainRows],
    ['quoting and statement splitting', quotingRows],
    ['comments', commentRows],
    ['data-modifying CTEs', cteRows],
    ['non-SQL leading bytes', junkPrefixRows],
    ['multi-statement', multiRows],
    ['result-set redirection and procedural blocks', redirectRows],
    ['compound selects', compoundRows],
    ['builtin denylist', builtinRows],
];

describe('policy: classifyStatements — adversarial corpus', () => {

    for (const [group, groupRows] of corpus) {

        describe(group, () => {

            for (const row of groupRows) {

                const label = `${row.dialect}/${row.path}: ${JSON.stringify(row.sql)} -> ${row.expected}`;

                it(`should classify ${label} because ${row.why}`, () => {

                    expect(pathFor(row.sql, row.dialect)).toBe(row.path);
                    expect(classifyStatements(row.sql, row.dialect)).toBe(row.expected);

                });

            }

        });

    }

    it('should never answer read for an input whose expected class is higher', () => {

        const escalating = corpus
            .flatMap(([, groupRows]) => groupRows)
            .filter((row) => row.expected !== 'read')
            .filter((row) => classifyStatements(row.sql, row.dialect) === 'read');

        expect(escalating.map((row) => row.sql)).toEqual([]);

    });

});
