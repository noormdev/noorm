/**
 * noorm secret set <key> [value] — store a secret for the active or named config.
 *
 * Secrets are encrypted in state and scoped to a specific config.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { outputResult, outputError, sharedArgs, isYesMode } from '../_utils.js';
import { readSecretValue } from '../vault/_secret-value.js';
import { resolveSecretPolicy } from './_policy.js';

const setCommand = defineCommand({
    meta: {
        name: 'set',
        description: 'Set a secret for a config',
    },
    args: {
        key: { type: 'positional', description: 'Secret key name', required: true },
        value: { type: 'positional', description: 'Secret value (omit with --stdin)', required: false },
        stdin: { type: 'boolean', description: 'Read the value from stdin instead of argv' },
        config: sharedArgs.config,
        json: sharedArgs.json,
        yes: sharedArgs.yes,
    },
    async run({ args }) {

        const [value, valueErr] = await readSecretValue(args);

        if (valueErr) {

            outputError(args, valueErr.message);
            process.exit(1);

        }

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

        const { configName, check } = resolved;

        if (check.requiresConfirmation && !isYesMode(args)) {

            outputError(
                args,
                `Writing a secret to config "${configName}" requires confirmation (${check.confirmationPhrase}). Pass --yes to confirm.`,
            );
            process.exit(1);

        }

        const [, setErr] = await attempt(() =>
            stateManager.setSecret(configName, args.key, value as string),
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
    'echo "$API_KEY" | noorm secret set API_KEY --stdin',
    'noorm secret set DB_PASSWORD "secret123" --config prod',
    'noorm secret set API_KEY "sk-live-..." --json',
];

export default setCommand;
