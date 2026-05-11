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
 * Execute a SQL file's body against the driver, handling MSSQL `GO` batches.
 *
 * Non-MSSQL dialects execute the whole content in one statement (matching the
 * historical behavior). MSSQL splits on `GO` and runs each batch sequentially,
 * short-circuiting on the first failure and prefixing the error with
 * `[batch N of M]` so callers can identify the offending batch when reading
 * the error in a `FileResult`.
 *
 * A zero-batch MSSQL file (empty or comment-only after stripping `GO`) is
 * treated as success — the file ran, it just had nothing to execute. That
 * matches what `psql /dev/null` would do.
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

    if (context.dialect !== 'mssql') {

        const [, execErr] = await attempt(() => sql.raw(sqlContent).execute(context.db));

        if (execErr) {

            return getSqlErrorMessage(execErr);

        }

        return null;

    }

    const batches = splitMssqlBatches(sqlContent);

    if (batches.length === 0) {

        return null;

    }

    if (batches.length === 1) {

        const [, execErr] = await attempt(() => sql.raw(batches[0]!).execute(context.db));

        if (execErr) {

            return getSqlErrorMessage(execErr);

        }

        return null;

    }

    for (let i = 0; i < batches.length; i++) {

        const [, execErr] = await attempt(() => sql.raw(batches[i]!).execute(context.db));

        if (execErr) {

            return `[batch ${i + 1} of ${batches.length}] ${getSqlErrorMessage(execErr)}`;

        }

    }

    return null;

}
