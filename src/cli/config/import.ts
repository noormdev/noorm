/**
 * noorm config import — import a configuration from a JSON file.
 *
 * Reads a JSON file previously created by `config export`, validates
 * the required fields, and saves it to state. Refuses to overwrite an
 * existing config unless --force is provided.
 */
import { readFile } from 'node:fs/promises';

import { attempt, attemptSync } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { ConfigValidationError, parseConfig } from '../../core/config/schema.js';
import { checkConfigPolicy, resolveChannel } from '../../core/policy/index.js';
import { initState, getStateManager } from '../../core/state/index.js';
import { outputResult, outputError, sharedArgs, isYesMode } from '../_utils.js';
import { EXIT } from '../_exit.js';

const importCommand = defineCommand({
    meta: {
        name: 'import',
        description: 'Import a configuration from a JSON file',
    },
    args: {
        path: { type: 'positional', description: 'Path to JSON config file', required: true },
        force: sharedArgs.force,
        yes: sharedArgs.yes,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const projectRoot = process.cwd();

        const [raw, readErr] = await attempt(() => readFile(args.path, 'utf8'));

        if (readErr || !raw) {

            outputError(args, `Failed to read file: ${readErr?.message ?? 'empty file'}`);
            process.exit(EXIT.USAGE);

        }

        const [jsonValue, parseErr] = attemptSync(() => JSON.parse(raw));

        if (parseErr) {

            outputError(args, `Invalid JSON: ${parseErr.message}`);
            process.exit(EXIT.USAGE);

        }

        const [config, configErr] = attemptSync(() => parseConfig(jsonValue));

        if (configErr) {

            const message = configErr instanceof ConfigValidationError
                ? configErr.message
                : 'Config JSON is missing required fields: name, connection';

            outputError(args, message);
            process.exit(EXIT.USAGE);

        }

        const [, initErr] = await attempt(() => initState(projectRoot));

        if (initErr) {

            outputError(args, `Failed to load state: ${initErr.message}`);
            process.exit(1);

        }

        const stateManager = getStateManager(projectRoot);
        const existing = stateManager.getConfig(config.name);

        if (existing) {

            if (!args.force) {

                outputError(args, `Config '${config.name}' already exists. Use --force to overwrite.`);
                process.exit(1);

            }

            // An overwrite rewrites `access` wholesale, so the config being
            // replaced decides — not the incoming file. Without this, one
            // --force promotes a viewer config to admin, or flips the
            // `agent: false` invisibility an operator set deliberately.
            const check = checkConfigPolicy(resolveChannel(), existing, 'config:write');

            if (!check.allowed) {

                outputError(args, check.blockedReason ?? `Config '${config.name}' cannot be overwritten.`);
                process.exit(1);

            }

            if (check.requiresConfirmation && !isYesMode(args)) {

                outputError(
                    args,
                    `Overwriting '${config.name}' rewrites its access roles and requires confirmation `
                    + `(${check.confirmationPhrase}). Pass --yes to confirm.`,
                );
                process.exit(1);

            }

        }

        const [, saveErr] = await attempt(() => stateManager.setConfig(config.name, config));

        if (saveErr) {

            outputError(args, `Failed to save config: ${saveErr.message}`);
            process.exit(1);

        }

        outputResult(
            args,
            { success: true, name: config.name, overwritten: !!existing },
            `Imported config '${config.name}'${existing ? ' (overwritten)' : ''}.`,
        );
        process.exit(0);

    },
});

(importCommand as typeof importCommand & { examples: string[] }).examples = [
    'noorm config import ./dev-config.json',
    'noorm config import ./staging-config.json --force --yes',
];

export default importCommand;
