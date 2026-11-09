import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';
import { getEnvConfig } from '../../core/config/index.js';
import { SettingsProvider, validateAccessRoles, withConfigPolicy } from '../../core/config/resolver.js';
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
        force: sharedArgs.force,
        yes: sharedArgs.yes,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [, error] = await attempt(async () => {

            if (resolveChannel() === 'agent') {

                throw new Error('Creating configs from stages is only available on the user channel');

            }

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

            if (!state.hasPrivateKey()) {

                throw new Error('An identity private key is required to save configs');

            }

            const stages = settings.getStages();
            const names = args.all ? Object.keys(stages) : [args.stage!];

            if (!names.length) {

                throw new Error('No stages are defined');

            }

            const env = args.all ? undefined : getEnvConfig();
            const flagEntries = Object.entries({
                dialect: args.dialect,
                host: args.host,
                port: args.port === undefined ? undefined : Number(args.port),
                database: args.database,
                user: args.user,
            });
            const flags = Object.fromEntries(flagEntries.filter(([, value]) => value !== undefined));

            const configs = names.map((stageName) => {

                const stage = stages[stageName];

                if (!stage) {

                    throw new Error(`Stage '${stageName}' not found`);

                }

                const config = materializeStage(
                    args.name ?? stageName,
                    stageName,
                    stage.defaults ?? {},
                    { connection: { ...env?.connection, ...flags } },
                    args.password,
                );
                validateAccessRoles(config.access, settings.settings.access?.roles);
                const existing = state.getConfig(config.name);

                if (existing) {

                    if (!args.force || !args.yes) {

                        throw new Error(`Config '${config.name}' exists; overwriting requires --force and --yes`);

                    }

                    const policy = checkConfigPolicy(resolveChannel(), withConfigPolicy(existing, new SettingsProvider(settings)), 'config:write');

                    if (!policy.allowed) {

                        throw new Error(policy.blockedReason ?? `Cannot overwrite '${config.name}'`);

                    }

                }

                return config;

            });

            for (const config of configs) {

                await state.setConfig(config.name, config);

            }

            const createdNames = configs.map((config) => config.name);
            outputResult(args, { success: true, names: createdNames }, `Created configs: ${createdNames.join(', ')}`);

        });

        if (error) {

            outputError(args, error.message);
            process.exit(EXIT.USAGE);

        }

    },
});
