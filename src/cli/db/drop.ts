/**
 * noorm db drop — drop the entire database.
 *
 * Destructive operation that drops the database associated with the
 * active (or specified) configuration. Requires --yes flag for safety.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { destroyDb } from '../../core/db/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

const dropCommand = defineCommand({
    meta: {
        name: 'drop',
        description: 'Drop entire database',
    },
    args: {
        config: sharedArgs.config,
        yes: sharedArgs.yes,
        json: sharedArgs.json,
    },
    async run({ args }) {

        if (!args.yes) {

            outputError(args, 'This is a destructive operation. Pass --yes to confirm.');
            process.exit(1);

        }

        const projectRoot = process.cwd();

        const [, initErr] = await attempt(() => initState(projectRoot));

        if (initErr) {

            outputError(args, `Failed to load state: ${initErr.message}`);
            process.exit(1);

        }

        const stateManager = getStateManager(projectRoot);
        const configName = args.config ?? stateManager.getActiveConfigName();

        if (!configName) {

            outputError(args, 'No active configuration. Use: noorm config use <name>');
            process.exit(1);

        }

        const config = stateManager.getConfig(configName);

        if (!config) {

            outputError(args, `Config "${configName}" not found.`);
            process.exit(1);

        }

        if (config.protected) {

            outputError(args, `Config "${configName}" is protected. Cannot drop protected databases.`);
            process.exit(1);

        }

        const result = await destroyDb(config.connection, configName);

        if (!result.ok) {

            outputError(args, `Failed to drop database: ${result.error ?? 'Unknown error'}`);
            process.exit(1);

        }

        outputResult(
            args,
            { config: configName, database: config.connection.database, dropped: true },
            `Database "${config.connection.database}" dropped.`,
        );
        process.exit(0);

    },
});

(dropCommand as typeof dropCommand & { examples: string[] }).examples = [
    'noorm db drop --yes',
    'noorm db drop -c dev --yes',
    'noorm db drop --json --yes',
];

export default dropCommand;
