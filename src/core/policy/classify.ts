import { cstVisitor, parse, type Program } from 'sql-parser-cst';
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
 * Side-effecting builtins that must not be treated as read-only just because
 * they're invoked from a SELECT. Guardrail against a `viewer` config running
 * `SELECT pg_terminate_backend(...)` through the read-allowed `sql` path.
 *
 * Deliberately a denylist, not an allowlist: `SELECT f()` is statically
 * undecidable, so pure helpers (`count`, `now`, `coalesce`, ...) stay `read`
 * and only known-dangerous calls are caught. An unlisted side-effecting
 * function on a viewer config is a documented limitation — this guards
 * against casual/accidental writes, not a determined adversary.
 */
export const DESTRUCTIVE_FUNCTIONS: ReadonlySet<string> = new Set([
    'pg_terminate_backend',
    'pg_cancel_backend',
    'pg_reload_conf',
    'pg_rotate_logfile',
    'pg_promote',
    'pg_switch_wal',
    'pg_create_restore_point',
    'pg_drop_replication_slot',
    'lo_import',
    'lo_export',
    'lo_unlink',
    'setval',
    'nextval',
    'dblink_exec',
    'query_to_xml',
    'query_to_xmlschema',
    'query_to_xml_and_xmlschema',
    'cursor_to_xml',
    'cursor_to_xmlschema',
]);

/**
 * Word-boundary match for a denylisted function call, used by the keyword
 * fallback. Built once from `DESTRUCTIVE_FUNCTIONS` rather than per call.
 */
const DESTRUCTIVE_FUNCTION_PATTERN = new RegExp(`\\b(?:${[...DESTRUCTIVE_FUNCTIONS].join('|')})\\s*\\(`, 'i');

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
 *
 * A data-modifying CTE definition (`WITH t AS (DELETE ... ) SELECT ...`) or
 * a denylisted function call anywhere in the tree upgrades the result to at
 * least `write`, even when the outer/final statement is a plain SELECT.
 */
function classifyCst(program: Program): SqlClass {

    let highest: SqlClass = 'read';

    for (const stmt of program.statements) {

        highest = maxClass(highest, classifyStmtType(stmt));

    }

    if (containsWriteSignal(program)) {

        highest = maxClass(highest, 'write');

    }

    return highest;

}

/**
 * True when the tree contains a data-modifying statement nested inside
 * another statement (only possible via a CTE definition body — see
 * `CommonTableExpr.expr` in sql-parser-cst's types) or a call to a
 * `DESTRUCTIVE_FUNCTIONS` builtin anywhere. Either signals at least `write`
 * regardless of what the outer/final statement looks like.
 */
function containsWriteSignal(program: Program): boolean {

    let found = false;

    const markWrite = () => {

        found = true;

    };

    const visit = cstVisitor({
        insert_stmt: markWrite,
        update_stmt: markWrite,
        delete_stmt: markWrite,
        merge_stmt: markWrite,
        func_call: (node) => {

            // A schema-qualified call (`pg_catalog.pg_terminate_backend(...)`) parses to a
            // member_expr name; its `property` is the called identifier regardless of
            // qualification depth (`db.pg_catalog.fn` nests further qualifiers under
            // `object`, so `property` is always the rightmost/actual function name).
            const funcName = node.name.type === 'identifier' ? node.name : node.name.property;

            if (funcName.type === 'identifier' && DESTRUCTIVE_FUNCTIONS.has(funcName.name.toLowerCase())) {

                found = true;

            }

        },
    });

    visit(program);

    return found;

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

    if (hasDestructiveFunctionCall(stripped)) {

        highest = maxClass(highest, 'write');

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
 * Classify a CTE (WITH ...): the highest of (a) the final statement's own
 * class and (b) any data-modifying CTE definition's class. A `WITH t AS
 * (DELETE ...) SELECT ...` must classify as `write` even though the final
 * statement is a SELECT — keying only off the final keyword would miss it.
 */
function classifyCte(upper: string): SqlClass {

    return maxClass(classifyCteDefinitions(upper), classifyCteFinalStatement(upper));

}

/**
 * Classify a CTE by the keyword of its final statement.
 *
 * Finds the keyword right after the CTE definition list ends, using the
 * same `AS (...)` boundary as `classifyCteDefinitions` — not just the
 * last top-level closing paren, which a subquery inside the final
 * statement itself (`... WHERE id IN (SELECT ...)`) would also close at
 * depth 0, misidentifying the CTE boundary.
 */
function classifyCteFinalStatement(upper: string): SqlClass {

    const cteEnd = findCteDefinitionsEnd(upper);

    if (cteEnd === -1) return 'ddl';

    const afterCte = upper.slice(cteEnd).trim();

    // Skip optional comma (recursive CTEs)
    const finalStmt = afterCte.replace(/^,/, '').trim();
    const finalKeyword = finalStmt.match(/^(\w+)/)?.[1];

    if (finalKeyword === 'SELECT') return hasTopLevelInto(finalStmt) ? 'ddl' : 'read';
    if (finalKeyword && READ_KEYWORDS[finalKeyword]) return 'read';
    if (finalKeyword && WRITE_KEYWORDS[finalKeyword]) return 'write';

    return 'ddl';

}

/**
 * Index just past the closing paren of the last `name AS (...)` CTE
 * definition — the boundary between the definition list and the final
 * statement. Walks the same comma-separated, depth-0 `AS (...)` structure
 * as `classifyCteDefinitions` so a paren inside the final statement's own
 * subquery is never mistaken for this boundary.
 */
function findCteDefinitionsEnd(upper: string): number {

    let depth = 0;
    let i = 0;
    let end = -1;

    while (i < upper.length) {

        if (upper[i] === '(') {

            if (depth === 0 && isPrecededByAsKeyword(upper, i)) {

                const bodyEnd = findMatchingParen(upper, i);

                end = bodyEnd + 1;
                i = bodyEnd + 1;
                continue;

            }

            depth++;
            i++;
            continue;

        }

        if (upper[i] === ')') {

            depth--;
            i++;
            continue;

        }

        i++;

    }

    return end;

}

/**
 * Scan each top-level CTE definition body (`name AS (...)`) for a leading
 * data-modifying or DDL keyword. Mirrors the CST path's inspection of the
 * parsed CTE's inner statement type, for dialects where the parser throws
 * and classification falls back to keywords.
 */
function classifyCteDefinitions(upper: string): SqlClass {

    let highest: SqlClass = 'read';
    let depth = 0;
    let i = 0;

    while (i < upper.length) {

        if (upper[i] === '(') {

            if (depth === 0 && isPrecededByAsKeyword(upper, i)) {

                const bodyEnd = findMatchingParen(upper, i);
                const body = upper.slice(i + 1, bodyEnd).trim();

                highest = maxClass(highest, classifyCteBodyKeyword(body));

                i = bodyEnd + 1;
                continue;

            }

            depth++;
            i++;
            continue;

        }

        if (upper[i] === ')') {

            depth--;
            i++;
            continue;

        }

        i++;

    }

    return highest;

}

/**
 * True when the `(` at `openIdx` is immediately preceded (ignoring
 * whitespace) by a standalone `AS` keyword — the shape of a CTE
 * definition's `name AS (...)` body, as opposed to a column-list paren
 * (`name(a, b)`) or an unrelated nested paren.
 */
function isPrecededByAsKeyword(text: string, openIdx: number): boolean {

    let j = openIdx - 1;

    while (j >= 0) {

        const ch = text[j];

        if (ch === undefined || !/\s/.test(ch)) break;

        j--;

    }

    if (j < 1 || text[j] !== 'S' || text[j - 1] !== 'A') return false;

    const before = text[j - 2];

    return before === undefined || !/\w/.test(before);

}

/**
 * Index of the `)` matching the `(` at `openIdx`, tracking nested depth.
 * Falls back to the end of the string for malformed/unterminated input.
 */
function findMatchingParen(text: string, openIdx: number): number {

    let depth = 0;

    for (let k = openIdx; k < text.length; k++) {

        if (text[k] === '(') depth++;
        if (text[k] === ')') {

            depth--;

            if (depth === 0) return k;

        }

    }

    return text.length - 1;

}

/**
 * Classify a single CTE definition body by its leading keyword. Recurses
 * for a CTE-within-a-CTE (`t AS (WITH inner AS (...) SELECT ...)`).
 */
function classifyCteBodyKeyword(body: string): SqlClass {

    const firstWord = body.match(/^(\w+)/)?.[1];

    if (!firstWord) return 'read';
    if (firstWord === 'WITH') return classifyCte(body);
    if (READ_KEYWORDS[firstWord]) return 'read';
    if (WRITE_KEYWORDS[firstWord]) return 'write';

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
 * True when the SQL invokes a `DESTRUCTIVE_FUNCTIONS` builtin outside a
 * string literal. Used by the keyword fallback, where there's no CST to
 * walk for `func_call` nodes.
 */
function hasDestructiveFunctionCall(sql: string): boolean {

    return DESTRUCTIVE_FUNCTION_PATTERN.test(blankStringLiterals(sql));

}

/**
 * Replace the contents of single-quoted string literals with spaces,
 * preserving overall length. Mirrors the quote-tracking used elsewhere in
 * this file (`stripComments`, `hasTopLevelInto`) so a denylisted function
 * name embedded in a quoted value can't spoof a match.
 */
function blankStringLiterals(sql: string): string {

    let result = '';
    let i = 0;

    while (i < sql.length) {

        if (sql[i] !== "'") {

            result += sql[i++];
            continue;

        }

        result += ' ';
        i++;

        while (i < sql.length) {

            if (sql[i] === "'" && sql[i + 1] === "'") {

                result += '  ';
                i += 2;
                continue;

            }

            if (sql[i] === "'") {

                result += ' ';
                i++;
                break;

            }

            result += ' ';
            i++;

        }

    }

    return result;

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
