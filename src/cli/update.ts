/**
 * Self-update command for binary distribution.
 *
 * Checks for updates and installs the latest version.
 * Downloads the platform-appropriate binary from GitHub releases.
 *
 * @example
 * ```bash
 * noorm -H update
 * noorm -H --json update
 * ```
 */
import { attempt } from '@logosdx/utils';

import type { HeadlessCommand, RouteHandler } from './_helpers.js';
import { checkForUpdate, getCurrentVersion } from '../../core/update/checker.js';
import { installUpdate } from '../../core/update/updater.js';

// =============================================================================
// Command
// =============================================================================

export const help = `
# UPDATE

Check for and install noorm updates.

## Usage

    noorm -H update

## Description

Checks for the latest version and downloads the update if available.
The binary is replaced in-place — restart to use the new version.

## Examples

    noorm -H update
    noorm -H --json update

## JSON Output

{
    "currentVersion": "1.0.0-alpha.11",
    "latestVersion": "1.0.0-alpha.12",
    "updateAvailable": true,
    "installed": true
}
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

    const currentVersion = getCurrentVersion();

    logger.info(`Current version: ${currentVersion}`);
    logger.info('Checking for updates...');

    const [checkResult, checkErr] = await attempt(() => checkForUpdate());

    if (checkErr || !checkResult) {

        const errorMsg = checkErr?.message ?? 'Failed to check for updates (offline?)';
        logger.error(errorMsg);

        if (flags.json) {

            logger.result({
                currentVersion,
                latestVersion: null,
                updateAvailable: false,
                installed: false,
                error: errorMsg,
            });

        }

        return 1;

    }

    if (!checkResult.updateAvailable) {

        logger.info(`Already on the latest version (${currentVersion})`);

        if (flags.json) {

            logger.result({
                currentVersion,
                latestVersion: checkResult.latestVersion,
                updateAvailable: false,
                installed: false,
            });

        }

        return 0;

    }

    logger.info(`Update available: ${currentVersion} → ${checkResult.latestVersion}`);
    logger.info('Installing...');

    const result = await installUpdate(checkResult.latestVersion);

    if (result.success) {

        logger.info(`Updated to ${result.newVersion}. Restart noorm to use the new version.`);

    }
    else {

        logger.error(`Update failed: ${result.error}`);

    }

    if (flags.json) {

        logger.result({
            currentVersion,
            latestVersion: checkResult.latestVersion,
            updateAvailable: true,
            installed: result.success,
            error: result.error ?? undefined,
        });

    }

    return result.success ? 0 : 1;

};

const handler: RouteHandler = {
    run,
    help,
};

export default handler;
