/**
 * noorm change rm — delete a change directory.
 *
 * Offline operation: no database connection required. Reads settings
 * to locate the changes directory, then removes the named change.
 *
 * On a TTY the command prompts the user to pick a change (if omitted)
 * and confirms the deletion interactively; `--yes` skips the confirm.
 * On a non-TTY (CI, piped) both the name and `--yes` are required so
 * the command never hangs or deletes silently.
 */
import { join } from 'node:path';
import { stat } from 'node:fs/promises';

import * as p from '@clack/prompts';
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { deleteChange } from '../../core/change/index.js';
import { getSettingsManager } from '../../core/settings/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';
import { selectChangeFromFs, requireTty } from './_prompt.js';

const rmCommand = defineCommand({
    meta: { name: 'rm', description: 'Delete a change directory' },
    args: {
        name: {
            type: 'positional',
            description: 'Change name to delete (omit to pick interactively on a TTY)',
            required: false,
        },
        yes: sharedArgs.yes,
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

        let changeName = args.name;

        if (!changeName) {

            if (!requireTty('Change name')) process.exit(1);

            const picked = await selectChangeFromFs(changesDir, 'Pick a change to delete');

            if (!picked) process.exit(1);

            changeName = picked;

        }

        const changePath = join(changesDir, changeName);

        const [existingStats, statErr] = await attempt(() => stat(changePath));

        if (statErr || !existingStats) {

            outputError(args, `Change not found: ${changeName}`);
            process.exit(1);

        }

        if (!args.yes) {

            if (!process.stdin.isTTY) {

                outputError(
                    args,
                    `Pass --yes to confirm deletion of change: ${changeName}`,
                );
                process.exit(1);

            }

            const confirmed = await p.confirm({
                message: `Delete change "${changeName}"? This cannot be undone.`,
                initialValue: false,
            });

            if (p.isCancel(confirmed) || !confirmed) {

                process.stderr.write('Cancelled.\n');
                process.exit(1);

            }

        }

        const changeStub = {
            name: changeName, path: changePath, date: new Date(),
            description: changeName, changeFiles: [], revertFiles: [], hasChangelog: false,
        };

        const [, deleteErr] = await attempt(() => deleteChange(changeStub));

        if (deleteErr) {

            outputError(args, deleteErr.message);
            process.exit(1);

        }

        if (!args.json) {

            process.stdout.write(`Deleted: ${changeName}\n`);

        }

        outputResult(args, { name: changeName, deleted: true }, '');
        process.exit(0);

    },
});

(rmCommand as typeof rmCommand & { examples: string[] }).examples = [
    'noorm change rm',
    'noorm change rm 2024-01-15-add-users-table',
    'noorm change rm 2024-01-15-add-users-table --yes --json',
];

export default rmCommand;
