/**
 * Change parser.
 *
 * Reads changes from disk, resolves manifest files, and validates
 * change structure. Provides the foundation for all change operations.
 *
 * WHY: Changes are stored as folder structures on disk. The parser
 * transforms these into typed objects for the executor and manager.
 *
 * @example
 * ```typescript
 * import { parseChange, discoverChanges } from './parser'
 *
 * // Load a single change
 * const change = await parseChange('/path/to/2024-01-15-add-users')
 *
 * // Discover all changes in a directory
 * const all = await discoverChanges('/project/changes')
 * ```
 */
import path from 'node:path';
import { readdir, readFile, stat, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

import { attempt } from '@logosdx/utils';

import { observer } from '../observer.js';
import type { Change, ChangeFile, ChangeFileType, ChangeListItem, ChangeStatus } from './types.js';
import {
    ChangeValidationError,
    ChangeNotFoundError,
    ManifestReferenceError,
} from './types.js';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Valid SQL file extensions */
const SQL_EXTENSIONS = ['.sql', '.sql.tmpl'];

/** Valid manifest extension */
const MANIFEST_EXTENSION = '.txt';

/** Date prefix regex: YYYY-MM-DD */
const DATE_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

/** File sequence regex: 001_description */
const SEQUENCE_REGEX = /^(\d{3})_(.+)$/;

// ─────────────────────────────────────────────────────────────
// Parse Single Change
// ─────────────────────────────────────────────────────────────

/**
 * Parse a change from a folder path.
 *
 * @param folderPath - Absolute path to change folder
 * @param sqlDir - Schema directory for resolving .txt references
 * @returns Parsed change
 * @throws ChangeNotFoundError if folder doesn't exist
 * @throws ChangeValidationError if structure is invalid
 *
 * @example
 * ```typescript
 * const change = await parseChange(
 *     '/project/changes/2024-01-15-add-users',
 *     '/project/sql'
 * )
 *
 * console.log(change.name)  // '2024-01-15-add-users'
 * console.log(change.changeFiles)  // [{ filename: '001_create-table.sql', ... }]
 * ```
 */
export async function parseChange(folderPath: string, sqlDir?: string): Promise<Change> {

    // Check folder exists
    const [folderStat, statErr] = await attempt(() => stat(folderPath));

    if (statErr || !folderStat?.isDirectory()) {

        throw new ChangeNotFoundError(path.basename(folderPath));

    }

    // Parse name
    const name = path.basename(folderPath);
    const { date, description } = parseName(name);

    // Scan change/ folder
    const changePath = path.join(folderPath, 'change');
    const [changeFiles, changeErr] = await attempt(() => scanFolder(changePath, sqlDir));

    if (changeErr && !isNotFoundError(changeErr)) {

        throw changeErr;

    }

    // Scan revert/ folder
    const revertPath = path.join(folderPath, 'revert');
    const [revertFiles, revertErr] = await attempt(() => scanFolder(revertPath, sqlDir));

    if (revertErr && !isNotFoundError(revertErr)) {

        throw revertErr;

    }

    // Check for changelog.md
    const changelogPath = path.join(folderPath, 'changelog.md');
    const hasChangelog = await fileExists(changelogPath);

    // Validate: must have at least change/ or revert/
    if ((!changeFiles || changeFiles.length === 0) && (!revertFiles || revertFiles.length === 0)) {

        throw new ChangeValidationError(
            name,
            'Must have at least change/ or revert/ folder with files',
        );

    }

    return {
        name,
        path: folderPath,
        date,
        description,
        changeFiles: changeFiles ?? [],
        revertFiles: revertFiles ?? [],
        hasChangelog,
    };

}

// ─────────────────────────────────────────────────────────────
// Discover All Changes
// ─────────────────────────────────────────────────────────────

/** A change folder that exists on disk but could not be parsed. */
export interface ChangeParseFailure {
    name: string;
    path: string;
    message: string;
}

/**
 * The list entry for a folder that could not be parsed: its recorded status
 * when it has history, otherwise `failed` with the parse error, which is what
 * marks it as outstanding work.
 *
 * @example
 * const item = failureListItem(failure, statuses.get(failure.name))
 */
export function failureListItem(failure: ChangeParseFailure, status?: ChangeStatus): ChangeListItem {

    const { date, description } = parseName(failure.name);

    return {
        name: failure.name,
        path: failure.path,
        date,
        description,
        status: status?.status ?? 'failed',
        appliedAt: status?.appliedAt ?? null,
        appliedBy: status?.appliedBy ?? null,
        revertedAt: status?.revertedAt ?? null,
        errorMessage: status ? status.errorMessage : failure.message,
        appliedHistoryId: status?.appliedHistoryId ?? null,
        isNew: !status,
        orphaned: false,
    };

}

/**
 * Discover all changes in a directory.
 *
 * Folders that fail to parse are dropped here. Callers that must not lose
 * track of them (a change that never ran would silently never run) use
 * `scanChanges`.
 *
 * @param changesDir - Directory containing change folders
 * @param sqlDir - Schema directory for resolving .txt references
 * @returns Array of parsed changes, sorted by name
 *
 * @example
 * ```typescript
 * const changes = await discoverChanges('/project/changes', '/project/sql')
 *
 * for (const cs of changes) {
 *     console.log(cs.name, cs.date)
 * }
 * ```
 */
export async function discoverChanges(
    changesDir: string,
    sqlDir?: string,
): Promise<Change[]> {

    const { changes } = await scanChanges(changesDir, sqlDir);

    return changes;

}

/**
 * Discover all changes in a directory, and report the folders that could not
 * be parsed instead of dropping them.
 *
 * @example
 * const { changes, failures } = await scanChanges('/project/db/changes', '/project/db/sql')
 */
export async function scanChanges(
    changesDir: string,
    sqlDir?: string,
): Promise<{ changes: Change[]; failures: ChangeParseFailure[] }> {

    // Check directory exists
    const [exists] = await attempt(() => stat(changesDir));

    if (!exists) {

        return { changes: [], failures: [] };

    }

    // Read directory entries
    const [entries, readErr] = await attempt(() => readdir(changesDir, { withFileTypes: true }));

    if (readErr) {

        observer.emit('error', {
            source: 'change',
            error: readErr,
            context: { changesDir, operation: 'discover' },
        });

        return { changes: [], failures: [] };

    }

    // Filter to directories only
    const folders = entries.filter((e) => e.isDirectory());

    // Parse each change
    const changes: Change[] = [];
    const failures: ChangeParseFailure[] = [];

    for (const folder of folders) {

        const folderPath = path.join(changesDir, folder.name);

        if (!(await looksLikeChange(folderPath))) continue;

        const [change, parseErr] = await attempt(() => parseChange(folderPath, sqlDir));

        if (parseErr) {

            // Log error but continue with other changes
            observer.emit('error', {
                source: 'change',
                error: parseErr,
                context: { folder: folder.name, operation: 'parse' },
            });

            failures.push({ name: folder.name, path: folderPath, message: parseErr.message });

            continue;

        }

        changes.push(change);

    }

    // Sort by name (date prefix ensures chronological order)
    return {
        changes: changes.sort((a, b) => a.name.localeCompare(b.name)),
        failures,
    };

}

// ─────────────────────────────────────────────────────────────
// Resolve Manifest Files
// ─────────────────────────────────────────────────────────────

/**
 * Resolve a .txt manifest file to actual SQL paths.
 *
 * Returns paths in the order the manifest lists them: the file is an
 * authored execution order, so it is the one ordering signal a change
 * gives the user.
 *
 * @param manifestPath - Path to the .txt manifest file
 * @param sqlDir - Schema directory for resolving relative paths
 * @returns Absolute paths to SQL files, in manifest line order
 * @throws ManifestReferenceError if any referenced file is missing
 *
 * @example
 * ```typescript
 * // Lines are relative to the schema directory, not the project root:
 * // tables/users.sql
 * // views/active_users.sql
 *
 * const paths = await resolveManifest(
 *     '/project/db/changes/.../change/001_refs.txt',
 *     '/project/db/sql'
 * )
 * // => ['/project/db/sql/tables/users.sql', '/project/db/sql/views/active_users.sql']
 * ```
 */
export async function resolveManifest(manifestPath: string, sqlDir: string): Promise<string[]> {

    // Read manifest content
    const [content, readErr] = await attempt(() => readFile(manifestPath, 'utf-8'));

    if (readErr) {

        throw new Error(`Failed to read manifest: ${manifestPath}`, { cause: readErr });

    }

    // Parse lines (skip empty and comments)
    const lines = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));

    if (lines.length === 0) {

        throw new ChangeValidationError(
            path.basename(path.dirname(path.dirname(manifestPath))),
            `Empty manifest file: ${path.basename(manifestPath)}`,
        );

    }

    // Resolve each path
    const resolvedPaths: string[] = [];

    for (const relativePath of lines) {

        const absolutePath = path.join(sqlDir, relativePath);

        // Validate file exists
        const [, accessErr] = await attempt(() => access(absolutePath, fsConstants.R_OK));

        if (!accessErr) {

            resolvedPaths.push(absolutePath);

        }
        else {

            throw new ManifestReferenceError(manifestPath, relativePath);

        }

    }

    // Line order is the author's execution order — a table before the view
    // that selects from it. Sorting here reordered across directories and
    // silently broke dependency order the manifest existed to express.
    return resolvedPaths;

}

// ─────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────

/**
 * Validate a change structure.
 *
 * @param change - Change to validate
 * @throws ChangeValidationError if invalid
 */
export function validateChange(change: Change): void {

    // Check for duplicate filenames in change/
    const changeFilenames = change.changeFiles.map((f) => f.filename);
    const changeDuplicates = findDuplicates(changeFilenames);

    if (changeDuplicates.length > 0) {

        throw new ChangeValidationError(
            change.name,
            `Duplicate files in change/: ${changeDuplicates.join(', ')}`,
        );

    }

    // Check for duplicate filenames in revert/
    const revertFilenames = change.revertFiles.map((f) => f.filename);
    const revertDuplicates = findDuplicates(revertFilenames);

    if (revertDuplicates.length > 0) {

        throw new ChangeValidationError(
            change.name,
            `Duplicate files in revert/: ${revertDuplicates.join(', ')}`,
        );

    }

}

/**
 * Check if a change has revert files.
 */
export function hasRevertFiles(change: Change): boolean {

    return change.revertFiles.length > 0;

}

// ─────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Parse change name into date and description.
 */
function parseName(name: string): { date: Date | null; description: string } {

    const match = name.match(DATE_PREFIX_REGEX);

    if (match && match[1] && match[2]) {

        const dateStr = match[1];
        const description = match[2];
        const date = new Date(dateStr);

        // Validate date is valid
        if (!isNaN(date.getTime())) {

            return { date, description };

        }

    }

    // No date prefix - use entire name as description
    return { date: null, description: name };

}

/**
 * A folder with neither `change/` nor `revert/` is not a change attempt:
 * shared `$.include()` fragments and archives live beside real changes.
 */
async function looksLikeChange(folderPath: string): Promise<boolean> {

    for (const subfolder of ['change', 'revert']) {

        const [entry] = await attempt(() => stat(path.join(folderPath, subfolder)));

        if (entry?.isDirectory()) return true;

    }

    return false;

}

/**
 * Scan a folder for SQL and manifest files.
 */
async function scanFolder(folderPath: string, sqlDir?: string): Promise<ChangeFile[]> {

    // Read directory
    const [entries, err] = await attempt(() => readdir(folderPath, { withFileTypes: true }));

    if (err) {

        throw err;

    }

    const files: ChangeFile[] = [];

    for (const entry of entries) {

        if (!entry.isFile()) continue;

        const filename = entry.name;
        const filePath = path.join(folderPath, filename);

        // Determine file type
        const type = getFileType(filename);

        if (!type) continue;

        const file: ChangeFile = {
            filename,
            path: filePath,
            type,
        };

        // Resolve manifest references
        if (type === 'txt' && sqlDir) {

            const [resolvedPaths, resolveErr] = await attempt(() =>
                resolveManifest(filePath, sqlDir),
            );

            if (resolveErr) {

                throw resolveErr;

            }

            file.resolvedPaths = resolvedPaths;

        }

        files.push(file);

    }

    // Sort by filename for deterministic order
    return files.sort((a, b) => a.filename.localeCompare(b.filename));

}

/**
 * Determine file type from filename.
 */
function getFileType(filename: string): ChangeFileType | null {

    if (filename.endsWith(MANIFEST_EXTENSION)) {

        return 'txt';

    }

    for (const ext of SQL_EXTENSIONS) {

        if (filename.endsWith(ext)) {

            return 'sql';

        }

    }

    return null;

}

/**
 * Check if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {

    const [, err] = await attempt(() => access(filePath, fsConstants.R_OK));

    return err === null;

}

/**
 * Check if error is a "not found" error.
 */
function isNotFoundError(err: Error): boolean {

    return (err as NodeJS.ErrnoException).code === 'ENOENT';

}

/**
 * Find duplicate items in an array.
 */
function findDuplicates(items: string[]): string[] {

    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const item of items) {

        if (seen.has(item)) {

            duplicates.add(item);

        }

        seen.add(item);

    }

    return Array.from(duplicates);

}

/**
 * Parse sequence number from filename.
 *
 * @example
 * ```typescript
 * parseSequence('001_create-table.sql')  // => 1
 * parseSequence('invalid.sql')           // => null
 * ```
 */
export function parseSequence(filename: string): number | null {

    const match = filename.match(SEQUENCE_REGEX);

    if (match && match[1]) {

        return parseInt(match[1], 10);

    }

    return null;

}

/**
 * Extract description from filename.
 *
 * @example
 * ```typescript
 * parseDescription('001_create-users-table.sql')  // => 'create-users-table'
 * ```
 */
export function parseDescription(filename: string): string {

    // Remove extension
    let name = filename;

    if (name.endsWith('.sql.tmpl')) {

        name = name.slice(0, -9);

    }
    else if (name.endsWith('.sql')) {

        name = name.slice(0, -4);

    }
    else if (name.endsWith('.txt')) {

        name = name.slice(0, -4);

    }

    // Remove sequence prefix
    const match = name.match(SEQUENCE_REGEX);

    if (match && match[2]) {

        return match[2];

    }

    return name;

}
