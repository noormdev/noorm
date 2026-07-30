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
import { checkConfigPolicy, resolveChannel } from '../../core/policy/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

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
            process.exit(EXIT.USAGE);

        }

        if (!config) {

            outputError(args, 'No active configuration. Use: noorm config use <name>');
            process.exit(EXIT.USAGE);

        }

        const configName = config.name;

        // The role is a statement about a *config*; NOORM_CONNECTION_* can
        // repoint that config at any database the credentials reach, so the
        // thing being authorised and the thing being destroyed can differ.
        // The retargeting is deliberate (#51) — going silent about it is not.
        const stored = stateManager.getConfig(configName);
        const storedDatabase = stored?.connection?.database;
        const target = config.connection.database;

        const targetOverridden = Boolean(storedDatabase && storedDatabase !== target);

        if (targetOverridden) {

            // stderr, so a --json consumer's stdout stays parseable.
            process.stderr.write(
                `Warning: config "${configName}" stores database "${storedDatabase}", but "${target}" is what will be dropped.\n`,
            );

        }

        const check = checkConfigPolicy(resolveChannel(), config, 'db:destroy');

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

        // The gate above produces the operator-facing message; passing the
        // policy on re-checks it at the core seam, so a future caller that
        // forgets its own gate still cannot drop a database.
        const result = await destroyDb(config.connection, configName, {
            policy: { configName, access: config.access, yes: args.yes },
        });

        if (!result.ok) {

            outputError(args, `Failed to drop database: ${result.error ?? 'Unknown error'}`);
            process.exit(1);

        }

        const dropped = result.dropped ?? false;

        outputResult(
            args,
            {
                config: configName,
                database: config.connection.database,
                dropped,
                ...(targetOverridden ? { targetOverridden, storedDatabase } : {}),
            },
            dropped
                ? `Database "${config.connection.database}" dropped.`
                : `Database "${config.connection.database}" did not exist — nothing to drop.`,
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
