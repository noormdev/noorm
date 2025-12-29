/**
 * SQL file loader.
 *
 * Loads .sql files as raw text strings.
 * Used for including SQL fragments in templates.
 *
 * @example
 * ```typescript
 * const sql = await loadSql('/path/to/fragment.sql')
 * ```
 */
import { readFile } from 'node:fs/promises';

/**
 * Load a SQL file as text.
 *
 * @param filepath - Absolute path to the SQL file
 * @returns The SQL file content as a string
 * @throws If file cannot be read
 */
export async function loadSql(filepath: string): Promise<string> {

    return readFile(filepath, 'utf-8');

}
