/**
 * noorm config delete command -- headless deletion of a configuration.
 *
 * Gated by the config's access role for this permission (viewer denied,
 * operator and admin require confirmation) and routed through the same
 * core deletion path the TUI's ConfigRemoveScreen calls, so ticket 29's
 * locked-stage guard is enforced identically here.
 */
import { attempt, attemptSync } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { getSettingsManager } from '../../core/settings/index.js';
import { checkConfigPolicy, resolveChannel } from '../../core/policy/index.js';
import { SettingsProvider, validateAccessRoles, withConfigPolicy } from '../../core/config/resolver.js';
import { outputResult, outputError, sharedArgs, isYesMode } from '../_utils.js';
import { EXIT } from '../_exit.js';

const rmCommand = defineCommand({
    meta: {
        name: 'rm',
        description: 'Remove a configuration',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Configuration name to remove',
            required: true,
        },
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
        const accessError = stateManager.getConfigAccessError(args.name);
        const config = accessError ? null : stateManager.getConfig(args.name);

        if (!config && !accessError) {

            outputError(args, `Config "${args.name}" not found.`);
            process.exit(EXIT.USAGE);

        }

        const settingsManager = getSettingsManager(projectRoot);
        const [, settingsErr] = await attempt(() => settingsManager.load());

        if (settingsErr) {

            outputError(args, `Failed to load settings: ${settingsErr.message}`);
            process.exit(1);

        }

        const settingsProvider = new SettingsProvider(settingsManager);
        const channel = resolveChannel();
        const [, userRoleErr] = config
            ? attemptSync(() => validateAccessRoles({ ...config.access, agent: false }, settingsManager.settings.access?.roles))
            : [undefined, null];
        const recovery = !!accessError || !!userRoleErr;

        if (recovery) {

            if (channel !== 'user') {

                outputError(args, `Config "${args.name}" cannot be removed on the agent channel.`);
                process.exit(1);

            }
            if (!isYesMode(args)) {

                outputError(args, `Removing config "${args.name}" with invalid access requires confirmation. Pass --yes to confirm.`);
                process.exit(1);

            }
            const candidate = accessError ? stateManager.getConfigRecoveryCandidate(args.name) : null;
            const [, candidateRoleErr] = candidate
                ? attemptSync(() => validateAccessRoles(candidate.access, settingsManager.settings.access?.roles))
                : [undefined, null];
            if (candidate && !candidateRoleErr) {

                const [policyConfig, policyErr] = attemptSync(() => withConfigPolicy(candidate, settingsProvider));
                if (policyErr) {

                    outputError(args, policyErr.message);
                    process.exit(EXIT.USAGE);

                }
                const check = checkConfigPolicy('user', policyConfig, 'config:rm');
                if (!check.allowed) {

                    outputError(args, check.blockedReason ?? `Config "${args.name}" cannot be removed.`);
                    process.exit(1);

                }

            }

        }
        else if (config) {

            const [policyConfig, policyErr] = attemptSync(() =>
                withConfigPolicy(channel === 'user'
                    ? { ...config, access: { ...config.access, agent: false } }
                    : config, settingsProvider),
            );
            if (policyErr) {

                outputError(args, policyErr.message);
                process.exit(EXIT.USAGE);

            }

            const check = checkConfigPolicy(channel, policyConfig, 'config:rm');
            if (!check.allowed) {

                outputError(args, check.blockedReason ?? `Config "${args.name}" cannot be removed.`);
                process.exit(1);

            }
            if (check.requiresConfirmation && !isYesMode(args)) {

                outputError(args, `This is a destructive operation requiring confirmation (${check.confirmationPhrase}). Pass --yes to confirm.`);
                process.exit(1);

            }

        }

        const [, deleteErr] = await attempt(() => stateManager.deleteConfig(args.name, settingsProvider));

        if (deleteErr) {

            outputError(args, deleteErr.message);
            process.exit(1);

        }

        outputResult(args, { name: args.name, deleted: true }, `Deleted: ${args.name}`);
        process.exit(0);

    },
});

(rmCommand as typeof rmCommand & { examples: string[] }).examples = [
    'noorm config rm staging --yes',
    'noorm config rm staging --yes --json',
];

export default rmCommand;
