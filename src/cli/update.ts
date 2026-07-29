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
import { isInsecureMode, outputError, outputResult, sharedArgs } from './_utils.js';
import { EXIT } from './_exit.js';

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
        insecure: {
            type: 'boolean',
            description: 'Skip checksum verification when checksums.txt is unreachable (never bypasses a confirmed mismatch)',
        },
    },
    async run({ args }) {

        const currentVersion = getCurrentVersion();

        process.stdout.write(`Current version: ${currentVersion}\n`);
        process.stdout.write('Checking for updates...\n');

        const [checkResult, checkErr] = await attempt(() => checkForUpdate());

        if (checkErr || !checkResult) {

            const errorMsg = checkErr?.message ?? 'Failed to check for updates (offline?)';

            // One document, not two: `outputError` already writes the
            // `{success:false,error}` envelope under `--json`, so the extra
            // `outputResult` put a second, success-shaped object on stdout for
            // the same failure.
            if (args.json) {

                outputResult(args, {
                    success: false,
                    error: errorMsg,
                    currentVersion,
                    latestVersion: null,
                    updateAvailable: false,
                    installed: false,
                }, '');

            }
            else {

                outputError(args, errorMsg);

            }

            process.exit(EXIT.FAILURE);

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

            process.exit(EXIT.SUCCESS);

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

        const onRetry = ({ attempt: n, maxAttempts, error }: { attempt: number; maxAttempts: number; error: string }) => {

            if (args.json) return;

            // End the in-place progress line before printing the notice.
            const prefix = isTty ? '\n' : '';

            process.stdout.write(`${prefix}${error} — resuming (attempt ${n + 1}/${maxAttempts})...\n`);

        };

        if (!args.json) {

            process.stdout.write(isTty ? 'Installing...\n' : 'Installing (downloading binary)...\n');

        }

        const insecure = isInsecureMode(args);

        if (insecure) {

            process.stderr.write('Warning: checksum verification will be skipped if checksums.txt is unreachable (--insecure).\n');

        }

        observer.on('update:progress', onProgress);
        observer.on('update:retry', onRetry);

        const [result, installErr] = await attempt(() => installUpdate(checkResult.latestVersion, { insecure }));

        observer.off('update:progress', onProgress);
        observer.off('update:retry', onRetry);

        if (isTty) {

            process.stdout.write('\n');

        }

        if (installErr || !result) {

            // installUpdate resolves with a result even on failure; a throw here
            // is unexpected (e.g. abort wiring) — surface it rather than hang.
            const errorMsg = installErr?.message ?? 'Update failed';

            if (args.json) {

                outputResult(args, {
                    success: false,
                    error: errorMsg,
                    currentVersion,
                    latestVersion: checkResult.latestVersion,
                    updateAvailable: true,
                    installed: false,
                }, '');

            }
            else {

                outputError(args, `Update failed: ${errorMsg}`);

            }

            process.exit(EXIT.FAILURE);

        }

        if (result.success) {

            process.stdout.write(`Updated to ${result.newVersion}. Restart noorm to use the new version.\n`);

        }
        else if (!args.json) {

            outputError(args, `Update failed: ${result.error}`);

        }

        if (args.json) {

            // `success` is stated rather than inferred: the payload carries no
            // `status`, so without it a failed install reported success:true
            // while the process exited 1.
            outputResult(args, {
                success: result.success,
                currentVersion,
                latestVersion: checkResult.latestVersion,
                updateAvailable: true,
                installed: result.success,
                error: result.error ?? undefined,
            }, '');

        }

        process.exit(result.success ? EXIT.SUCCESS : EXIT.FAILURE);

    },
});

(updateCommand as typeof updateCommand & { examples: string[] }).examples = [
    'noorm update',
    'noorm update --json',
    'noorm update --insecure',
];

export default updateCommand;
