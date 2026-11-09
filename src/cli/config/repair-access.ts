import { attempt, attemptSync } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { SettingsProvider, validateAccessRoles, withConfigPolicy } from '../../core/config/resolver.js';
import { checkConfigPolicy, resolveChannel } from '../../core/policy/index.js';
import { getSettingsManager } from '../../core/settings/index.js';
import { getStateManager, initState } from '../../core/state/index.js';
import { outputError, outputResult, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

const repairAccess = defineCommand({
    meta: { name: 'repair-access', description: 'Repair invalid configuration access' },
    args: {
        name: { type: 'positional', description: 'Configuration name', required: true },
        user: { type: 'string', description: 'Replacement user role', required: true },
        agent: { type: 'string', description: 'Replacement agent role or false', required: true },
        yes: sharedArgs.yes,
        json: sharedArgs.json,
    },
    async run({ args }) {

        if (resolveChannel() !== 'user') {

            outputError(args, 'Access repair is only available on the user channel.');
            process.exit(1);

        }
        if (!args.yes) {

            outputError(args, 'Access repair requires explicit confirmation with --yes.');
            process.exit(1);

        }
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
        const roles = settingsManager.settings.access?.roles ?? {};
        const access = { user: args.user, agent: args.agent === 'false' ? false as const : args.agent };
        const [, replacementErr] = attemptSync(() => validateAccessRoles(access, roles));
        if (replacementErr) {

            outputError(args, replacementErr.message);
            process.exit(EXIT.USAGE);

        }
        const candidate = config ?? stateManager.getConfigRecoveryCandidate(args.name);
        if (candidate) {

            const [, userRoleErr] = attemptSync(() => validateAccessRoles({ ...candidate.access, agent: false }, roles));
            if (!userRoleErr) {

                const [policyConfig, policyErr] = attemptSync(() => withConfigPolicy(
                    { ...candidate, access: { ...candidate.access, agent: false } }, new SettingsProvider(settingsManager),
                ));
                if (policyErr) {

                    outputError(args, policyErr.message);
                    process.exit(EXIT.USAGE);

                }
                const check = checkConfigPolicy('user', policyConfig, 'config:write');
                if (!check.allowed) {

                    outputError(args, check.blockedReason ?? `Config "${args.name}" cannot be repaired.`);
                    process.exit(1);

                }

            }

        }
        const [, repairErr] = await attempt(() => stateManager.repairConfigAccess(args.name, access, roles));
        if (repairErr) {

            outputError(args, repairErr.message);
            process.exit(1);

        }
        outputResult(args, { name: args.name, repaired: true }, `Repaired access: ${args.name}`);
        process.exit(0);

    },
});

export default repairAccess;
