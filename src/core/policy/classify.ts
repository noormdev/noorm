import { parse } from 'sql-parser-cst';
import { attemptSync } from '@logosdx/utils';

import type { Dialect } from '../connection/types.js';

/**
 * Statement classification. Multi-statement input takes the highest class
 * present (`read < write < ddl`).
 */
export type SqlClass = 'read' | 'write' | 'ddl';

/**
 * Dialect mapping from noorm to sql-parser-cst.
 */
const DIALECT_MAP: Record<Dialect, 'sqlite' | 'postgresql' | 'mysql' | 'bigquery'> = {
    sqlite: 'sqlite',
    postgres: 'postgresql',
    mysql: 'mysql',
    mssql: 'postgresql', // best-effort — fall back to keyword if parser chokes
};

/**
 * CST statement types that are read-only.
 */
const READ_STMT_TYPES: Record<string, true> = {
    select_stmt: true,
    explain_stmt: true,
    show_stmt: true,
    describe_stmt: true,
};

/**
 * CST statement types that write data without changing schema.
 */
const WRITE_STMT_TYPES: Record<string, true> = {
    insert_stmt: true,
    update_stmt: true,
    delete_stmt: true,
    merge_stmt: true,
};

/**
 * Keywords that indicate a read-only statement (uppercase).
 */
const READ_KEYWORDS: Record<string, true> = {
    SELECT: true,
    EXPLAIN: true,
    SHOW: true,
    DESCRIBE: true,
    DESC: true,
};

/**
 * Keywords that indicate a data-writing statement (uppercase).
 */
const WRITE_KEYWORDS: Record<string, true> = {
    INSERT: true,
    UPDATE: true,
    DELETE: true,
    MERGE: true,
};

/**
 * Ordering used to resolve the highest class across a multi-statement input.
 */
const CLASS_RANK: Record<SqlClass, number> = { read: 0, write: 1, ddl: 2 };

/**
 * Classify raw SQL as `read`, `write`, or `ddl`.
 *
 * Strategy: try sql-parser-cst first, fall back to keyword-based
 * if the parser throws (e.g., MSSQL-specific syntax). Anything not
 * recognized as read or write — CREATE/ALTER/DROP/TRUNCATE/GRANT/REVOKE/SET,
 * EXEC/CALL, or input the parser can't make sense of — classifies as `ddl`:
 * fail closed, since an unrecognized statement could do anything.
 *
 * @example
 * classifyStatements('SELECT * FROM users', 'postgres'); // 'read'
 * classifyStatements("INSERT INTO users (name) VALUES ('x')", 'postgres'); // 'write'
 * classifyStatements('DROP TABLE users', 'postgres'); // 'ddl'
 */
export function classifyStatements(sql: string, dialect: Dialect): SqlClass {

    const trimmed = sql.trim();

    if (trimmed === '') return 'read';

    // Try CST parser
    const [result, err] = attemptSync(() =>
        parse(trimmed, {
            dialect: DIALECT_MAP[dialect],
            includeComments: false,
            includeSpaces: false,
            includeNewlines: false,
        }),
    );

    if (!err && result) {

        return classifyCst(result);

    }

    // Parser failed — fall back to keyword-based
    return classifyKeyword(trimmed);

}

/**
 * Classify via CST. Highest class among all parsed statements wins.
 */
function classifyCst(program: { statements: Array<{ type: string; clauses?: Array<{ type: string }> }> }): SqlClass {

    let highest: SqlClass = 'read';

    for (const stmt of program.statements) {

        highest = maxClass(highest, classifyStmtType(stmt));

    }

    return highest;

}

/**
 * Map a single CST statement to a class. `empty` covers comment-only
 * or whitespace-only input that still parses successfully.
 *
 * A `select_stmt` carrying an INTO clause (`into_table_clause`,
 * `into_outfile_clause`, `into_variables_clause`, `into_dumpfile_clause`)
 * redirects the result set into a new table or a file instead of returning
 * rows — that's schema-creation or exfiltration, not a read. Fail closed
 * to `ddl` for any INTO variant rather than special-casing which ones
 * actually touch schema.
 */
function classifyStmtType(stmt: { type: string; clauses?: Array<{ type: string }> }): SqlClass {

    if (stmt.type === 'select_stmt' && stmt.clauses?.some((clause) => clause.type.startsWith('into_'))) {

        return 'ddl';

    }

    if (stmt.type === 'empty' || READ_STMT_TYPES[stmt.type]) return 'read';
    if (WRITE_STMT_TYPES[stmt.type]) return 'write';

    return 'ddl';

}

/**
 * Classify via keyword analysis.
 *
 * Strips comments, splits on semicolons, checks the leading keyword of each
 * statement, takes the highest class present.
 */
function classifyKeyword(sql: string): SqlClass {

    const stripped = stripComments(sql);
    const statements = splitStatements(stripped);

    if (statements.length === 0) return 'read';

    let highest: SqlClass = 'read';

    for (const stmt of statements) {

        highest = maxClass(highest, classifyKeywordStatement(stmt));

    }

    return highest;

}

/**
 * Classify a single statement (no comments, no semicolons) by its leading
 * keyword. Handles CTEs via paren-depth tracking for the WITH keyword.
 *
 * A leading SELECT carrying a top-level INTO (MSSQL `INTO #temp`, MySQL
 * `INTO OUTFILE`/`INTO @var`) is checked before the generic READ_KEYWORDS
 * lookup — the CST parser can reject dialect-specific INTO targets (e.g.
 * `#temp`), so this fallback must catch them too. Fail closed to `ddl`.
 */
function classifyKeywordStatement(stmt: string): SqlClass {

    const upper = stmt.toUpperCase();
    const firstWord = upper.match(/^(\w+)/)?.[1];

    if (!firstWord) return 'read';

    if (firstWord === 'SELECT') {

        return hasTopLevelInto(upper) ? 'ddl' : 'read';

    }

    if (READ_KEYWORDS[firstWord]) return 'read';

    // Handle WITH ... <stmt> (CTE)
    if (firstWord === 'WITH') {

        return classifyCte(upper);

    }

    if (WRITE_KEYWORDS[firstWord]) return 'write';

    return 'ddl';

}

/**
 * Classify a CTE (WITH ...) by the keyword of its final statement.
 *
 * Finds the last top-level keyword after all CTE definitions by tracking
 * parenthesis depth to skip past nested subqueries.
 */
function classifyCte(upper: string): SqlClass {

    // Find the final statement after the CTE definitions.
    // CTEs are: WITH name AS (...), name AS (...) <final statement>
    // We need to find the keyword after the last closing paren at depth 0.
    let depth = 0;
    let lastCloseIdx = -1;

    for (let i = 0; i < upper.length; i++) {

        if (upper[i] === '(') depth++;
        if (upper[i] === ')') {

            depth--;

            if (depth === 0) {

                lastCloseIdx = i;

            }

        }

    }

    if (lastCloseIdx === -1) return 'ddl';

    const afterCte = upper.slice(lastCloseIdx + 1).trim();

    // Skip optional comma (recursive CTEs)
    const finalStmt = afterCte.replace(/^,/, '').trim();
    const finalKeyword = finalStmt.match(/^(\w+)/)?.[1];

    if (finalKeyword === 'SELECT') return hasTopLevelInto(finalStmt) ? 'ddl' : 'read';
    if (finalKeyword && READ_KEYWORDS[finalKeyword]) return 'read';
    if (finalKeyword && WRITE_KEYWORDS[finalKeyword]) return 'write';

    return 'ddl';

}

/**
 * True when a top-level ` INTO ` keyword appears outside string literals
 * and outside parentheses. Mirrors the string/paren-depth tracking used
 * elsewhere in this file (`stripComments`, `classifyCte`) so a quoted
 * value like `'INTO table'` or an INTO nested inside a subquery's parens
 * doesn't trip the check — only a real SELECT ... INTO target does.
 */
function hasTopLevelInto(sql: string): boolean {

    let depth = 0;
    let inString = false;
    let i = 0;

    while (i < sql.length) {

        if (sql[i] === "'" && !inString) {

            inString = true;
            i++;

        }
        else if (sql[i] === "'" && inString) {

            if (sql[i + 1] === "'") {

                i += 2;

            }
            else {

                inString = false;
                i++;

            }

        }
        else if (inString) {

            i++;

        }
        else if (sql[i] === '(') {

            depth++;
            i++;

        }
        else if (sql[i] === ')') {

            depth--;
            i++;

        }
        else if (
            depth === 0 &&
            sql.slice(i, i + 4) === 'INTO' &&
            !/\w/.test(sql[i - 1] ?? ' ') &&
            !/\w/.test(sql[i + 4] ?? ' ')
        ) {

            return true;

        }
        else {

            i++;

        }

    }

    return false;

}

/**
 * Resolve the higher-impact of two classes (`read < write < ddl`).
 */
function maxClass(a: SqlClass, b: SqlClass): SqlClass {

    return CLASS_RANK[b] > CLASS_RANK[a] ? b : a;

}

/**
 * Split SQL on semicolons while respecting string literals.
 *
 * Naive split(';') mishandles semicolons inside quoted strings.
 * This walks the string tracking quote state to split correctly.
 */
function splitStatements(sql: string): string[] {

    const statements: string[] = [];
    let current = '';
    let inString = false;
    let i = 0;

    while (i < sql.length) {

        if (sql[i] === "'" && !inString) {

            inString = true;
            current += sql[i++];

        }
        else if (sql[i] === "'" && inString) {

            if (sql[i + 1] === "'") {

                current += "''";
                i += 2;

            }
            else {

                inString = false;
                current += sql[i++];

            }

        }
        else if (sql[i] === ';' && !inString) {

            const trimmed = current.trim();

            if (trimmed.length > 0) {

                statements.push(trimmed);

            }

            current = '';
            i++;

        }
        else {

            current += sql[i++];

        }

    }

    const trimmed = current.trim();

    if (trimmed.length > 0) {

        statements.push(trimmed);

    }

    return statements;

}

/**
 * Strip SQL comments while respecting string literals.
 *
 * Uses a state machine to avoid stripping comment markers that
 * appear inside single-quoted strings. This prevents crafted inputs
 * from hiding destructive SQL behind comment markers embedded in
 * string literals.
 */
function stripComments(sql: string): string {

    let result = '';
    let i = 0;

    while (i < sql.length) {

        // Single-quoted string — copy verbatim (handles '' escapes)
        if (sql[i] === "'") {

            result += sql[i++];

            while (i < sql.length) {

                if (sql[i] === "'" && sql[i + 1] === "'") {

                    result += "''";
                    i += 2;

                }
                else if (sql[i] === "'") {

                    result += sql[i++];
                    break;

                }
                else {

                    result += sql[i++];

                }

            }

        }
        // Block comment — skip
        else if (sql[i] === '/' && sql[i + 1] === '*') {

            i += 2;

            while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {

                i++;

            }

            i += 2; // skip closing */

        }
        // Line comment — skip to end of line
        else if (sql[i] === '-' && sql[i + 1] === '-') {

            i += 2;

            while (i < sql.length && sql[i] !== '\n') {

                i++;

            }

        }
        else {

            result += sql[i++];

        }

    }

    return result;

}
