/**
 * CSV data loader.
 *
 * Loads .csv files using csv-parse with headers.
 * Returns an array of objects where keys are column headers.
 *
 * @example
 * ```typescript
 * const data = await loadCsv('/path/to/users.csv')
 * // → [{ name: 'Alice', email: 'alice@example.com' }, ...]
 * ```
 */
import { readFile } from 'node:fs/promises'

import { parse } from 'csv-parse/sync'


/**
 * Load and parse a CSV file.
 *
 * @param filepath - Absolute path to the CSV file
 * @returns Array of row objects with header keys
 * @throws If file cannot be read or parsed
 */
export async function loadCsv(filepath: string): Promise<Record<string, string>[]> {

    const content = await readFile(filepath, 'utf-8')

    return parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
    })
}
