/**
 * SQL History Manager.
 *
 * Manages SQL query history with gzipped results storage.
 * History is stored per-config in `.noorm/sql-history/`.
 */
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, unlink, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { attempt, attemptSync } from '@logosdx/utils';

import type {
    SqlHistoryEntry,
    SqlExecutionResult,
    SqlHistoryFileSerialized,
    SqlHistoryEntrySerialized,
    ClearResult,
} from './types.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const HISTORY_VERSION = '1.0.0';
const HISTORY_DIR = 'sql-history';

/**
 * SQL History Manager.
 *
 * Handles persistence of SQL query history and results.
 *
 * @example
 * ```typescript
 * const manager = new SqlHistoryManager('/project', 'production')
 * const entries = await manager.load()
 *
 * // Add a new entry
 * const id = await manager.addEntry('SELECT * FROM users', result)
 *
 * // Load results for an entry
 * const results = await manager.loadResults(id)
 * ```
 */
export class SqlHistoryManager {

    readonly #projectRoot: string;
    readonly #historyPath: string;
    readonly #resultsDir: string;

    constructor(projectRoot: string, configName: string) {

        this.#projectRoot = projectRoot;
        this.#historyPath = join(projectRoot, '.noorm', HISTORY_DIR, `${configName}.json`);
        this.#resultsDir = join(projectRoot, '.noorm', HISTORY_DIR, configName);

    }

    /**
     * Ensure the history and results directories exist.
     */
    async #ensureDirs(): Promise<void> {

        await mkdir(join(this.#projectRoot, '.noorm', HISTORY_DIR), { recursive: true });
        await mkdir(this.#resultsDir, { recursive: true });

    }

    /**
     * Load history from disk.
     *
     * @returns Array of history entries (newest first)
     */
    async load(): Promise<SqlHistoryEntry[]> {

        const [content, err] = await attempt(() => readFile(this.#historyPath, 'utf-8'));

        if (err) {

            // File doesn't exist yet - return empty
            return [];

        }

        const [parsed, parseErr] = attemptSync(() =>
            JSON.parse(content!) as SqlHistoryFileSerialized,
        );

        if (parseErr) {

            return [];

        }

        return this.#deserializeEntries(parsed!.entries);

    }

    /**
     * Add a new history entry and save results.
     *
     * @param query - The SQL query that was executed
     * @param result - The execution result
     * @returns The new entry ID
     */
    async addEntry(query: string, result: SqlExecutionResult): Promise<string> {

        await this.#ensureDirs();

        const id = randomUUID();
        let resultsFile: string | undefined;

        // Save results to gzipped file if we have rows
        if (result.success && result.rows && result.rows.length > 0) {

            resultsFile = `${id}.results.gz`;
            await this.saveResults(id, result);

        }

        const entry: SqlHistoryEntry = {
            id,
            query,
            executedAt: new Date(),
            durationMs: result.durationMs,
            success: result.success,
            errorMessage: result.errorMessage,
            rowCount: result.rows?.length ?? result.rowsAffected,
            resultsFile,
        };

        // Load existing entries and prepend new one
        const entries = await this.load();
        entries.unshift(entry);

        // Save updated history
        await this.#saveHistory(entries);

        return id;

    }

    /**
     * Save results to gzipped file.
     *
     * @param id - The entry ID (used as filename)
     * @param result - The execution result to save
     */
    async saveResults(id: string, result: SqlExecutionResult): Promise<void> {

        await this.#ensureDirs();

        const data = JSON.stringify({
            columns: result.columns,
            rows: result.rows,
        });

        const compressed = await gzipAsync(data);
        const filepath = join(this.#resultsDir, `${id}.results.gz`);

        await writeFile(filepath, compressed);

    }

    /**
     * Load results from gzipped file.
     *
     * @param id - The entry ID
     * @returns The execution result or null if not found
     */
    async loadResults(id: string): Promise<SqlExecutionResult | null> {

        const filepath = join(this.#resultsDir, `${id}.results.gz`);
        const [compressed, err] = await attempt(() => readFile(filepath));

        if (err) {

            return null;

        }

        const decompressed = await gunzipAsync(compressed!);
        const data = JSON.parse(decompressed.toString()) as {
            columns: string[];
            rows: Record<string, unknown>[];
        };

        return {
            success: true,
            columns: data.columns,
            rows: data.rows,
            durationMs: 0, // Not stored in results file
        };

    }

    /**
     * Get recent queries.
     *
     * @param limit - Maximum number of entries to return (default: 50)
     * @returns Array of recent entries (newest first)
     */
    async getRecent(limit = 50): Promise<SqlHistoryEntry[]> {

        const entries = await this.load();

        return entries.slice(0, limit);

    }

    /**
     * Clear entries older than specified months.
     *
     * @param months - Number of months to keep
     * @returns Clear result with counts
     */
    async clearOlderThan(months: number): Promise<ClearResult> {

        const entries = await this.load();
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - months);

        const toKeep: SqlHistoryEntry[] = [];
        const toRemove: SqlHistoryEntry[] = [];

        for (const entry of entries) {

            if (entry.executedAt >= cutoff) {

                toKeep.push(entry);

            }
            else {

                toRemove.push(entry);

            }

        }

        // Delete result files for removed entries
        let filesRemoved = 0;

        for (const entry of toRemove) {

            if (entry.resultsFile) {

                const filepath = join(this.#resultsDir, entry.resultsFile);
                const [, err] = await attempt(() => unlink(filepath));

                if (!err) {

                    filesRemoved++;

                }

            }

        }

        // Save updated history
        await this.#saveHistory(toKeep);

        return {
            entriesRemoved: toRemove.length,
            filesRemoved,
        };

    }

    /**
     * Clear all history and results.
     *
     * @returns Clear result with counts
     */
    async clearAll(): Promise<ClearResult> {

        const entries = await this.load();

        // Delete all result files
        let filesRemoved = 0;
        const [files] = await attempt(() => readdir(this.#resultsDir));

        if (files) {

            for (const file of files) {

                if (file.endsWith('.results.gz')) {

                    const filepath = join(this.#resultsDir, file);
                    const [, err] = await attempt(() => unlink(filepath));

                    if (!err) {

                        filesRemoved++;

                    }

                }

            }

        }

        // Clear history file
        await this.#saveHistory([]);

        return {
            entriesRemoved: entries.length,
            filesRemoved,
        };

    }

    /**
     * Get count of entries and total size of results.
     *
     * @returns Count info for display
     */
    async getStats(): Promise<{ entryCount: number; resultsSize: number }> {

        const entries = await this.load();
        let resultsSize = 0;

        const [files] = await attempt(() => readdir(this.#resultsDir));

        if (files) {

            for (const file of files) {

                if (file.endsWith('.results.gz')) {

                    const filepath = join(this.#resultsDir, file);
                    const [stats] = await attempt(() => stat(filepath));

                    if (stats) {

                        resultsSize += stats.size;

                    }

                }

            }

        }

        return {
            entryCount: entries.length,
            resultsSize,
        };

    }

    /**
     * Save history entries to disk.
     */
    async #saveHistory(entries: SqlHistoryEntry[]): Promise<void> {

        await this.#ensureDirs();

        const file: SqlHistoryFileSerialized = {
            version: HISTORY_VERSION,
            entries: this.#serializeEntries(entries),
        };

        await writeFile(this.#historyPath, JSON.stringify(file, null, 2));

    }

    /**
     * Serialize entries for JSON storage.
     */
    #serializeEntries(entries: SqlHistoryEntry[]): SqlHistoryEntrySerialized[] {

        return entries.map((entry) => ({
            id: entry.id,
            query: entry.query,
            executedAt: entry.executedAt.toISOString(),
            durationMs: entry.durationMs,
            success: entry.success,
            errorMessage: entry.errorMessage,
            rowCount: entry.rowCount,
            resultsFile: entry.resultsFile,
        }));

    }

    /**
     * Deserialize entries from JSON storage.
     */
    #deserializeEntries(entries: SqlHistoryEntrySerialized[]): SqlHistoryEntry[] {

        return entries.map((entry) => ({
            id: entry.id,
            query: entry.query,
            executedAt: new Date(entry.executedAt),
            durationMs: entry.durationMs,
            success: entry.success,
            errorMessage: entry.errorMessage,
            rowCount: entry.rowCount,
            resultsFile: entry.resultsFile,
        }));

    }

}
