/**
 * YAML data loader.
 *
 * Loads .yaml and .yml files using the yaml parser.
 *
 * @example
 * ```typescript
 * const data = await loadYaml('/path/to/config.yml')
 * ```
 */
import { readFile } from 'node:fs/promises'

import { parse } from 'yaml'


/**
 * Load and parse a YAML file.
 *
 * @param filepath - Absolute path to the YAML file
 * @returns Parsed YAML data
 * @throws If file cannot be read or parsed
 */
export async function loadYaml(filepath: string): Promise<unknown> {

    const content = await readFile(filepath, 'utf-8')
    return parse(content)
}
