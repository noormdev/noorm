/**
 * noorm update — check for and install updates.
 *
 * Downloads the platform-appropriate binary from GitHub releases
 * and replaces the running binary in-place.
 */
import { defineCommand } from 'citty';
import { attempt } from '@logosdx/utils';

import { observer } from '../core/observer.js';
import { checkForUpdate, getCurrentVersion } from '../core/update/checker.js';
import { installUpdate } from '../core/update/updater.js';
import { outputError, outputResult, sharedArgs } from './_utils.js';

/** Render a byte count as MB with one decimal (e.g. 41.2). */
function toMb(bytes: number): string {

    return (bytes / 1024 / 1024).toFixed(1);

}

const updateCommand = defineCommand({
    meta: {
        name: 'update',
        description: 'Check for and install noorm updates',
    },
    args: {
        json: sharedArgs.json,
    },
    async run({ args }) {

        const currentVersion = getCurrentVersion();

        process.stdout.write(`Current version: ${currentVersion}\n`);
        process.stdout.write('Checking for updates...\n');

        const [checkResult, checkErr] = await attempt(() => checkForUpdate());

        if (checkErr || !checkResult) {

            const errorMsg = checkErr?.message ?? 'Failed to check for updates (offline?)';

            outputError(args, errorMsg);

            if (args.json) {

                outputResult(args, {
                    currentVersion,
                    latestVersion: null,
                    updateAvailable: false,
                    installed: false,
                    error: errorMsg,
                }, '');

            }

            process.exit(1);

        }

        if (!checkResult.updateAvailable) {

            process.stdout.write(`Already on the latest version (${currentVersion})\n`);

            if (args.json) {

                outputResult(args, {
                    currentVersion,
                    latestVersion: checkResult.latestVersion,
                    updateAvailable: false,
                    installed: false,
                }, '');

            }

            process.exit(0);

        }

        process.stdout.write(`Update available: ${currentVersion} → ${checkResult.latestVersion}\n`);

        // Render a live progress line for the binary download. TTY output uses a
        // carriage return to update in place; when stdout is piped (e.g. CI, JSON
        // mode) there's no cursor to rewind, so fall back to periodic newlines.
        const isTty = Boolean(process.stdout.isTTY) && !args.json;

        const onProgress = ({ received, total }: { received: number; total: number }) => {

            const pct = total > 0 ? ` (${Math.floor((received / total) * 100)}%)` : '';
            const of = total > 0 ? ` / ${toMb(total)}` : '';
            const line = `Downloading ${toMb(received)}${of} MB${pct}`;

            if (isTty) {

                process.stdout.write(`\r${line}   `);

            }

        };

        if (!args.json) {

            process.stdout.write(isTty ? 'Installing...\n' : 'Installing (downloading binary)...\n');

        }

        observer.on('update:progress', onProgress);

        const [result, installErr] = await attempt(() => installUpdate(checkResult.latestVersion));

        observer.off('update:progress', onProgress);

        if (isTty) {

            process.stdout.write('\n');

        }

        if (installErr || !result) {

            // installUpdate resolves with a result even on failure; a throw here
            // is unexpected (e.g. abort wiring) — surface it rather than hang.
            const errorMsg = installErr?.message ?? 'Update failed';

            process.stderr.write(`Update failed: ${errorMsg}\n`);

            if (args.json) {

                outputResult(args, {
                    currentVersion,
                    latestVersion: checkResult.latestVersion,
                    updateAvailable: true,
                    installed: false,
                    error: errorMsg,
                }, '');

            }

            process.exit(1);

        }

        if (result.success) {

            process.stdout.write(`Updated to ${result.newVersion}. Restart noorm to use the new version.\n`);

        }
        else {

            process.stderr.write(`Update failed: ${result.error}\n`);

        }

        if (args.json) {

            outputResult(args, {
                currentVersion,
                latestVersion: checkResult.latestVersion,
                updateAvailable: true,
                installed: result.success,
                error: result.error ?? undefined,
            }, '');

        }

        process.exit(result.success ? 0 : 1);

    },
});

(updateCommand as typeof updateCommand & { examples: string[] }).examples = [
    'noorm update',
    'noorm update --json',
];

export default updateCommand;
