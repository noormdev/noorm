/**
 * noorm sql history — show recent SQL execution history.
 *
 * Reads persisted history from `.noorm/state/history/` and displays
 * query text (truncated), timestamp, duration, and status.
 * No database connection required.
 */
import { defineCommand } from 'citty';

import { SqlHistoryManager } from '../../core/sql-terminal/history.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

/** Maximum characters of query text to display in non-JSON output. */
const QUERY_TRUNCATE = 80;

/**
 * Format a duration in milliseconds as a human-readable string.
 *
 * Keeps output compact: sub-second as "Xms", otherwise "X.Xs".
 */
function formatDuration(ms: number): string {

    if (ms < 1000) {

        return `${Math.round(ms)}ms`;

    }

    return `${(ms / 1000).toFixed(1)}s`;

}

/**
 * Format a date as a short local timestamp for terminal output.
 */
function formatTimestamp(date: Date): string {

    return date.toLocaleString(undefined, {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });

}

const historyCommand = defineCommand({
    meta: {
        name: 'history',
        description: 'Show SQL execution history',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
        limit: {
            type: 'string',
            description: 'Maximum number of entries to show (default: 50)',
            alias: 'n',
        },
    },
    async run({ args }) {

        const projectRoot = process.cwd();
        const configName = args.config ?? 'default';
        const limit = args.limit ? parseInt(args.limit, 10) : 50;

        if (isNaN(limit) || limit < 1) {

            outputError(args, `Invalid limit: ${args.limit}. Must be a positive integer.`);
            process.exit(1);

        }

        const manager = new SqlHistoryManager(projectRoot, configName);
        const entries = await manager.getRecent(limit);

        if (entries.length === 0) {

            outputResult(args, { entries: [], configName }, `No SQL history found for config '${configName}'.`);
            process.exit(0);

        }

        if (args.json) {

            outputResult(args, {
                configName,
                entries: entries.map((e) => ({
                    id: e.id,
                    query: e.query,
                    executedAt: e.executedAt.toISOString(),
                    durationMs: e.durationMs,
                    success: e.success,
                    errorMessage: e.errorMessage,
                    rowCount: e.rowCount,
                })),
            }, '');

        }
        else {

            process.stdout.write(`SQL history for '${configName}' (${entries.length} entries):\n\n`);

            for (const entry of entries) {

                const status = entry.success ? '✓' : '✗';
                const ts = formatTimestamp(entry.executedAt);
                const dur = formatDuration(entry.durationMs);
                const query = entry.query.replace(/\s+/g, ' ').trim();
                const truncated = query.length > QUERY_TRUNCATE
                    ? query.slice(0, QUERY_TRUNCATE) + '…'
                    : query;

                const rowInfo = entry.rowCount !== undefined ? ` · ${entry.rowCount} row(s)` : '';
                const errInfo = !entry.success && entry.errorMessage ? ` · ${entry.errorMessage}` : '';

                process.stdout.write(`  ${status}  ${ts}  ${dur}${rowInfo}${errInfo}\n`);
                process.stdout.write(`     ${truncated}\n\n`);

            }

        }

        process.exit(0);

    },
});

(historyCommand as typeof historyCommand & { examples: string[] }).examples = [
    'noorm sql history',
    'noorm sql history -c prod',
    'noorm sql history -n 20',
    'noorm sql history --json',
    'noorm sql history -c staging --json -n 100',
];

export default historyCommand;
