/**
 * Shared error formatting for database driver errors.
 *
 * Extracts diagnostic information from database-specific error objects
 * (tedious/TDS, pg, mysql2) that would otherwise be lost when only
 * the `.message` property is used.
 *
 * @example
 * ```typescript
 * const [, err] = await attempt(() => sql.raw(content).execute(db));
 * if (err) {
 *     const message = getSqlErrorMessage(err);
 *     // "[Line 42, Err 207] Invalid column name 'email_addrss'"
 * }
 * ```
 */


// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Extract a rich error message from a database driver error.
 *
 * Handles AggregateError (tedious), arrays (Kysely-unpacked AggregateError),
 * and single errors from tedious, pg, and mysql2. Preserves diagnostic
 * properties like line numbers, error codes, procedure names, and severity.
 */
export function getSqlErrorMessage(err: unknown): string {

    // AggregateError (tedious throws these) — format each inner error
    if (err instanceof AggregateError && err.errors?.length > 0) {

        return err.errors.map((e) => getSqlErrorMessage(e)).join('\n');

    }

    // Array (Kysely unpacks AggregateError.errors before rejecting)
    if (Array.isArray(err) && err.length > 0) {

        return (err as unknown[]).map((e) => getSqlErrorMessage(e)).join('\n');

    }

    if (err instanceof Error) {

        return formatWithDiagnostics(err);

    }

    if (typeof err === 'string') return err;

    if (typeof err === 'object' && err !== null) {

        const e = err as Record<string, unknown>;

        // Standard message property
        if (typeof e['message'] === 'string' && e['message']) {

            return formatWithDiagnostics(e);

        }

        // Tedious: errors[] array on non-AggregateError objects
        if (Array.isArray(e['errors']) && e['errors'].length > 0) {

            return (e['errors'] as unknown[]).map((inner) => getSqlErrorMessage(inner)).join('\n');

        }

        // MSSQL tedious: originalError with diagnostics
        if (typeof e['originalError'] === 'object' && e['originalError'] !== null) {

            return getSqlErrorMessage(e['originalError']);

        }

        // Fallback: try toString
        const str = String(err);
        if (str !== '[object Object]') return str;

    }

    return 'Unknown error';

}


// ─────────────────────────────────────────────────────────────
// Internal
// ─────────────────────────────────────────────────────────────

/**
 * Format an error or error-like object with database-specific diagnostics.
 *
 * Detects MSSQL (tedious), PostgreSQL (pg), and MySQL (mysql2) error shapes
 * and prepends diagnostic info as a bracketed prefix.
 *
 * MSSQL example:  "[Line 42, Err 207] Invalid column name 'email'"
 * PG example:     "[ERROR 42P01] relation "users" does not exist"
 * MySQL example:  "[Err 1054] Unknown column 'email' in 'field list'"
 */
function formatWithDiagnostics(err: Error | Record<string, unknown>): string {

    const e = err as Record<string, unknown>;
    const message = (err instanceof Error ? err.message : String(e['message'] ?? '')) || 'Unknown error';

    const diagnostics = extractMssqlDiagnostics(e)
        ?? extractPgDiagnostics(e)
        ?? extractMysqlDiagnostics(e);

    if (!diagnostics) return message;

    return `${diagnostics} ${message}`;

}

/**
 * Extract MSSQL/tedious diagnostic info.
 *
 * Tedious RequestError properties:
 * - number: SQL Server error code (e.g., 207, 2627, 8120)
 * - lineNumber: Line in the SQL batch where the error occurred
 * - procName: Stored procedure name (if inside one)
 * - class: Error severity (10=info, 11-16=user, 17+=system)
 * - state: Diagnostic state (varies by error)
 */
function extractMssqlDiagnostics(e: Record<string, unknown>): string | null {

    // Detect tedious errors by checking for 'number' (SQL error code)
    // combined with either 'lineNumber' or 'class' (severity)
    const hasNumber = typeof e['number'] === 'number';
    const hasLineNumber = typeof e['lineNumber'] === 'number';
    const hasClass = typeof e['class'] === 'number';

    if (!hasNumber && !hasLineNumber) return null;

    const parts: string[] = [];

    if (hasLineNumber && (e['lineNumber'] as number) > 0) {

        parts.push(`Line ${e['lineNumber']}`);

    }

    if (hasNumber) {

        parts.push(`Err ${e['number']}`);

    }

    if (typeof e['procName'] === 'string' && e['procName']) {

        parts.push(`in ${e['procName']}`);

    }

    if (hasClass && (e['class'] as number) > 16) {

        parts.push(`Severity ${e['class']}`);

    }

    if (typeof e['state'] === 'number' && (e['state'] as number) > 1) {

        parts.push(`State ${e['state']}`);

    }

    return parts.length > 0 ? `[${parts.join(', ')}]` : null;

}

/**
 * Extract PostgreSQL (pg) diagnostic info.
 *
 * pg DatabaseError properties:
 * - code: PostgreSQL error code (e.g., '42P01', '23505')
 * - severity: ERROR, WARNING, NOTICE, etc.
 * - where: PL/pgSQL stack trace
 * - routine: Internal PG function name
 */
function extractPgDiagnostics(e: Record<string, unknown>): string | null {

    if (typeof e['code'] !== 'string' || typeof e['severity'] !== 'string') return null;

    const parts: string[] = [`${e['severity']} ${e['code']}`];

    if (typeof e['where'] === 'string') {

        parts.push(String(e['where']).slice(0, 200));

    }

    return `[${parts.join(' - ')}]`;

}

/**
 * Extract MySQL (mysql2) diagnostic info.
 *
 * mysql2 error properties:
 * - errno: MySQL error number (e.g., 1054, 1062)
 * - sqlState: SQL state code (e.g., '42S22')
 */
function extractMysqlDiagnostics(e: Record<string, unknown>): string | null {

    if (typeof e['errno'] !== 'number') return null;

    const parts: string[] = [`Err ${e['errno']}`];

    if (typeof e['sqlState'] === 'string' && e['sqlState']) {

        parts.push(`State ${e['sqlState']}`);

    }

    return `[${parts.join(', ')}]`;

}
