/**
 * Changeset parser.
 *
 * Reads changesets from disk, resolves manifest files, and validates
 * changeset structure. Provides the foundation for all changeset operations.
 *
 * WHY: Changesets are stored as folder structures on disk. The parser
 * transforms these into typed objects for the executor and manager.
 *
 * @example
 * ```typescript
 * import { parseChangeset, discoverChangesets } from './parser'
 *
 * // Load a single changeset
 * const changeset = await parseChangeset('/path/to/2024-01-15-add-users')
 *
 * // Discover all changesets in a directory
 * const all = await discoverChangesets('/project/changesets')
 * ```
 */
import path from 'node:path'
import { readdir, readFile, stat, access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'

import { attempt } from '@logosdx/utils'

import { observer } from '../observer.js'
import type {
    Changeset,
    ChangesetFile,
    ChangesetFileType,
} from './types.js'
import {
    ChangesetValidationError,
    ChangesetNotFoundError,
    ManifestReferenceError,
} from './types.js'


// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Valid SQL file extensions */
const SQL_EXTENSIONS = ['.sql', '.sql.tmpl']

/** Valid manifest extension */
const MANIFEST_EXTENSION = '.txt'

/** Date prefix regex: YYYY-MM-DD */
const DATE_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})-(.+)$/

/** File sequence regex: 001_description */
const SEQUENCE_REGEX = /^(\d{3})_(.+)$/


// ─────────────────────────────────────────────────────────────
// Parse Single Changeset
// ─────────────────────────────────────────────────────────────

/**
 * Parse a changeset from a folder path.
 *
 * @param folderPath - Absolute path to changeset folder
 * @param schemaDir - Schema directory for resolving .txt references
 * @returns Parsed changeset
 * @throws ChangesetNotFoundError if folder doesn't exist
 * @throws ChangesetValidationError if structure is invalid
 *
 * @example
 * ```typescript
 * const changeset = await parseChangeset(
 *     '/project/changesets/2024-01-15-add-users',
 *     '/project/sql'
 * )
 *
 * console.log(changeset.name)  // '2024-01-15-add-users'
 * console.log(changeset.changeFiles)  // [{ filename: '001_create-table.sql', ... }]
 * ```
 */
export async function parseChangeset(
    folderPath: string,
    schemaDir?: string,
): Promise<Changeset> {

    // Check folder exists
    const [folderStat, statErr] = await attempt(() => stat(folderPath))

    if (statErr || !folderStat?.isDirectory()) {

        throw new ChangesetNotFoundError(path.basename(folderPath))
    }

    // Parse name
    const name = path.basename(folderPath)
    const { date, description } = parseName(name)

    // Scan change/ folder
    const changePath = path.join(folderPath, 'change')
    const [changeFiles, changeErr] = await attempt(() =>
        scanFolder(changePath, schemaDir)
    )

    if (changeErr && !isNotFoundError(changeErr)) {

        throw changeErr
    }

    // Scan revert/ folder
    const revertPath = path.join(folderPath, 'revert')
    const [revertFiles, revertErr] = await attempt(() =>
        scanFolder(revertPath, schemaDir)
    )

    if (revertErr && !isNotFoundError(revertErr)) {

        throw revertErr
    }

    // Check for changelog.md
    const changelogPath = path.join(folderPath, 'changelog.md')
    const hasChangelog = await fileExists(changelogPath)

    // Validate: must have at least change/ or revert/
    if ((!changeFiles || changeFiles.length === 0) && (!revertFiles || revertFiles.length === 0)) {

        throw new ChangesetValidationError(
            name,
            'Must have at least change/ or revert/ folder with files'
        )
    }

    return {
        name,
        path: folderPath,
        date,
        description,
        changeFiles: changeFiles ?? [],
        revertFiles: revertFiles ?? [],
        hasChangelog,
    }
}


// ─────────────────────────────────────────────────────────────
// Discover All Changesets
// ─────────────────────────────────────────────────────────────

/**
 * Discover all changesets in a directory.
 *
 * @param changesetsDir - Directory containing changeset folders
 * @param schemaDir - Schema directory for resolving .txt references
 * @returns Array of parsed changesets, sorted by name
 *
 * @example
 * ```typescript
 * const changesets = await discoverChangesets('/project/changesets', '/project/sql')
 *
 * for (const cs of changesets) {
 *     console.log(cs.name, cs.date)
 * }
 * ```
 */
export async function discoverChangesets(
    changesetsDir: string,
    schemaDir?: string,
): Promise<Changeset[]> {

    // Check directory exists
    const [exists] = await attempt(() => stat(changesetsDir))

    if (!exists) {

        return []
    }

    // Read directory entries
    const [entries, readErr] = await attempt(() =>
        readdir(changesetsDir, { withFileTypes: true })
    )

    if (readErr) {

        observer.emit('error', {
            source: 'changeset',
            error: readErr,
            context: { changesetsDir, operation: 'discover' },
        })

        return []
    }

    // Filter to directories only
    const folders = entries.filter(e => e.isDirectory())

    // Parse each changeset
    const changesets: Changeset[] = []

    for (const folder of folders) {

        const folderPath = path.join(changesetsDir, folder.name)

        const [changeset, parseErr] = await attempt(() =>
            parseChangeset(folderPath, schemaDir)
        )

        if (parseErr) {

            // Log error but continue with other changesets
            observer.emit('error', {
                source: 'changeset',
                error: parseErr,
                context: { folder: folder.name, operation: 'parse' },
            })

            continue
        }

        changesets.push(changeset)
    }

    // Sort by name (date prefix ensures chronological order)
    return changesets.sort((a, b) => a.name.localeCompare(b.name))
}


// ─────────────────────────────────────────────────────────────
// Resolve Manifest Files
// ─────────────────────────────────────────────────────────────

/**
 * Resolve a .txt manifest file to actual SQL paths.
 *
 * @param manifestPath - Path to the .txt manifest file
 * @param schemaDir - Schema directory for resolving relative paths
 * @returns Array of absolute paths to SQL files
 * @throws ManifestReferenceError if any referenced file is missing
 *
 * @example
 * ```typescript
 * // Manifest contains:
 * // schema/tables/users.sql
 * // schema/views/active_users.sql
 *
 * const paths = await resolveManifest(
 *     '/project/changesets/.../change/001_refs.txt',
 *     '/project/sql'
 * )
 * // => ['/project/sql/schema/tables/users.sql', '/project/sql/schema/views/active_users.sql']
 * ```
 */
export async function resolveManifest(
    manifestPath: string,
    schemaDir: string,
): Promise<string[]> {

    // Read manifest content
    const [content, readErr] = await attempt(() => readFile(manifestPath, 'utf-8'))

    if (readErr) {

        throw new Error(`Failed to read manifest: ${manifestPath}`, { cause: readErr })
    }

    // Parse lines (skip empty and comments)
    const lines = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))

    if (lines.length === 0) {

        throw new ChangesetValidationError(
            path.basename(path.dirname(path.dirname(manifestPath))),
            `Empty manifest file: ${path.basename(manifestPath)}`
        )
    }

    // Resolve each path
    const resolvedPaths: string[] = []

    for (const relativePath of lines) {

        const absolutePath = path.join(schemaDir, relativePath)

        // Validate file exists
        const [exists] = await attempt(() => access(absolutePath, fsConstants.R_OK))

        if (exists === undefined) {

            resolvedPaths.push(absolutePath)
        }
        else {

            throw new ManifestReferenceError(manifestPath, relativePath)
        }
    }

    // Sort alphabetically (as per plan: files executed in sorted order)
    return resolvedPaths.sort()
}


// ─────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────

/**
 * Validate a changeset structure.
 *
 * @param changeset - Changeset to validate
 * @throws ChangesetValidationError if invalid
 */
export function validateChangeset(changeset: Changeset): void {

    // Check for duplicate filenames in change/
    const changeFilenames = changeset.changeFiles.map(f => f.filename)
    const changeDuplicates = findDuplicates(changeFilenames)

    if (changeDuplicates.length > 0) {

        throw new ChangesetValidationError(
            changeset.name,
            `Duplicate files in change/: ${changeDuplicates.join(', ')}`
        )
    }

    // Check for duplicate filenames in revert/
    const revertFilenames = changeset.revertFiles.map(f => f.filename)
    const revertDuplicates = findDuplicates(revertFilenames)

    if (revertDuplicates.length > 0) {

        throw new ChangesetValidationError(
            changeset.name,
            `Duplicate files in revert/: ${revertDuplicates.join(', ')}`
        )
    }
}


/**
 * Check if a changeset has revert files.
 */
export function hasRevertFiles(changeset: Changeset): boolean {

    return changeset.revertFiles.length > 0
}


// ─────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Parse changeset name into date and description.
 */
function parseName(name: string): { date: Date | null; description: string } {

    const match = name.match(DATE_PREFIX_REGEX)

    if (match && match[1] && match[2]) {

        const dateStr = match[1]
        const description = match[2]
        const date = new Date(dateStr)

        // Validate date is valid
        if (!isNaN(date.getTime())) {

            return { date, description }
        }
    }

    // No date prefix - use entire name as description
    return { date: null, description: name }
}


/**
 * Scan a folder for SQL and manifest files.
 */
async function scanFolder(
    folderPath: string,
    schemaDir?: string,
): Promise<ChangesetFile[]> {

    // Read directory
    const [entries, err] = await attempt(() =>
        readdir(folderPath, { withFileTypes: true })
    )

    if (err) {

        throw err
    }

    const files: ChangesetFile[] = []

    for (const entry of entries) {

        if (!entry.isFile()) continue

        const filename = entry.name
        const filePath = path.join(folderPath, filename)

        // Determine file type
        const type = getFileType(filename)

        if (!type) continue

        const file: ChangesetFile = {
            filename,
            path: filePath,
            type,
        }

        // Resolve manifest references
        if (type === 'txt' && schemaDir) {

            const [resolvedPaths, resolveErr] = await attempt(() =>
                resolveManifest(filePath, schemaDir)
            )

            if (resolveErr) {

                throw resolveErr
            }

            file.resolvedPaths = resolvedPaths
        }

        files.push(file)
    }

    // Sort by filename for deterministic order
    return files.sort((a, b) => a.filename.localeCompare(b.filename))
}


/**
 * Determine file type from filename.
 */
function getFileType(filename: string): ChangesetFileType | null {

    if (filename.endsWith(MANIFEST_EXTENSION)) {

        return 'txt'
    }

    for (const ext of SQL_EXTENSIONS) {

        if (filename.endsWith(ext)) {

            return 'sql'
        }
    }

    return null
}


/**
 * Check if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {

    const [, err] = await attempt(() => access(filePath, fsConstants.R_OK))

    return err === null
}


/**
 * Check if error is a "not found" error.
 */
function isNotFoundError(err: Error): boolean {

    return (err as NodeJS.ErrnoException).code === 'ENOENT'
}


/**
 * Find duplicate items in an array.
 */
function findDuplicates(items: string[]): string[] {

    const seen = new Set<string>()
    const duplicates = new Set<string>()

    for (const item of items) {

        if (seen.has(item)) {

            duplicates.add(item)
        }

        seen.add(item)
    }

    return Array.from(duplicates)
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

    const match = filename.match(SEQUENCE_REGEX)

    if (match && match[1]) {

        return parseInt(match[1], 10)
    }

    return null
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
    let name = filename

    if (name.endsWith('.sql.tmpl')) {

        name = name.slice(0, -9)
    }
    else if (name.endsWith('.sql')) {

        name = name.slice(0, -4)
    }
    else if (name.endsWith('.txt')) {

        name = name.slice(0, -4)
    }

    // Remove sequence prefix
    const match = name.match(SEQUENCE_REGEX)

    if (match && match[2]) {

        return match[2]
    }

    return name
}
