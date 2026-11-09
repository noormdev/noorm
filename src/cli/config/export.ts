/**
 * noorm config export — export a configuration to JSON.
 *
 * Writes the full config object (including sensitive fields) to stdout
 * or to a file when --output is provided. Intended for backup and
 * cross-machine transfer workflows where the user explicitly owns the data.
 */
import { chmod, writeFile } from 'node:fs/promises';

import { attempt, attemptSync } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { checkConfigPolicy, resolveChannel } from '../../core/policy/index.js';
import { SettingsProvider, withConfigPolicy } from '../../core/config/resolver.js';
import { getSettingsManager } from '../../core/settings/index.js';
import { initState, getStateManager } from '../../core/state/index.js';
import { outputError, outputResult, sharedArgs, isYesMode } from '../_utils.js';
import { EXIT } from '../_exit.js';

const exportCommand = defineCommand({
    meta: {
        name: 'export',
        description: 'Export a configuration to JSON',
    },
    args: {
        name: { type: 'positional', description: 'Config name to export', required: true },
        output: { type: 'string', alias: 'o', description: 'Write output to file instead of stdout' },
        json: sharedArgs.json,
        yes: sharedArgs.yes,
    },
    async run({ args }) {

        const projectRoot = process.cwd();

        const [, initErr] = await attempt(() => initState(projectRoot));

        if (initErr) {

            outputError(args, `Failed to load state: ${initErr.message}`);
            process.exit(EXIT.FAILURE);

        }

        const stateManager = getStateManager(projectRoot);
        const config = stateManager.getConfig(args.name);

        if (!config) {

            outputError(args, `Config not found: ${args.name}`);
            process.exit(EXIT.USAGE);

        }

        const settingsManager = getSettingsManager(projectRoot);
        const [, settingsErr] = await attempt(() => settingsManager.load());

        if (settingsErr) {

            outputError(args, `Failed to load settings: ${settingsErr.message}`);
            process.exit(EXIT.FAILURE);

        }

        const [policyConfig, policyErr] = attemptSync(() =>
            withConfigPolicy(config, new SettingsProvider(settingsManager)),
        );

        if (policyErr) {

            outputError(args, policyErr.message);
            process.exit(EXIT.USAGE);

        }

        // The export carries the connection password in plaintext, so it is
        // a secret read — a viewer role that is denied `config:rm` must not
        // be able to walk away with the credential instead.
        const check = checkConfigPolicy(resolveChannel(), policyConfig, 'secret:read');

        if (!check.allowed) {

            outputError(args, check.blockedReason ?? `Config "${args.name}" cannot be exported.`);
            process.exit(EXIT.FAILURE);

        }

        if (check.requiresConfirmation && !isYesMode(args)) {

            outputError(args, `Exporting config "${args.name}" requires confirmation (${check.confirmationPhrase}). Pass --yes to confirm.`);
            process.exit(EXIT.FAILURE);

        }

        const json = JSON.stringify(config, null, 4);

        if (args.output) {

            const [, writeErr] = await attempt(() =>
                writeFile(args.output as string, json, { encoding: 'utf8', mode: 0o600 }),
            );

            if (writeErr) {

                outputError(args, `Failed to write file: ${writeErr.message}`);
                process.exit(EXIT.FAILURE);

            }

            // Ensure permissions are correct (writeFile mode may not work on all platforms)
            await attempt(() => chmod(args.output as string, 0o600));

            outputResult(
                args,
                { name: args.name, output: args.output },
                `Config '${args.name}' exported to ${args.output}`,
            );

        }
        else if (args.json) {

            // `--json` gets the envelope like every other command. The bare
            // artifact — the shape `config import` reads — stays on the
            // default path, so `config export dev > dev.json` is unchanged.
            outputResult(args, { name: args.name, config }, '');

        }
        else {

            process.stdout.write(json + '\n');

        }

        process.exit(EXIT.SUCCESS);

    },
});

(exportCommand as typeof exportCommand & { examples: string[] }).examples = [
    'noorm config export dev',
    'noorm config export dev --output ./dev-config.json',
];

export default exportCommand;
