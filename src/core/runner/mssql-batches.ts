/**
 * MSSQL batch separator (`GO`) splitter and runner.
 *
 * T-SQL uses `GO` as a batch separator rather than `;`. Several DDL statements
 * (`CREATE PROCEDURE`, `CREATE FUNCTION`, `CREATE TRIGGER`, `CREATE VIEW`,
 * `CREATE TYPE` for table-valued parameters) must be the only statement in
 * their batch, so multi-statement files require `GO` between them.
 *
 * `GO` is a sqlcmd / SSMS client-side directive — the database engine never
 * sees it. The runner has to recognize and remove it before feeding each batch
 * to the driver.
 */
import { sql } from 'kysely';

import { attempt } from '@logosdx/utils';

import { getSqlErrorMessage } from '../shared/index.js';

import { splitSqliteStatements } from './sqlite-statements.js';
import type { RunContext } from './types.js';


/**
 * Split MSSQL SQL content on the `GO` batch separator.
 *
 * `GO` is recognized only when it is the entire trimmed content of a line
 * (case-insensitive). The split regex anchors via `^\s*GO\s*$` with the
 * multiline + ignore-case flags. That means:
 *
 * - `GO` on its own line (any case, surrounding whitespace OK) is a split.
 * - `GOLANG` / `GONNA` / `GO;` / `EXEC GO sp_x` on a line are NOT splits.
 * - `GO` inside a string literal or block comment IS NOT preserved — the
 *   splitter is line-oriented and does not parse SQL. Keep `GO` tokens out
 *   of strings and `/* *\/` blocks. This matches sqlcmd behavior.
 *
 * Returns batches in source order, each trimmed. Empty batches and batches
 * that contain only line comments / blank lines are dropped.
 *
 * Future enhancements (intentionally NOT implemented):
 * - `GO <count>` repetition (sqlcmd allows `GO 3` to run the prior batch
 *   three times). Treated as a regular split for now; the count is dropped.
 * - Stripping `GO` tokens inside `/* ... *\/` block comments.
 *
 * @param content - Raw SQL file content
 * @returns Array of SQL batches, in source order, ready to execute
 *
 * @example
 * splitMssqlBatches('CREATE TABLE A (id INT);\nGO\nCREATE TABLE B (id INT);\n');
 * // → ['CREATE TABLE A (id INT);', 'CREATE TABLE B (id INT);']
 *
 * @example
 * splitMssqlBatches('-- comment only file\n');
 * // → []
 */
export function splitMssqlBatches(content: string): string[] {

    const batches = content.split(/^\s*GO\s*$/mi);

    return batches
        .map((b) => b.trim())
        .filter((b) => b.length > 0 && !isCommentOnly(b));

}

/**
 * Detect whether a SQL batch contains nothing but line comments and blanks.
 *
 * Used to drop empty trailing/leading batches after `GO` splits, and to skip
 * comment-only files. Only considers `--` line comments; `/* *\/` block
 * comments are not interpreted (the line splitter would mis-handle a `GO`
 * inside one anyway, which is a documented limitation).
 */
function isCommentOnly(batch: string): boolean {

    for (const line of batch.split('\n')) {

        const trimmed = line.trim();

        if (trimmed.length > 0 && !trimmed.startsWith('--')) {

            return false;

        }

    }

    return true;

}

/**
 * Execute a SQL file's body against the driver, dialect by dialect.
 *
 * Three behaviors, because the drivers genuinely differ:
 *
 * - **mssql** splits on `GO` and runs each batch sequentially.
 * - **sqlite** splits on statement boundaries. Its `prepare()` compiles only
 *   the first statement of a string and drops the rest without erroring, so
 *   without this every statement after the first in a file was silently
 *   discarded while the runner reported success.
 * - **postgres / mysql** execute the body whole, as before. Postgres runs
 *   all statements in one implicit transaction — splitting would quietly
 *   change that guarantee — and mysql rejects a multi-statement string
 *   outright, which is already loud.
 *
 * Failures short-circuit and are prefixed with `[batch N of M]` /
 * `[statement N of M]` so a `FileResult.error` identifies which fragment
 * failed. A file with nothing executable (empty, or only comments) is
 * success — the file ran, it just had nothing to do, matching
 * `psql /dev/null`.
 *
 * @returns `null` on success, or a user-facing error string on failure
 *
 * @example
 * const err = await executeSqlBody(context, sqlContent);
 * if (err) {
 *     // surface to FileResult.error and observer
 * }
 */
export async function executeSqlBody(
    context: RunContext,
    sqlContent: string,
): Promise<string | null> {

    if (context.dialect === 'mssql') {

        return executeFragments(context, splitMssqlBatches(sqlContent), 'batch');

    }

    if (context.dialect === 'sqlite') {

        return executeFragments(context, splitSqliteStatements(sqlContent), 'statement');

    }

    const [, execErr] = await attempt(() => sql.raw(sqlContent).execute(context.db));

    if (execErr) {

        return getSqlErrorMessage(execErr);

    }

    return null;

}

/**
 * Run pre-split fragments in order, stopping at the first failure.
 *
 * A single fragment reports its error unprefixed: there is nothing to
 * disambiguate, and the position marker would only add noise to what is
 * usually the whole file.
 */
async function executeFragments(
    context: RunContext,
    fragments: string[],
    label: 'batch' | 'statement',
): Promise<string | null> {

    for (let i = 0; i < fragments.length; i++) {

        const [, execErr] = await attempt(() => sql.raw(fragments[i]!).execute(context.db));

        if (execErr) {

            const message = getSqlErrorMessage(execErr);

            return fragments.length === 1
                ? message
                : `[${label} ${i + 1} of ${fragments.length}] ${message}`;

        }

    }

    return null;

}
