/**
 * noorm change add — create a new change directory.
 *
 * Offline operation: no database connection required. Reads settings
 * to locate the changes directory, then scaffolds the new change.
 *
 * If the description is omitted and stdin is a TTY, prompts the user
 * via clack. On a non-TTY (CI, piped) the command errors out rather
 * than hanging.
 */
import { join } from 'node:path';

import * as p from '@clack/prompts';
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { createChange } from '../../core/change/index.js';
import { getSettingsManager } from '../../core/settings/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';
import { requireTty } from './_prompt.js';

const addCommand = defineCommand({
    meta: { name: 'add', description: 'Create a new change directory' },
    args: {
        name: {
            type: 'positional',
            description: 'Description for the change, e.g. add-users-table (omit to prompt on TTY)',
            required: false,
        },
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

        let description = args.name;

        if (!description) {

            if (!requireTty('Change description')) process.exit(1);

            const typed = await p.text({
                message: 'Describe this change',
                placeholder: 'add-users-table',
                validate: (v) => {

                    if (!v || !v.trim()) return 'Description is required.';

                    return undefined;

                },
            });

            if (p.isCancel(typed)) {

                process.stderr.write('Cancelled.\n');
                process.exit(1);

            }

            description = typed.trim();

        }

        const [change, createErr] = await attempt(() =>
            createChange(changesDir, { description }),
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
    'noorm change add',
    'noorm change add add-users-table',
    'noorm change add create-audit-log --json',
];

export default addCommand;
