/**
 * noorm sql clear — clear SQL execution history.
 *
 * Deletes persisted history entries and their associated result files
 * from `.noorm/state/history/`. No database connection required.
 *
 * Supports clearing all history or only entries older than N months.
 */
import { defineCommand } from 'citty';

import { SqlHistoryManager } from '../../core/sql-terminal/history.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

const clearCommand = defineCommand({
    meta: {
        name: 'clear',
        description: 'Clear SQL execution history',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
        yes: sharedArgs.yes,
        olderThan: {
            type: 'string',
            description: 'Only clear entries older than N months (e.g. --older-than 3)',
        },
    },
    async run({ args }) {

        const projectRoot = process.cwd();
        const configName = args.config ?? 'default';

        const manager = new SqlHistoryManager(projectRoot, configName);

        let months: number | undefined;

        if (args.olderThan !== undefined) {

            months = parseInt(args.olderThan, 10);

            if (isNaN(months) || months < 1) {

                outputError(args, `Invalid --older-than value: ${args.olderThan}. Must be a positive integer (months).`);
                process.exit(1);

            }

        }

        // Confirm unless --yes or --json (non-interactive)
        if (!args.yes && !args.json) {

            const scope = months !== undefined
                ? `entries older than ${months} month(s)`
                : 'all entries';

            process.stdout.write(`This will clear ${scope} from SQL history for config '${configName}'.\n`);
            process.stdout.write('Pass --yes to skip this confirmation.\n');
            process.exit(0);

        }

        const result = months !== undefined
            ? await manager.clearOlderThan(months)
            : await manager.clearAll();

        const message = months !== undefined
            ? `Cleared ${result.entriesRemoved} entries older than ${months} month(s) (${result.filesRemoved} result files removed).`
            : `Cleared ${result.entriesRemoved} entries (${result.filesRemoved} result files removed).`;

        outputResult(args, {
            configName,
            entriesRemoved: result.entriesRemoved,
            filesRemoved: result.filesRemoved,
        }, message);

        process.exit(0);

    },
});

(clearCommand as typeof clearCommand & { examples: string[] }).examples = [
    'noorm sql clear --yes',
    'noorm sql clear -c prod --yes',
    'noorm sql clear --older-than 3 --yes',
    'noorm sql clear --json --yes',
];

export default clearCommand;
