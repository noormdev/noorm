/**
 * String transformation utilities using Voca.
 *
 * Provides consistent string transformations for converting filenames
 * to context property names.
 *
 * @example
 * ```typescript
 * import { toContextKey } from './utils'
 *
 * toContextKey('my-config.json5')   // → 'myConfig'
 * toContextKey('seed_data.yml')     // → 'seedData'
 * toContextKey('API_KEYS.json')     // → 'apiKeys'
 * ```
 */
import path from 'node:path';

import v from 'voca';

/**
 * Whether a resolved absolute path sits at or under a root directory.
 *
 * A bare `startsWith(root)` is a *string* test, not a path test: with a
 * root of `/srv/app`, the sibling `/srv/app-evil` passes it. Requiring the
 * separator makes containment path-segment aware, which is the only reading
 * that matches what "cannot escape the project root" claims. Shared by
 * `include()`'s guard and the `$helpers` tree walk so the two cannot drift.
 *
 * @example
 * ```typescript
 * isWithinRoot('/srv/app/sql/a.sql', '/srv/app')  // → true
 * isWithinRoot('/srv/app-evil/a.sql', '/srv/app') // → false
 * ```
 */
export function isWithinRoot(resolved: string, root: string): boolean {

    const normalizedRoot = root.endsWith(path.sep) ? root.slice(0, -1) : root;

    return resolved === normalizedRoot || resolved.startsWith(normalizedRoot + path.sep);

}

/**
 * Convert a filename to a camelCase context key.
 *
 * Strips the file extension and converts the base name to camelCase.
 * Handles kebab-case, snake_case, and SCREAMING_CASE.
 *
 * @param filename - The filename to convert (e.g., 'my-config.json5')
 * @returns The camelCase key (e.g., 'myConfig')
 *
 * @example
 * ```typescript
 * toContextKey('my-config.json5')   // → 'myConfig'
 * toContextKey('seed_data.yml')     // → 'seedData'
 * toContextKey('API_KEYS.json')     // → 'apiKeys'
 * toContextKey('users.csv')         // → 'users'
 * ```
 */
export function toContextKey(filename: string): string {

    // Get basename without extension
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);

    // Convert to camelCase
    return v.camelCase(base);

}

/**
 * SQL-escape a string value.
 *
 * Escapes single quotes by doubling them, which is the standard
 * SQL escape sequence for string literals.
 *
 * @param value - The string to escape
 * @returns The escaped string (without surrounding quotes)
 *
 * @example
 * ```typescript
 * sqlEscape("O'Brien")  // → "O''Brien"
 * sqlEscape("normal")   // → "normal"
 * ```
 */
export function sqlEscape(value: string): string {

    return value.replace(/'/g, "''");

}

/**
 * Error when a value that must be rendered into SQL is `undefined`.
 *
 * `undefined` reaching `sqlQuote` is always a bug upstream — a missing
 * secret, an unresolved config key, a typo'd lookup — never a value a
 * template author meant to write. `null` remains a legitimate SQL value
 * and still quotes to `NULL`; stringifying `undefined` is how a missing
 * secret shipped as the literal password `undefined` (noorm#50).
 *
 * @example
 * ```typescript
 * sqlQuote(null)       // → 'NULL'
 * sqlQuote(undefined)  // throws UndefinedSqlValueError
 * ```
 */
export class UndefinedSqlValueError extends Error {

    override readonly name = 'UndefinedSqlValueError' as const;

    constructor() {

        super('sqlQuote() received undefined — use null for an explicit SQL NULL, or resolve the missing value before rendering');

    }

}

/**
 * SQL-escape and wrap in single quotes.
 *
 * Handles null values and various types appropriately. Throws on
 * `undefined` rather than stringifying it — see `UndefinedSqlValueError`.
 *
 * @param value - The value to quote
 * @returns The quoted SQL literal
 * @throws UndefinedSqlValueError if value is undefined
 *
 * @example
 * ```typescript
 * sqlQuote("O'Brien")  // → "'O''Brien'"
 * sqlQuote(42)         // → "'42'"
 * sqlQuote(null)       // → "NULL"
 * sqlQuote(true)       // → "'true'"
 * ```
 */
export function sqlQuote(value: string | number | boolean | null | undefined): string {

    if (value === undefined) {

        throw new UndefinedSqlValueError();

    }

    if (value === null) {

        return 'NULL';

    }

    return `'${sqlEscape(String(value))}'`;

}

/**
 * Generate a UUID v4.
 *
 * Uses crypto.randomUUID() for secure random generation.
 *
 * @returns A UUID v4 string
 *
 * @example
 * ```typescript
 * generateUuid()  // → "550e8400-e29b-41d4-a716-446655440000"
 * ```
 */
export function generateUuid(): string {

    return crypto.randomUUID();

}

/**
 * Get current ISO timestamp.
 *
 * @returns ISO 8601 timestamp string
 *
 * @example
 * ```typescript
 * isoNow()  // → "2024-01-15T10:30:00.000Z"
 * ```
 */
export function isoNow(): string {

    return new Date().toISOString();

}
