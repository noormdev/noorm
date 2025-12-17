/**
 * JSON5 data loader.
 *
 * Loads .json and .json5 files using the JSON5 parser, which supports:
 * - Comments (single-line and block)
 * - Trailing commas
 * - Unquoted keys
 * - Single-quoted strings
 * - Multi-line strings
 *
 * @example
 * ```typescript
 * const data = await loadJson5('/path/to/config.json5')
 * ```
 */
import { readFile } from 'node:fs/promises'

import JSON5 from 'json5'


/**
 * Load and parse a JSON5 file.
 *
 * @param filepath - Absolute path to the JSON5 file
 * @returns Parsed JSON5 data
 * @throws If file cannot be read or parsed
 */
export async function loadJson5(filepath: string): Promise<unknown> {

    const content = await readFile(filepath, 'utf-8')
    return JSON5.parse(content)
}
