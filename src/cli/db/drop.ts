/**
 * noorm db drop — drop the entire database.
 *
 * Destructive operation that drops the database associated with the
 * active (or specified) configuration. Gated by the config's `db:destroy`
 * access: viewer/operator are denied outright; admin requires --yes to
 * satisfy the matrix's confirmation requirement.
 */
import { attempt, attemptSync } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { getSettingsManager } from '../../core/settings/index.js';
import { resolveConfig, SettingsProvider } from '../../core/config/resolver.js';
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
        const settingsManager = getSettingsManager(projectRoot);

        const [, settingsErr] = await attempt(() => settingsManager.load());

        if (settingsErr) {

            outputError(args, `Failed to load settings: ${settingsErr.message}`);
            process.exit(1);

        }

        // resolveConfig merges DEFAULTS <- stage <- stored <- env <- flags, the
        // same path every other connecting command reaches via withContext, so
        // NOORM_CONNECTION_* outranks a persisted config here too.
        const [config, resolveErr] = attemptSync(() => resolveConfig(stateManager, {
            name: args.config,
            settings: new SettingsProvider(settingsManager),
        }));

        if (resolveErr) {

            outputError(args, resolveErr.message);
            process.exit(1);

        }

        if (!config) {

            outputError(args, 'No active configuration. Use: noorm config use <name>');
            process.exit(1);

        }

        const configName = config.name;

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
