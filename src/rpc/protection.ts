import { parse } from 'sql-parser-cst';
import { attemptSync } from '@logosdx/utils';

import type { Dialect } from '../core/connection/types.js';

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
 * Statement types that are read-only.
 */
const READ_ONLY_STMT_TYPES: Record<string, true> = {
    select_stmt: true,
    explain_stmt: true,
    show_stmt: true,
    describe_stmt: true,
};

/**
 * Keywords that indicate a read-only statement (uppercase).
 */
const READ_ONLY_KEYWORDS: Record<string, true> = {
    SELECT: true,
    EXPLAIN: true,
    SHOW: true,
    DESCRIBE: true,
    DESC: true,
};

/**
 * Check if a SQL string contains only read-only statements.
 *
 * Strategy: try sql-parser-cst first, fall back to keyword-based
 * if the parser throws (e.g., MSSQL-specific syntax).
 *
 * @example
 * isReadOnlyStatement('SELECT * FROM users', 'postgres'); // true
 * isReadOnlyStatement('DROP TABLE users', 'postgres');    // false
 */
export function isReadOnlyStatement(sql: string, dialect: Dialect): boolean {

    const trimmed = sql.trim();

    if (trimmed === '') return true;

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

        return isReadOnlyCst(result);

    }

    // Parser failed — fall back to keyword-based
    return isReadOnlyKeyword(trimmed);

}

/**
 * Check read-only via CST.
 *
 * Iterates all parsed statements and verifies each maps to an allowed type.
 */
function isReadOnlyCst(program: { statements: Array<{ type: string }> }): boolean {

    for (const stmt of program.statements) {

        if (!READ_ONLY_STMT_TYPES[stmt.type]) {

            return false;

        }

    }

    return true;

}

/**
 * Check read-only via keyword analysis.
 *
 * Strips comments, splits on semicolons, checks leading keyword.
 */
function isReadOnlyKeyword(sql: string): boolean {

    const stripped = stripComments(sql);
    const statements = splitStatements(stripped);

    if (statements.length === 0) return true;

    for (const stmt of statements) {

        if (!isStatementReadOnly(stmt)) {

            return false;

        }

    }

    return true;

}

/**
 * Check if a single statement (no comments, no semicolons) is read-only.
 *
 * Handles CTEs via paren-depth tracking for the WITH keyword.
 */
function isStatementReadOnly(stmt: string): boolean {

    const upper = stmt.toUpperCase();
    const firstWord = upper.match(/^(\w+)/)?.[1];

    if (!firstWord) return true;

    if (READ_ONLY_KEYWORDS[firstWord]) return true;

    // Handle WITH ... SELECT (CTE)
    if (firstWord === 'WITH') {

        return isCteReadOnly(upper);

    }

    return false;

}

/**
 * Check if a CTE (WITH ...) ends with a SELECT.
 *
 * Finds the last top-level keyword after all CTE definitions by tracking
 * parenthesis depth to skip past nested subqueries.
 */
function isCteReadOnly(upper: string): boolean {

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

    if (lastCloseIdx === -1) return false;

    const afterCte = upper.slice(lastCloseIdx + 1).trim();

    // Skip optional comma (recursive CTEs)
    const finalKeyword = afterCte.replace(/^,/, '').trim().match(/^(\w+)/)?.[1];

    return finalKeyword === 'SELECT';

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
