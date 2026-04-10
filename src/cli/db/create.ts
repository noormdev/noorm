/**
 * noorm db create — create database if not exists.
 *
 * Creates the database and bootstraps noorm tracking tables.
 * Uses server-level connection so the target database need not exist yet.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { checkDbStatus, createDb } from '../../core/db/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

const createCommand = defineCommand({
    meta: {
        name: 'create',
        description: 'Create database if not exists',
    },
    args: {
        config: sharedArgs.config,
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
        const result = await createDb(config.connection, configName);

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
    'noorm db create --json',
];

export default createCommand;
