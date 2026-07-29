/**
 * noorm db create — create database if not exists.
 *
 * Creates the database and bootstraps noorm tracking tables.
 * Uses server-level connection so the target database need not exist yet.
 *
 * Gated by the config's `db:create` access: viewer is denied outright;
 * operator requires --yes to satisfy the matrix's confirmation requirement;
 * admin runs unconfirmed.
 */
import { attempt, attemptSync } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { getSettingsManager } from '../../core/settings/index.js';
import { resolveConfig, SettingsProvider } from '../../core/config/resolver.js';
import { checkDbStatus, createDb } from '../../core/db/index.js';
import { checkConfigPolicy } from '../../core/policy/index.js';
import { isYesMode, outputResult, outputError, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

const createCommand = defineCommand({
    meta: {
        name: 'create',
        description: 'Create database if not exists',
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
            process.exit(EXIT.USAGE);

        }

        if (!config) {

            outputError(args, 'No active configuration. Use: noorm config use <name>');
            process.exit(EXIT.USAGE);

        }

        const configName = config.name;

        // Gate before any probe touches the server: for SQLite, checkDbStatus
        // opens the target and so creates the file, which would hand a denied
        // role a database anyway.
        const check = checkConfigPolicy('user', config, 'db:create');

        if (!check.allowed) {

            outputError(args, check.blockedReason ?? `Config "${configName}" cannot be created.`);
            process.exit(1);

        }

        if (check.requiresConfirmation && !isYesMode(args)) {

            outputError(
                args,
                `This is a destructive operation requiring confirmation (${check.confirmationPhrase}). Pass --yes to confirm.`,
            );
            process.exit(1);

        }

        // Check current status
        const status = await checkDbStatus(config.connection);

        if (!status.serverOk) {

            outputError(args, `Cannot connect to server: ${status.error ?? 'Unknown error'}`);
            process.exit(1);

        }

        if (status.exists && status.trackingInitialized) {

            outputResult(
                args,
                { config: configName, database: config.connection.database, created: false, alreadyExists: true },
                `Database "${config.connection.database}" already exists and is initialized.`,
            );
            process.exit(0);

        }

        // Create database
        const result = await createDb(config.connection, configName, {
            precheckedStatus: status,
            policy: { configName, access: config.access, yes: isYesMode(args) },
        });

        if (!result.ok) {

            outputError(args, `Failed to create database: ${result.error ?? 'Unknown error'}`);
            process.exit(1);

        }

        outputResult(
            args,
            {
                config: configName,
                database: config.connection.database,
                created: result.created ?? false,
                trackingInitialized: result.trackingInitialized ?? false,
            },
            `Database "${config.connection.database}" created and initialized.`,
        );
        process.exit(0);

    },
});

(createCommand as typeof createCommand & { examples: string[] }).examples = [
    'noorm db create',
    'noorm db create -c dev',
    'noorm db create --yes',
    'noorm db create --json',
];

export default createCommand;
