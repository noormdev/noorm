/**
 * noorm change add — create a new change directory.
 *
 * Offline operation: no database connection required. Reads settings
 * to locate the changes directory, then scaffolds the new change.
 */
import { join } from 'node:path';

import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { createChange } from '../../core/change/index.js';
import { getSettingsManager } from '../../core/settings/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

const addCommand = defineCommand({
    meta: { name: 'add', description: 'Create a new change directory' },
    args: {
        name: { type: 'positional', description: 'Description for the change (e.g. add-users-table)', required: true },
        json: sharedArgs.json,
    },
    async run({ args }) {

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

        const [change, createErr] = await attempt(() =>
            createChange(changesDir, { description: args.name }),
        );

        if (createErr || !change) {

            outputError(args, createErr?.message ?? 'Failed to create change');
            process.exit(1);

        }

        if (!args.json) {

            process.stdout.write(`Created: ${change.name}\n`);
            process.stdout.write(`  ${change.path}\n`);

        }

        outputResult(args, { name: change.name, path: change.path }, '');
        process.exit(0);

    },
});

(addCommand as typeof addCommand & { examples: string[] }).examples = [
    'noorm change add add-users-table',
    'noorm change add create-audit-log --json',
];

export default addCommand;
