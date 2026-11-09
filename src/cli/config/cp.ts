/**
 * noorm config cp — copy a configuration to a new name.
 *
 * Clones an existing config entry under a new name without modifying
 * the source. Useful for deriving staging/prod configs from a base dev config.
 */
import { attempt, attemptSync } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { ProtectedStageEscapeError, SettingsProvider, withConfigPolicy } from '../../core/config/resolver.js';
import { getSettingsManager } from '../../core/settings/index.js';
import { checkConfigPolicy, resolveChannel } from '../../core/policy/index.js';
import { outputResult, outputError, sharedArgs, isYesMode } from '../_utils.js';
import { EXIT } from '../_exit.js';

const cpCommand = defineCommand({
    meta: {
        name: 'cp',
        description: 'Copy a configuration to a new name',
    },
    args: {
        src: { type: 'positional', description: 'Source config name', required: true },
        dest: { type: 'positional', description: 'Destination config name', required: true },
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
        const source = stateManager.getConfig(args.src);

        if (!source) {

            outputError(args, `Config not found: ${args.src}`);
            process.exit(EXIT.USAGE);

        }

        const existing = stateManager.getConfig(args.dest);

        if (existing) {

            outputError(args, `Config already exists: ${args.dest}`);
            process.exit(1);

        }

        if (resolveChannel() !== 'user') {

            outputError(args, 'Creating configurations requires the user channel.');
            process.exit(1);

        }

        const settingsManager = getSettingsManager(projectRoot);
        const [, settingsErr] = await attempt(() => settingsManager.load());
        if (settingsErr) {

            outputError(args, `Failed to load settings: ${settingsErr.message}`);
            process.exit(1);

        }

        const provider = new SettingsProvider(settingsManager);
        const [policyConfig, policyErr] = attemptSync(() => withConfigPolicy(source, provider));
        if (policyErr) {

            outputError(args, policyErr.message);
            process.exit(EXIT.USAGE);

        }

        const check = checkConfigPolicy(resolveChannel(), policyConfig, 'config:write');
        if (!check.allowed) {

            outputError(args, check.blockedReason ?? `Cannot copy config "${source.name}".`);
            process.exit(1);

        }
        if (check.requiresConfirmation && !isYesMode(args)) {

            outputError(args, `Copying config "${source.name}" requires confirmation (${check.confirmationPhrase}). Pass --yes to confirm.`);
            process.exit(1);

        }

        const [, saveErr] = await attempt(() => stateManager.copyConfig(args.src, args.dest, provider));

        if (saveErr) {

            outputError(args, saveErr instanceof ProtectedStageEscapeError
                ? saveErr.message
                : `Failed to save config: ${saveErr.message}`);
            process.exit(1);

        }

        outputResult(
            args,
            { success: true, src: args.src, dest: args.dest },
            `Copied config '${args.src}' to '${args.dest}'.`,
        );
        process.exit(0);

    },
});

(cpCommand as typeof cpCommand & { examples: string[] }).examples = [
    'noorm config cp dev staging',
    'noorm config cp dev prod --json',
];

export default cpCommand;
