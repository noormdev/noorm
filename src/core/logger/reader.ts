/**
 * Log File Reader
 *
 * Reads and parses log entries from the noorm log file.
 * Handles JSON Lines format with graceful error handling for
 * malformed entries.
 *
 * @example
 * ```typescript
 * const result = await readLogFile('.noorm/state/noorm.log', { limit: 100 })
 * console.log(result.entries) // Most recent 100 entries
 * ```
 */
import * as fs from 'fs/promises';

import { attempt, attemptSync } from '@logosdx/utils';

import type { LogEntry } from './types.js';

/**
 * Options for reading log files.
 */
export interface ReadLogsOptions {

    /** Maximum entries to return (default: 500) */
    limit?: number;

}

/**
 * Result from reading a log file.
 */
export interface ReadLogsResult {

    /** Parsed log entries (newest first) */
    entries: LogEntry[];

    /** Total number of lines in the file */
    totalLines: number;

    /** Whether there are more entries beyond the limit */
    hasMore: boolean;

}

/**
 * Read log entries from a file.
 *
 * Parses JSON Lines format, skipping malformed entries.
 * Returns entries in reverse chronological order (newest first).
 *
 * @param filepath - Path to the log file
 * @param options - Read options
 * @returns Parsed log entries and metadata
 *
 * @example
 * ```typescript
 * // Get last 500 entries
 * const result = await readLogFile('.noorm/state/noorm.log')
 *
 * // Get last 100 entries
 * const result = await readLogFile('.noorm/state/noorm.log', { limit: 100 })
 *
 * // Handle missing file gracefully
 * const result = await readLogFile('missing.log')
 * // result.entries = [], result.totalLines = 0
 * ```
 */
export async function readLogFile(
    filepath: string,
    options: ReadLogsOptions = {},
): Promise<ReadLogsResult> {

    const { limit = 500 } = options;

    // Attempt to read the file
    const [content, err] = await attempt(() => fs.readFile(filepath, 'utf-8'));

    if (err) {

        // File doesn't exist or can't be read - return empty result
        return { entries: [], totalLines: 0, hasMore: false };

    }

    // Split into lines, filter empty
    const lines = content.trim().split('\n').filter(Boolean);
    const totalLines = lines.length;

    if (totalLines === 0) {

        return { entries: [], totalLines: 0, hasMore: false };

    }

    // Get last N lines (we'll reverse for newest-first order)
    const startIdx = Math.max(0, lines.length - limit);
    const selectedLines = lines.slice(startIdx);

    // Parse each line as JSON, skip malformed entries
    const entries: LogEntry[] = [];

    for (let i = selectedLines.length - 1; i >= 0; i--) {

        const line = selectedLines[i];

        if (!line) continue;

        const [parsed, parseErr] = attemptSync(() => JSON.parse(line) as LogEntry);

        if (!parseErr && parsed && isValidLogEntry(parsed)) {

            entries.push(parsed);

        }

    }

    return {
        entries,
        totalLines,
        hasMore: startIdx > 0,
    };

}

/**
 * Type guard for valid log entries.
 *
 * Ensures the parsed object has the required fields.
 * Uses 'time' and 'type' field names (Grafana/GitHub Actions compatible format).
 */
function isValidLogEntry(obj: unknown): obj is LogEntry {

    if (typeof obj !== 'object' || obj === null) {

        return false;

    }

    const entry = obj as Record<string, unknown>;

    return (
        typeof entry['time'] === 'string' &&
        typeof entry['level'] === 'string' &&
        typeof entry['type'] === 'string' &&
        typeof entry['message'] === 'string'
    );

}
