/**
 * noorm db drop — drop the entire database.
 *
 * Destructive operation that drops the database associated with the
 * active (or specified) configuration. Gated by the config's `db:destroy`
 * access: viewer/operator are denied outright; admin requires --yes to
 * satisfy the matrix's confirmation requirement.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { destroyDb } from '../../core/db/index.js';
import { checkConfigPolicy } from '../../core/policy/index.js';
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

        const check = checkConfigPolicy('user', config, 'db:destroy');

        if (!check.allowed) {

            outputError(args, check.blockedReason ?? `Config "${configName}" cannot be dropped.`);
            process.exit(1);

        }

        if (check.requiresConfirmation && !args.yes) {

            outputError(
                args,
                `This is a destructive operation requiring confirmation (${check.confirmationPhrase}). Pass --yes to confirm.`,
            );
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
