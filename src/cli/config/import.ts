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

import type { Config } from '../../core/config/types.js';
import { initState, getStateManager } from '../../core/state/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

/**
 * Parse and validate a raw JSON value as a Config.
 *
 * Returns the typed Config when the required fields are present,
 * or null when validation fails. Does not throw.
 */
function parseConfig(value: unknown): Config | null {

    if (!value || typeof value !== 'object') {

        return null;

    }

    const obj = value as Record<string, unknown>;

    if (!obj['name'] || typeof obj['name'] !== 'string') {

        return null;

    }

    if (!obj['connection'] || typeof obj['connection'] !== 'object') {

        return null;

    }

    return obj as unknown as Config;

}

const importCommand = defineCommand({
    meta: {
        name: 'import',
        description: 'Import a configuration from a JSON file',
    },
    args: {
        path: { type: 'positional', description: 'Path to JSON config file', required: true },
        force: sharedArgs.force,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const projectRoot = process.cwd();

        const [raw, readErr] = await attempt(() => readFile(args.path, 'utf8'));

        if (readErr || !raw) {

            outputError(args, `Failed to read file: ${readErr?.message ?? 'empty file'}`);
            process.exit(1);

        }

        const [jsonValue, parseErr] = attemptSync(() => JSON.parse(raw));

        if (parseErr) {

            outputError(args, `Invalid JSON: ${parseErr.message}`);
            process.exit(1);

        }

        const config = parseConfig(jsonValue);

        if (!config) {

            outputError(args, 'Config JSON is missing required fields: name, connection');
            process.exit(1);

        }

        const [, initErr] = await attempt(() => initState(projectRoot));

        if (initErr) {

            outputError(args, `Failed to load state: ${initErr.message}`);
            process.exit(1);

        }

        const stateManager = getStateManager(projectRoot);
        const existing = stateManager.getConfig(config.name);

        if (existing && !args.force) {

            outputError(args, `Config '${config.name}' already exists. Use --force to overwrite.`);
            process.exit(1);

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
    'noorm config import ./staging-config.json --force',
];

export default importCommand;
