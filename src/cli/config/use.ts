/**
 * noorm config use — set the active configuration.
 *
 * Persists the active config name to encrypted state, then syncs identity
 * with the database as far as the config's access for this channel lets it write there.
 */
import { attempt, attemptSync } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { syncIdentityWithConfig } from '../../core/identity/index.js';
import { getSettingsManager } from '../../core/settings/index.js';
import { SettingsProvider, withConfigPolicy } from '../../core/config/resolver.js';
import { isVisibleToChannel, resolveChannel } from '../../core/policy/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

const useCommand = defineCommand({
    meta: {
        name: 'use',
        description: 'Set the active configuration',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Configuration name to activate',
            required: true,
        },
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

        const config = stateManager.getConfig(args.name);
        if (!config) {

            outputError(args, `Config "${args.name}" not found.`);
            process.exit(EXIT.USAGE);

        }

        const settingsManager = getSettingsManager(projectRoot);
        const [, settingsErr] = await attempt(() => settingsManager.load());
        if (settingsErr) {

            outputError(args, `Failed to load settings: ${settingsErr.message}`);
            process.exit(EXIT.FAILURE);

        }

        const [bound, policyErr] = attemptSync(() => withConfigPolicy(config, new SettingsProvider(settingsManager)));
        if (policyErr) {

            outputError(args, policyErr.message);
            process.exit(EXIT.USAGE);

        }

        const channel = resolveChannel();
        if (!isVisibleToChannel(bound.access, channel)) {

            outputError(args, `Config "${args.name}" is not accessible on the ${channel} channel.`);
            process.exit(EXIT.FAILURE);

        }

        const [, setErr] = await attempt(() => stateManager.setActiveConfig(args.name));

        if (setErr) {

            outputError(args, setErr.message);
            process.exit(EXIT.USAGE);

        }

        const syncResult = await syncIdentityWithConfig(bound, channel);

        if (syncResult.ok && syncResult.knownUsers?.length) {

            await stateManager.addKnownUsers(syncResult.knownUsers);

        }

        outputResult(args, { activeConfig: args.name }, `Active config set to: ${args.name}`);
        process.exit(0);

    },
});

(useCommand as typeof useCommand & { examples: string[] }).examples = [
    'noorm config use dev',
    'noorm config use production',
    'noorm config use production --json',
];

export default useCommand;
