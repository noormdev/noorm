/**
 * noorm change rm — delete a change directory.
 *
 * Offline operation: no database connection required. Reads settings
 * to locate the changes directory, then removes the named change.
 *
 * Gated by the resolved config change:rm access role, best-effort:
 * when an active or --config config is resolvable, viewer is denied
 * outright and operator/admin require confirmation. When no config is
 * resolvable at all (fresh project, config add never run), the gate
 * is a no-op and confirmation defaults to required, matching the
 * pre-ticket behavior of this command.
 *
 * Confirmation has no TTY prompt substitute: --yes or NOORM_YES is the
 * only mechanism, mirroring the headless-only confirmation stance used
 * by config rm. On a TTY the command still prompts the user to pick a
 * change when the name is omitted; that picker is unrelated UX, not
 * the confirm gate.
 */
import { join } from 'node:path';
import { stat } from 'node:fs/promises';

import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { deleteChange } from '../../core/change/index.js';
import { getSettingsManager } from '../../core/settings/index.js';
import { initState, getStateManager } from '../../core/state/index.js';
import { checkConfigPolicy } from '../../core/policy/index.js';
import { outputResult, outputError, sharedArgs, isYesMode } from '../_utils.js';
import { selectChangeFromFs, requireTty } from './_prompt.js';

const rmCommand = defineCommand({
    meta: { name: 'rm', description: 'Delete a change directory' },
    args: {
        name: {
            type: 'positional',
            description: 'Change name to delete (omit to pick interactively on a TTY)',
            required: false,
        },
        config: sharedArgs.config,
        yes: sharedArgs.yes,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const projectRoot = process.cwd();

        const [, initErr] = await attempt(() => initState(projectRoot));

        if (initErr) {

            outputError(args, `Failed to load state: ${initErr.message}`);
            process.exit(1);

        }

        const stateManager = getStateManager(projectRoot);
        const configName = args.config ?? stateManager.getActiveConfigName();
        const config = configName ? stateManager.getConfig(configName) : null;

        const check = config ? checkConfigPolicy('user', config, 'change:rm') : null;

        if (check && !check.allowed) {

            outputError(args, check.blockedReason ?? `Config "${configName}" cannot delete changes.`);
            process.exit(1);

        }

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

        const requiresConfirmation = check ? check.requiresConfirmation : true;

        if (requiresConfirmation && !isYesMode(args)) {

            const message = check
                ? `This is a destructive operation requiring confirmation (${check.confirmationPhrase}). Pass --yes to confirm.`
                : `Pass --yes to confirm deletion of change: ${changeName}`;

            outputError(args, message);
            process.exit(1);

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
