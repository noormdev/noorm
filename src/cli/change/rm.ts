/**
 * noorm change rm — delete a change directory.
 *
 * Offline operation: no database connection required. Reads settings
 * to locate the changes directory, then removes the named change.
 * Requires --yes to confirm deletion.
 */
import { join } from 'node:path';
import { stat } from 'node:fs/promises';

import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { deleteChange } from '../../core/change/index.js';
import { getSettingsManager } from '../../core/settings/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

const rmCommand = defineCommand({
    meta: { name: 'rm', description: 'Delete a change directory' },
    args: {
        name: { type: 'positional', description: 'Change name to delete', required: true },
        yes: sharedArgs.yes,
        json: sharedArgs.json,
    },
    async run({ args }) {

        if (!args.yes) {

            outputError(args, `Pass --yes to confirm deletion of change: ${args.name}`);
            process.exit(1);

        }

        const projectRoot = process.cwd();
        const settingsManager = getSettingsManager(projectRoot);

        const [, settingsErr] = await attempt(() => settingsManager.load());

        if (settingsErr) {

            outputError(args, `Failed to load settings: ${settingsErr.message}`);
            process.exit(1);

        }

        const changesDir = join(
            projectRoot,
            settingsManager.settings.paths?.changes ?? 'changes',
        );

        const changePath = join(changesDir, args.name);

        const [existingStats, statErr] = await attempt(() => stat(changePath));

        if (statErr || !existingStats) {

            outputError(args, `Change not found: ${args.name}`);
            process.exit(1);

        }

        const changeStub = {
            name: args.name, path: changePath, date: new Date(),
            description: args.name, changeFiles: [], revertFiles: [], hasChangelog: false,
        };

        const [, deleteErr] = await attempt(() => deleteChange(changeStub));

        if (deleteErr) {

            outputError(args, deleteErr.message);
            process.exit(1);

        }

        if (!args.json) {

            process.stdout.write(`Deleted: ${args.name}\n`);

        }

        outputResult(args, { name: args.name, deleted: true }, '');
        process.exit(0);

    },
});

(rmCommand as typeof rmCommand & { examples: string[] }).examples = [
    'noorm change rm 2024-01-15-add-users-table --yes',
    'noorm change rm 2024-01-15-add-users-table --yes --json',
];

export default rmCommand;
