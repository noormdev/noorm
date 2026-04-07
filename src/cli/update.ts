/**
 * noorm update — check for and install updates.
 *
 * Downloads the platform-appropriate binary from GitHub releases
 * and replaces the running binary in-place.
 */
import { defineCommand } from 'citty';
import { attempt } from '@logosdx/utils';

import { checkForUpdate, getCurrentVersion } from '../core/update/checker.js';
import { installUpdate } from '../core/update/updater.js';
import { outputError, outputResult, sharedArgs } from './_utils.js';

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
        process.stdout.write('Installing...\n');

        const result = await installUpdate(checkResult.latestVersion);

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
