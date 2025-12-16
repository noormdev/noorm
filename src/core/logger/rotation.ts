/**
 * Log Rotation
 *
 * Handles log file rotation when size limits are exceeded.
 * Rotated files are named with timestamps and old files are
 * cleaned up when maxFiles is exceeded.
 */
import { stat, rename, readdir, unlink } from 'node:fs/promises'
import { dirname, basename, join, extname } from 'node:path'
import { attempt } from '@logosdx/utils'

import type { RotationResult } from './types.js'


/**
 * Parse a size string (e.g., '10mb', '1gb') to bytes.
 *
 * @param size - Size string with unit suffix
 * @returns Size in bytes
 *
 * @example
 * ```typescript
 * parseSize('10mb')  // 10485760
 * parseSize('1gb')   // 1073741824
 * parseSize('512kb') // 524288
 * ```
 */
export function parseSize(size: string): number {

    const match = size.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/)

    if (!match || !match[1]) {

        throw new Error(`Invalid size format: ${size}`)
    }

    const value = parseFloat(match[1])
    const unit = match[2] ?? 'b'

    const multipliers: Record<string, number> = {
        b: 1,
        kb: 1024,
        mb: 1024 * 1024,
        gb: 1024 * 1024 * 1024,
    }

    const multiplier = multipliers[unit]

    if (multiplier === undefined) {

        throw new Error(`Invalid size unit: ${unit}`)
    }

    return Math.floor(value * multiplier)
}


/**
 * Generate a rotated filename with timestamp.
 *
 * @param filepath - Original file path
 * @returns Rotated file path with timestamp
 *
 * @example
 * ```typescript
 * generateRotatedName('/logs/app.log')
 * // '/logs/app.2024-01-15T10-30-00.log'
 * ```
 */
export function generateRotatedName(filepath: string): string {

    const dir = dirname(filepath)
    const ext = extname(filepath)
    const base = basename(filepath, ext)

    // Use timestamp format that's valid on all filesystems
    const timestamp = new Date()
        .toISOString()
        .replace(/:/g, '-')
        .replace(/\.\d+Z$/, '')

    return join(dir, `${base}.${timestamp}${ext}`)
}


/**
 * Check if a log file needs rotation.
 *
 * @param filepath - Path to log file
 * @param maxSize - Maximum size in bytes
 * @returns true if file exceeds maxSize
 */
export async function needsRotation(filepath: string, maxSize: number): Promise<boolean> {

    const [stats, err] = await attempt(() => stat(filepath))

    if (err) {

        // File doesn't exist or can't be read - no rotation needed
        return false
    }

    return stats.size >= maxSize
}


/**
 * Rotate a log file.
 *
 * Renames the current file with a timestamp suffix.
 *
 * @param filepath - Path to log file
 * @returns New rotated file path
 */
export async function rotateFile(filepath: string): Promise<string> {

    const newPath = generateRotatedName(filepath)

    const [_, err] = await attempt(() => rename(filepath, newPath))

    if (err) {

        throw new Error(`Failed to rotate log file: ${err.message}`)
    }

    return newPath
}


/**
 * List rotated log files for a given base file.
 *
 * @param filepath - Original log file path
 * @returns Array of rotated file paths, sorted newest first
 */
export async function listRotatedFiles(filepath: string): Promise<string[]> {

    const dir = dirname(filepath)
    const ext = extname(filepath)
    const base = basename(filepath, ext)

    // Pattern: base.YYYY-MM-DDTHH-MM-SS.ext
    const pattern = new RegExp(
        `^${escapeRegex(base)}\\.\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}${escapeRegex(ext)}$`
    )

    const [files, err] = await attempt(() => readdir(dir))

    if (err) {

        return []
    }

    return files
        .filter((f) => pattern.test(f))
        .map((f) => join(dir, f))
        .sort()
        .reverse()  // Newest first
}


/**
 * Clean up old rotated files.
 *
 * @param filepath - Original log file path
 * @param maxFiles - Maximum number of rotated files to keep
 * @returns Array of deleted file paths
 */
export async function cleanupRotatedFiles(
    filepath: string,
    maxFiles: number
): Promise<string[]> {

    const rotated = await listRotatedFiles(filepath)

    // Keep maxFiles, delete the rest
    const toDelete = rotated.slice(maxFiles)
    const deleted: string[] = []

    for (const file of toDelete) {

        const [_, err] = await attempt(() => unlink(file))

        if (!err) {

            deleted.push(file)
        }
    }

    return deleted
}


/**
 * Check and perform rotation if needed.
 *
 * @param filepath - Path to log file
 * @param maxSizeStr - Maximum size string (e.g., '10mb')
 * @param maxFiles - Maximum rotated files to keep
 * @returns Rotation result
 *
 * @example
 * ```typescript
 * const result = await checkAndRotate('/logs/app.log', '10mb', 5)
 * if (result.rotated) {
 *     console.log(`Rotated to ${result.newFile}`)
 * }
 * ```
 */
export async function checkAndRotate(
    filepath: string,
    maxSizeStr: string,
    maxFiles: number
): Promise<RotationResult> {

    const maxSize = parseSize(maxSizeStr)
    const shouldRotate = await needsRotation(filepath, maxSize)

    if (!shouldRotate) {

        return { rotated: false }
    }

    // Rotate current file
    const newFile = await rotateFile(filepath)

    // Cleanup old files
    const deletedFiles = await cleanupRotatedFiles(filepath, maxFiles)

    return {
        rotated: true,
        oldFile: filepath,
        newFile,
        deletedFiles: deletedFiles.length > 0 ? deletedFiles : undefined,
    }
}


/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {

    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
