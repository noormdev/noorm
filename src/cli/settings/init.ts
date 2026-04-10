/**
 * noorm settings init — initialize settings.yml for the project.
 *
 * Creates a settings.yml with defaults in the project root.
 * If the file already exists, requires --force to overwrite.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { getSettingsManager } from '../../core/settings/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

const cmd = defineCommand({
    meta: { name: 'init', description: 'Initialize settings.yml' },
    args: {
        force: sharedArgs.force,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const projectRoot = process.cwd();
        const settingsManager = getSettingsManager(projectRoot);

        const [exists, existsErr] = await attempt(() => settingsManager.exists());

        if (existsErr) {

            outputError(args, `Failed to check settings: ${existsErr.message}`);
            process.exit(1);

        }

        if (exists && !args.force) {

            outputError(
                args,
                `settings.yml already exists at ${settingsManager.settingsFilePath}. Use --force to overwrite.`,
            );
            process.exit(1);

        }

        const [, initErr] = await attempt(() => settingsManager.init(args.force));

        if (initErr) {

            outputError(args, `Failed to initialize settings: ${initErr.message}`);
            process.exit(1);

        }

        outputResult(
            args,
            { success: true, path: settingsManager.settingsFilePath },
            `Settings initialized at ${settingsManager.settingsFilePath}`,
        );
        process.exit(0);

    },
});

(cmd as typeof cmd & { examples: string[] }).examples = [
    'noorm settings init',
    'noorm settings init --force',
];

export default cmd;
