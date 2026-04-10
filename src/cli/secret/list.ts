/**
 * noorm secret list — list secret keys for the active or named config.
 *
 * Displays only key names; values are never shown in plain text.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

const listCommand = defineCommand({
    meta: {
        name: 'list',
        description: 'List secret keys for a config',
    },
    args: {
        config: sharedArgs.config,
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

        if (!configName) {

            outputError(args, 'No config specified and no active config set. Use --config or run "noorm config use <name>".');
            process.exit(1);

        }

        const keys = stateManager.listSecrets(configName);

        outputResult(
            args,
            { configName, keys },
            keys.length === 0
                ? `No secrets set for config "${configName}".`
                : `Secrets for "${configName}" (${keys.length}):\n${keys.map((k) => `  ${k}`).join('\n')}`,
        );

        process.exit(0);

    },
});

(listCommand as typeof listCommand & { examples: string[] }).examples = [
    'noorm secret list',
    'noorm secret list --config prod',
    'noorm secret list --json',
];

export default listCommand;
