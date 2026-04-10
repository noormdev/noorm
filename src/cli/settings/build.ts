/**
 * noorm settings build — rebuild/normalize the settings.yml file.
 *
 * Loads the current settings and re-saves them, applying any missing
 * defaults and normalizing formatting. Useful after manual edits or
 * version upgrades that add new default fields.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { getSettingsManager } from '../../core/settings/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

const cmd = defineCommand({
    meta: { name: 'build', description: 'Rebuild/normalize settings.yml' },
    args: {
        json: sharedArgs.json,
    },
    async run({ args }) {

        const projectRoot = process.cwd();
        const settingsManager = getSettingsManager(projectRoot);

        const [, loadErr] = await attempt(() => settingsManager.load());

        if (loadErr) {

            outputError(args, `Failed to load settings: ${loadErr.message}`);
            process.exit(1);

        }

        const [, saveErr] = await attempt(() => settingsManager.save());

        if (saveErr) {

            outputError(args, `Failed to save settings: ${saveErr.message}`);
            process.exit(1);

        }

        outputResult(
            args,
            { success: true, path: settingsManager.settingsFilePath },
            `Settings rebuilt at ${settingsManager.settingsFilePath}`,
        );
        process.exit(0);

    },
});

(cmd as typeof cmd & { examples: string[] }).examples = [
    'noorm settings build',
];

export default cmd;
