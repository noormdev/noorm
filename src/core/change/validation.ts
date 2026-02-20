/**
 * Change content validation.
 *
 * Validates that change files contain meaningful SQL content
 * before allowing execution. Prevents accidental execution of
 * empty or template-only changes.
 *
 * @example
 * ```typescript
 * const error = await validateChangeContent(change);
 * if (error) throw new Error(error);
 * ```
 */
import { readFile } from 'fs/promises';

import { attempt } from '@logosdx/utils';

import type { Change } from './types.js';

/** Default SQL template - files with only this content are considered empty */
const SQL_TEMPLATE = '-- TODO: Add SQL statements here\n';

/**
 * Check if a change has meaningful content in its files.
 *
 * Iterates over change files and verifies at least one has actual SQL.
 * Skips .txt manifest files (they reference other files) and unreadable files.
 * Returns null if valid, or an error message if files are empty/template-only.
 *
 * @example
 * ```typescript
 * const error = await validateChangeContent(change);
 * if (error) throw new Error(error);
 * ```
 */
export async function validateChangeContent(change: Change, includeName?: boolean): Promise<string | null> {

    if (change.changeFiles.length === 0) {

        return includeName
            ? `"${change.name}" has no files to execute`
            : 'Change has no files to execute';

    }

    let hasContent = false;

    for (const file of change.changeFiles) {

        // Skip .txt manifest files - they reference other files
        if (file.type === 'txt') {

            hasContent = true;

            continue;

        }

        const [content, err] = await attempt(() => readFile(file.path, 'utf-8'));

        if (err) {

            continue; // Skip files we can't read

        }

        const trimmed = content?.trim() ?? '';

        // Check if file has actual content (not empty, not just the template)
        if (trimmed && trimmed !== SQL_TEMPLATE.trim()) {

            hasContent = true;

            break;

        }

    }

    if (!hasContent) {

        return includeName
            ? `"${change.name}" has empty or template-only files`
            : 'Change files are empty or contain only template placeholders. Edit the SQL files before running.';

    }

    return null;

}
