/**
 * Change scaffolding.
 *
 * File system operations for creating and modifying change directories.
 * Provides the building blocks for interactive change creation.
 *
 * WHY: Changes have a specific folder structure. The scaffold module
 * ensures consistent naming and structure when creating or modifying them.
 *
 * @example
 * ```typescript
 * import { createChange, addFile, reorderFiles } from './scaffold'
 *
 * // Create a new change
 * const change = await createChange('/project/changes', {
 *     description: 'add-email-verification',
 * })
 *
 * // Add a file
 * await addFile(change, 'change', {
 *     name: 'create-tokens-table',
 *     type: 'sql',
 * })
 * ```
 */
import path from 'node:path';
import { mkdir, writeFile, rename, unlink, rm, stat } from 'node:fs/promises';

import { attempt } from '@logosdx/utils';

import { observer } from '../observer.js';
import { parseSequence, parseDescription } from './parser.js';
import type {
    Change,
    ChangeFile,
    CreateChangeOptions,
    AddFileOptions,
} from './types.js';
import { ChangeValidationError } from './types.js';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Default template for new SQL files */
const SQL_TEMPLATE = `-- TODO: Add SQL statements here
`;

/** Default template for changelog */
const CHANGELOG_TEMPLATE = `# Changelog

## Description

TODO: Describe the purpose of this change.

## Changes

- TODO: List changes

## Impact

TODO: Describe any impact on existing data or functionality.
`;

// ─────────────────────────────────────────────────────────────
// Create Change
// ─────────────────────────────────────────────────────────────

/**
 * Create a new change directory.
 *
 * @param changesDir - Parent directory for changes
 * @param options - Creation options
 * @returns Parsed change (empty, ready for files)
 *
 * @example
 * ```typescript
 * const change = await createChange('/project/changes', {
 *     description: 'add-user-roles',
 *     date: new Date('2024-01-15'),
 * })
 *
 * console.log(change.name)  // '2024-01-15-add-user-roles'
 * ```
 */
export async function createChange(
    changesDir: string,
    options: CreateChangeOptions,
): Promise<Change> {

    // Generate name
    const date = options.date ?? new Date();
    const dateStr = formatDate(date);
    const slug = slugify(options.description);
    const name = `${dateStr}-${slug}`;

    const changeDir = path.join(changesDir, name);

    // Check if change already exists
    const [existingStats] = await attempt(() => stat(changeDir));

    if (existingStats) {

        throw new Error(`Change already exists: ${name}`);

    }

    // Create directory structure
    const [, mkdirErr] = await attempt(() => mkdir(changeDir, { recursive: true }));

    if (mkdirErr) {

        throw new Error(`Failed to create change directory: ${changeDir}`, {
            cause: mkdirErr,
        });

    }

    // Create change/ and revert/ folders
    const changePath = path.join(changeDir, 'change');
    const revertPath = path.join(changeDir, 'revert');

    await mkdir(changePath, { recursive: true });
    await mkdir(revertPath, { recursive: true });

    // Create changelog.md
    const changelogPath = path.join(changeDir, 'changelog.md');
    await writeFile(changelogPath, CHANGELOG_TEMPLATE, 'utf-8');

    // Emit event
    observer.emit('change:created', {
        name,
        path: changeDir,
    });

    // Return parsed change
    return {
        name,
        path: changeDir,
        date,
        description: slug,
        changeFiles: [],
        revertFiles: [],
        hasChangelog: true,
    };

}

// ─────────────────────────────────────────────────────────────
// Add File
// ─────────────────────────────────────────────────────────────

/**
 * Add a file to a change.
 *
 * @param change - Change to modify
 * @param folder - 'change' or 'revert'
 * @param options - File options
 * @returns Updated change
 *
 * @example
 * ```typescript
 * // Add a new SQL file
 * const updated = await addFile(change, 'change', {
 *     name: 'create-tokens-table',
 *     type: 'sql',
 * })
 *
 * // Add a manifest file
 * const updated = await addFile(change, 'change', {
 *     name: 'rerun-views',
 *     type: 'txt',
 *     paths: ['sql/views/active_users.sql'],
 * })
 * ```
 */
export async function addFile(
    change: Change,
    folder: 'change' | 'revert',
    options: AddFileOptions,
): Promise<Change> {

    const files = folder === 'change' ? change.changeFiles : change.revertFiles;

    // Determine next sequence number
    const maxSequence = getMaxSequence(files);
    const sequence = maxSequence + 1;

    // Generate filename
    const slug = slugify(options.name);
    const extension = options.type === 'txt' ? '.txt' : '.sql';
    const filename = `${padSequence(sequence)}_${slug}${extension}`;

    const folderPath = path.join(change.path, folder);
    const filePath = path.join(folderPath, filename);

    // Determine content
    let content: string;

    if (options.content) {

        content = options.content;

    }
    else if (options.type === 'txt' && options.paths) {

        content = options.paths.join('\n') + '\n';

    }
    else {

        content = SQL_TEMPLATE;

    }

    // Write file
    const [, writeErr] = await attempt(() => writeFile(filePath, content, 'utf-8'));

    if (writeErr) {

        throw new Error(`Failed to create file: ${filePath}`, { cause: writeErr });

    }

    // Create file object
    const file: ChangeFile = {
        filename,
        path: filePath,
        type: options.type,
    };

    if (options.type === 'txt' && options.paths) {

        file.resolvedPaths = options.paths;

    }

    // Update change
    const updatedFiles = [...files, file].sort((a, b) => a.filename.localeCompare(b.filename));

    if (folder === 'change') {

        return { ...change, changeFiles: updatedFiles };

    }

    return { ...change, revertFiles: updatedFiles };

}

// ─────────────────────────────────────────────────────────────
// Remove File
// ─────────────────────────────────────────────────────────────

/**
 * Remove a file from a change.
 *
 * @param change - Change to modify
 * @param folder - 'change' or 'revert'
 * @param filename - Filename to remove
 * @returns Updated change
 */
export async function removeFile(
    change: Change,
    folder: 'change' | 'revert',
    filename: string,
): Promise<Change> {

    const files = folder === 'change' ? change.changeFiles : change.revertFiles;

    // Find file
    const file = files.find((f) => f.filename === filename);

    if (!file) {

        throw new ChangeValidationError(change.name, `File not found: ${filename}`);

    }

    // Delete file
    const [, unlinkErr] = await attempt(() => unlink(file.path));

    if (unlinkErr) {

        throw new Error(`Failed to delete file: ${file.path}`, { cause: unlinkErr });

    }

    // Update change
    const updatedFiles = files.filter((f) => f.filename !== filename);

    if (folder === 'change') {

        return { ...change, changeFiles: updatedFiles };

    }

    return { ...change, revertFiles: updatedFiles };

}

// ─────────────────────────────────────────────────────────────
// Rename File
// ─────────────────────────────────────────────────────────────

/**
 * Rename a file in a change.
 *
 * @param change - Change to modify
 * @param folder - 'change' or 'revert'
 * @param oldFilename - Current filename
 * @param newDescription - New description part
 * @returns Updated change
 */
export async function renameFile(
    change: Change,
    folder: 'change' | 'revert',
    oldFilename: string,
    newDescription: string,
): Promise<Change> {

    const files = folder === 'change' ? change.changeFiles : change.revertFiles;

    // Find file
    const fileIndex = files.findIndex((f) => f.filename === oldFilename);

    if (fileIndex === -1) {

        throw new ChangeValidationError(change.name, `File not found: ${oldFilename}`);

    }

    const file = files[fileIndex];

    if (!file) {

        throw new ChangeValidationError(change.name, `File not found: ${oldFilename}`);

    }

    // Parse current filename
    const sequence = parseSequence(file.filename);
    const extension = getExtension(file.filename);

    if (sequence === null) {

        throw new ChangeValidationError(
            change.name,
            `Invalid filename format: ${oldFilename}`,
        );

    }

    // Generate new filename
    const slug = slugify(newDescription);
    const newFilename = `${padSequence(sequence)}_${slug}${extension}`;
    const newPath = path.join(path.dirname(file.path), newFilename);

    // Rename file
    const [, renameErr] = await attempt(() => rename(file.path, newPath));

    if (renameErr) {

        throw new Error(`Failed to rename file: ${file.path}`, { cause: renameErr });

    }

    // Update file object
    const updatedFile: ChangeFile = {
        ...file,
        filename: newFilename,
        path: newPath,
    };

    // Update change
    const updatedFiles = [...files];
    updatedFiles[fileIndex] = updatedFile;
    updatedFiles.sort((a, b) => a.filename.localeCompare(b.filename));

    if (folder === 'change') {

        return { ...change, changeFiles: updatedFiles };

    }

    return { ...change, revertFiles: updatedFiles };

}

// ─────────────────────────────────────────────────────────────
// Reorder Files
// ─────────────────────────────────────────────────────────────

/**
 * Reorder files in a change folder.
 *
 * @param change - Change to modify
 * @param folder - 'change' or 'revert'
 * @param newOrder - Array of filenames in desired order
 * @returns Updated change
 *
 * @example
 * ```typescript
 * // Reorder files
 * const updated = await reorderFiles(change, 'change', [
 *     '002_create-index.sql',  // Was second, now first
 *     '001_create-table.sql',  // Was first, now second
 * ])
 *
 * // Files are renumbered: 001_create-index.sql, 002_create-table.sql
 * ```
 */
export async function reorderFiles(
    change: Change,
    folder: 'change' | 'revert',
    newOrder: string[],
): Promise<Change> {

    const files = folder === 'change' ? change.changeFiles : change.revertFiles;

    // Validate new order contains all files
    const currentFilenames = new Set(files.map((f) => f.filename));
    const newOrderSet = new Set(newOrder);

    if (currentFilenames.size !== newOrderSet.size) {

        throw new ChangeValidationError(
            change.name,
            'New order must contain all existing files',
        );

    }

    for (const filename of newOrder) {

        if (!currentFilenames.has(filename)) {

            throw new ChangeValidationError(
                change.name,
                `Unknown file in new order: ${filename}`,
            );

        }

    }

    // Create file map
    const fileMap = new Map(files.map((f) => [f.filename, f]));

    // Rename files to new sequence
    const updatedFiles: ChangeFile[] = [];

    for (let i = 0; i < newOrder.length; i++) {

        const oldFilename = newOrder[i];

        if (!oldFilename) continue;

        const file = fileMap.get(oldFilename);

        if (!file) continue;

        const newSequence = i + 1;

        // Get description and extension
        const description = parseDescription(oldFilename);
        const extension = getExtension(oldFilename);

        // Generate new filename
        const newFilename = `${padSequence(newSequence)}_${description}${extension}`;
        const newPath = path.join(path.dirname(file.path), newFilename);

        // Rename if changed
        if (newFilename !== oldFilename) {

            // Use temp name to avoid conflicts
            const tempPath = path.join(path.dirname(file.path), `_temp_${i}${extension}`);

            const [, renameErr] = await attempt(() => rename(file.path, tempPath));

            if (renameErr) {

                throw new Error(`Failed to rename file: ${file.path}`, { cause: renameErr });

            }

            updatedFiles.push({
                ...file,
                filename: newFilename,
                path: newPath,
                _tempPath: tempPath, // Track temp path
            } as ChangeFile & { _tempPath: string });

        }
        else {

            updatedFiles.push(file);

        }

    }

    // Final rename from temp to actual
    for (const file of updatedFiles) {

        const tempPath = (file as ChangeFile & { _tempPath?: string })._tempPath;

        if (tempPath) {

            const [, renameErr] = await attempt(() => rename(tempPath, file.path));

            if (renameErr) {

                throw new Error(`Failed to finalize rename: ${file.path}`, { cause: renameErr });

            }

        }

    }

    // Clean up temp property
    const cleanFiles = updatedFiles.map((f) => {

        const { _tempPath, ...clean } = f as ChangeFile & { _tempPath?: string };

        return clean;

    });

    if (folder === 'change') {

        return { ...change, changeFiles: cleanFiles };

    }

    return { ...change, revertFiles: cleanFiles };

}

// ─────────────────────────────────────────────────────────────
// Delete Change
// ─────────────────────────────────────────────────────────────

/**
 * Delete a change directory from disk.
 *
 * @param change - Change to delete
 */
export async function deleteChange(change: Change): Promise<void> {

    const [, rmErr] = await attempt(() => rm(change.path, { recursive: true, force: true }));

    if (rmErr) {

        throw new Error(`Failed to delete change: ${change.path}`, { cause: rmErr });

    }

}

// ─────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Format date as YYYY-MM-DD.
 */
function formatDate(date: Date): string {

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;

}

/**
 * Convert text to URL-safe slug.
 */
function slugify(text: string): string {

    return text
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

}

/**
 * Pad sequence number to 3 digits.
 */
function padSequence(seq: number): string {

    return String(seq).padStart(3, '0');

}

/**
 * Get max sequence number from files.
 */
function getMaxSequence(files: ChangeFile[]): number {

    let max = 0;

    for (const file of files) {

        const seq = parseSequence(file.filename);

        if (seq !== null && seq > max) {

            max = seq;

        }

    }

    return max;

}

/**
 * Get file extension (including .sql.tmpl).
 */
function getExtension(filename: string): string {

    if (filename.endsWith('.sql.tmpl')) {

        return '.sql.tmpl';

    }

    if (filename.endsWith('.sql')) {

        return '.sql';

    }

    if (filename.endsWith('.txt')) {

        return '.txt';

    }

    return '';

}
