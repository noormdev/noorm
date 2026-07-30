/**
 * noorm secret rm <key> — remove a secret from the active or named config.
 *
 * Requires --yes to prevent accidental deletion.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { outputResult, outputError, sharedArgs, isYesMode } from '../_utils.js';
import { resolveSecretPolicy } from './_policy.js';
import { EXIT } from '../_exit.js';

const rmCommand = defineCommand({
    meta: {
        name: 'rm',
        description: 'Remove a secret from a config',
    },
    args: {
        key: { type: 'positional', description: 'Secret key name to remove', required: true },
        config: sharedArgs.config,
        json: sharedArgs.json,
        yes: sharedArgs.yes,
    },
    async run({ args }) {

        const projectRoot = process.cwd();
        const [, initErr] = await attempt(() => initState(projectRoot));

        if (initErr) {

            outputError(args, `Failed to load state: ${initErr.message}`);
            process.exit(1);

        }

        const stateManager = getStateManager(projectRoot);
        const resolved = resolveSecretPolicy(stateManager, args.config, 'secret:write');

        if (!resolved.ok) {

            outputError(args, resolved.error);
            process.exit(1);

        }

        const { configName } = resolved;

        // `isYesMode`, not `args.yes`: the documented `NOORM_YES` escape
        // hatch was ignored here while 14 other CLI sites honoured it.
        if (!isYesMode(args)) {

            outputError(args, `Pass --yes to confirm deletion of secret "${args.key}" from config "${configName}".`);
            process.exit(1);

        }

        const keys = stateManager.listSecrets(configName);
        const exists = { [args.key]: true }[args.key] && keys.includes(args.key);

        if (!exists) {

            outputError(args, `Secret "${args.key}" not found in config "${configName}".`);
            process.exit(EXIT.USAGE);

        }

        const [, deleteErr] = await attempt(() =>
            stateManager.deleteSecret(configName, args.key),
        );

        if (deleteErr) {

            outputError(args, `Failed to delete secret: ${deleteErr.message}`);
            process.exit(1);

        }

        outputResult(
            args,
            { success: true, configName, key: args.key },
            `Secret "${args.key}" removed from config "${configName}".`,
        );

        process.exit(0);

    },
});

(rmCommand as typeof rmCommand & { examples: string[] }).examples = [
    'noorm secret rm OLD_KEY --yes',
    'noorm secret rm OLD_KEY --yes --config prod',
    'noorm secret rm OLD_KEY --yes --json',
];

export default rmCommand;
