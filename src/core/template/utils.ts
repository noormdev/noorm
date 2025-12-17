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
import v from 'voca'
import path from 'node:path'


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
    const ext = path.extname(filename)
    const base = path.basename(filename, ext)

    // Convert to camelCase
    return v.camelCase(base)
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

    return value.replace(/'/g, "''")
}


/**
 * SQL-escape and wrap in single quotes.
 *
 * Handles null values and various types appropriately.
 *
 * @param value - The value to quote
 * @returns The quoted SQL literal
 *
 * @example
 * ```typescript
 * sqlQuote("O'Brien")  // → "'O''Brien'"
 * sqlQuote(42)         // → "'42'"
 * sqlQuote(null)       // → "NULL"
 * sqlQuote(true)       // → "'true'"
 * ```
 */
export function sqlQuote(value: string | number | boolean | null): string {

    if (value === null) {

        return 'NULL'
    }

    return `'${sqlEscape(String(value))}'`
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

    return crypto.randomUUID()
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

    return new Date().toISOString()
}
