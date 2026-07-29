/**
 * Export path resolution utilities.
 *
 * Shared logic for CLI and TUI export path handling:
 * - Single table: use path as file, append extension if missing
 * - Multiple tables: use path as directory, generate filenames
 */
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';

/**
 * Determines the export file extension based on compression/encryption flags.
 *
 * Priority: passphrase → .dtzx, compress → .dtz, else → .dt
 *
 * @example
 * resolveExportExtension(false) // '.dt'
 * resolveExportExtension(true) // '.dtz'
 * resolveExportExtension(false, 'secret') // '.dtzx'
 */
export function resolveExportExtension(compress: boolean, passphrase?: string): string {

    if (passphrase) return '.dtzx';
    if (compress) return '.dtz';

    return '.dt';

}

/**
 * Resolves the full export path for a table.
 *
 * For single-table exports, uses the path as-is (appends extension if missing).
 * For multi-table exports, treats the path as a directory and generates filenames.
 *
 * @example
 * // Single table - uses path directly
 * resolveExportPath({ exportPath: './backup.dt', tableName: 'users', tableCount: 1, ext: '.dt' })
 * // → './backup.dt'
 *
 * // Single table - appends extension
 * resolveExportPath({ exportPath: './backup', tableName: 'users', tableCount: 1, ext: '.dtz' })
 * // → './backup.dtz'
 *
 * // Multi-table - generates filename in directory
 * resolveExportPath({ exportPath: './backup/', tableName: 'users', tableCount: 3, ext: '.dt' })
 * // → './backup/users.dt'
 */
export function resolveExportPath(opts: {
    exportPath: string;
    tableName: string;
    tableCount: number;
    ext: string;
}): string {

    const { exportPath, tableName, tableCount, ext } = opts;

    if (tableCount === 1) {

        // Single table: use path as-is, append ext if missing
        const hasExt = /\.(dt|dtz|dtzx)$/i.test(exportPath);

        return hasExt ? exportPath : `${exportPath}${ext}`;

    }

    // Multi-table: treat as directory, generate filename
    return join(exportPath, `${tableName}${ext}`);

}

/**
 * Resolve which tables an export should write.
 *
 * `--tables` is documented as "(default: all)". Omitting it resolved to an
 * empty list, so the export wrote nothing, reported success and exited 0 — a
 * silent empty backup. An explicit but empty selection is an error rather
 * than a no-op for the same reason.
 *
 * @example
 * ```typescript
 * const tables = await resolveExportTables(args.tables, () => ctx.noorm.db.listTables());
 * ```
 */
export async function resolveExportTables(
    tables: string[] | undefined,
    listTables: () => Promise<{ name: string }[]>,
): Promise<string[]> {

    const resolved = tables ?? (await listTables()).map((t) => t.name);

    if (resolved.length === 0) {

        throw new Error(
            tables
                ? 'No tables selected for export — --tables was empty'
                : 'No tables found to export',
        );

    }

    return resolved;

}

/**
 * Ensures the export directory exists for multi-table exports.
 *
 * For single-table exports, ensures the parent directory exists.
 * For multi-table exports, ensures the directory itself exists.
 *
 * @example
 * ensureExportDirectory('./backup/users.dt', 1) // ensures ./backup/ exists
 * ensureExportDirectory('./backup/', 3) // ensures ./backup/ exists
 */
export function ensureExportDirectory(exportPath: string, tableCount: number): void {

    if (tableCount === 1) {

        // Single table: ensure parent directory exists
        const dir = dirname(exportPath);

        if (dir && dir !== '.') {

            mkdirSync(dir, { recursive: true });

        }

    }
    else {

        // Multi-table: ensure directory exists
        mkdirSync(exportPath, { recursive: true });

    }

}
