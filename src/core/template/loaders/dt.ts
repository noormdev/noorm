/**
 * .dt file loader for template seed data.
 *
 * Loads .dt and .dtz files as arrays of row objects.
 * Does NOT support .dtzx — no way to provide a decryption
 * key in the template context.
 *
 * @example
 * ```typescript
 * import { loadDt } from './dt.js';
 *
 * const rows = await loadDt('/path/to/seed.dt');
 * // [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]
 * ```
 */
import { DtReader } from '../../dt/reader.js';

/**
 * Load a .dt or .dtz file as an array of row objects.
 *
 * Reads the schema to get column names, then maps each row's
 * positional values to named fields.
 *
 * @param filepath - Path to .dt or .dtz file
 * @returns Array of row objects with column names as keys
 * @throws If the file cannot be read or parsed
 *
 * @example
 * ```typescript
 * // Given a .dt file with columns [id, name, active]:
 * const data = await loadDt('./seeds/users.dt');
 * // [{ id: 1, name: 'Alice', active: true }, ...]
 * ```
 */
export async function loadDt(filepath: string): Promise<Record<string, unknown>[]> {

    const reader = new DtReader({ filepath });

    await reader.open();

    const schema = reader.schema;

    if (!schema) {

        throw new Error(`Failed to read .dt schema from: ${filepath}`);

    }

    const columnNames = schema.columns.map((c) => c.name);
    const rows: Record<string, unknown>[] = [];

    for await (const values of reader.rows()) {

        const row: Record<string, unknown> = {};

        for (let i = 0; i < columnNames.length; i++) {

            row[columnNames[i]!] = values[i] ?? null;

        }

        rows.push(row);

    }

    reader.close();

    return rows;

}
