/**
 * noorm secret set <key> <value> — store a secret for the active or named config.
 *
 * Secrets are encrypted in state and scoped to a specific config.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

const setCommand = defineCommand({
    meta: {
        name: 'set',
        description: 'Set a secret for a config',
    },
    args: {
        key: { type: 'positional', description: 'Secret key name', required: true },
        value: { type: 'positional', description: 'Secret value', required: true },
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

        const [, setErr] = await attempt(() =>
            stateManager.setSecret(configName, args.key, args.value),
        );

        if (setErr) {

            outputError(args, `Failed to set secret: ${setErr.message}`);
            process.exit(1);

        }

        outputResult(
            args,
            { success: true, configName, key: args.key },
            `Secret "${args.key}" set for config "${configName}".`,
        );

        process.exit(0);

    },
});

(setCommand as typeof setCommand & { examples: string[] }).examples = [
    'noorm secret set API_KEY "sk-live-..."',
    'noorm secret set DB_PASSWORD "secret123" --config prod',
    'noorm secret set API_KEY "sk-live-..." --json',
];

export default setCommand;
