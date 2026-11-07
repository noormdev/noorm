import { defineCommand } from 'citty';
import { getEnvConfig } from '../../core/config/index.js';
import { materializeStage } from '../../core/config/stage.js';
import { checkConfigPolicy, resolveChannel } from '../../core/policy/index.js';
import { getSettingsManager } from '../../core/settings/index.js';
import { initState } from '../../core/state/index.js';
import { outputError, outputResult, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

export default defineCommand({
    meta: { name: 'create', description: 'Create stored configurations from stage defaults without connecting' },
    args: {
        all: { type: 'boolean', description: 'Create one config for every stage' },
        stage: { type: 'string', description: 'Stage to materialize' },
        name: { type: 'string', description: 'Stored config name (defaults to stage name)' },
        dialect: { type: 'string', description: 'Database dialect' },
        host: { type: 'string', description: 'Database host' },
        port: { type: 'string', description: 'Database port' },
        database: { type: 'string', description: 'Database name' },
        user: { type: 'string', description: 'Database user' },
        password: { type: 'string', description: 'Explicitly persist this password' },
        force: sharedArgs.force, yes: sharedArgs.yes, json: sharedArgs.json,
    },
    async run({ args }) {

        try {

            const hasOverrides = Boolean(
                args.stage || args.name || args.password !== undefined ||
                args.dialect || args.host || args.port || args.database || args.user,
            );
            if (args.all ? hasOverrides : !args.stage) {

                throw new Error('Use --stage with optional --name and overrides, or --all alone');

            }
            const root = process.cwd();
            const settings = getSettingsManager(root);
            await settings.load();
            const state = await initState(root);
            if (!state.hasPrivateKey()) throw new Error('An identity private key is required to save configs');
            const stages = settings.getStages();
            const names = args.all ? Object.keys(stages) : [args.stage!];
            if (!names.length) throw new Error('No stages are defined');
            const env = args.all ? undefined : getEnvConfig();
            const flags = Object.fromEntries(Object.entries({
                dialect: args.dialect,
                host: args.host,
                port: args.port === undefined ? undefined : Number(args.port),
                database: args.database,
                user: args.user,
            }).filter(([, value]) => value !== undefined));
            const configs = names.map((stageName) => {

                const stage = stages[stageName];
                if (!stage) throw new Error(`Stage '${stageName}' not found`);
                const name = args.name ?? stageName;
                const existing = state.getConfig(name);
                if (existing) {

                    if (!args.force || !args.yes) throw new Error(`Config '${name}' exists; overwriting requires --force and --yes`);
                    const policy = checkConfigPolicy(resolveChannel(), existing, 'config:write');
                    if (!policy.allowed) throw new Error(policy.blockedReason ?? `Cannot overwrite '${name}'`);

                }

                return materializeStage(
                    name, stageName, stage.defaults ?? {},
                    { ...env, connection: { ...env?.connection, ...flags } }, args.password,
                );

            });
            for (const config of configs) await state.setConfig(config.name, config);
            outputResult(args, { success: true, names: configs.map((config) => config.name) }, `Created configs: ${configs.map((config) => config.name).join(', ')}`);

        }
        catch (error) {

            outputError(args, error instanceof Error ? error.message : 'Failed to create config');
            process.exit(EXIT.USAGE);

        }

    },
});
