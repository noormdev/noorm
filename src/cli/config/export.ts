/**
 * noorm config export — export a configuration to JSON.
 *
 * Writes the full config object (including sensitive fields) to stdout
 * or to a file when --output is provided. Intended for backup and
 * cross-machine transfer workflows where the user explicitly owns the data.
 */
import { chmod, writeFile } from 'node:fs/promises';

import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { outputError, sharedArgs } from '../_utils.js';

const exportCommand = defineCommand({
    meta: {
        name: 'export',
        description: 'Export a configuration to JSON',
    },
    args: {
        name: { type: 'positional', description: 'Config name to export', required: true },
        output: { type: 'string', alias: 'o', description: 'Write output to file instead of stdout' },
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

            outputError(args, `Config not found: ${args.name}`);
            process.exit(1);

        }

        const json = JSON.stringify(config, null, 4);

        if (args.output) {

            const [, writeErr] = await attempt(() =>
                writeFile(args.output as string, json, { encoding: 'utf8', mode: 0o600 }),
            );

            if (writeErr) {

                outputError(args, `Failed to write file: ${writeErr.message}`);
                process.exit(1);

            }

            // Ensure permissions are correct (writeFile mode may not work on all platforms)
            await attempt(() => chmod(args.output as string, 0o600));

            process.stdout.write(`Config '${args.name}' exported to ${args.output}\n`);

        }
        else {

            process.stdout.write(json + '\n');

        }

        process.exit(0);

    },
});

(exportCommand as typeof exportCommand & { examples: string[] }).examples = [
    'noorm config export dev',
    'noorm config export dev --output ./dev-config.json',
];

export default exportCommand;
