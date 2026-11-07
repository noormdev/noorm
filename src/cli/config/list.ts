/**
 * noorm config list — list all available configurations.
 *
 * Reads encrypted state and displays config summaries with dialect,
 * database, and active status. No database connection required.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { formatAccessTag, getConfigPermission, isVisibleToChannel, MATRIX, resolveChannel } from '../../core/policy/index.js';
import type { Permission } from '../../core/policy/index.js';
import { SettingsProvider, withConfigPolicy } from '../../core/config/resolver.js';
import { getSettingsManager } from '../../core/settings/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

const listCommand = defineCommand({
    meta: {
        name: 'list',
        description: 'List available configurations',
    },
    args: {
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

        // Mirrors the `list_configs` RPC command: `access.agent === false`
        // means the config does not exist as far as an agent is concerned.
        // Filtering only over MCP would have made the setting worthless the
        // moment the agent ran `noorm config list` instead.
        const channel = resolveChannel();
        const configs = stateManager.listConfigs().filter((c) => isVisibleToChannel(c.access, channel));

        if (configs.length === 0) {

            outputResult(args, { configs: [] }, 'No configurations found.');
            process.exit(0);

        }

        const lines = configs.map((c) => {

            const active = c.isActive ? ' (active)' : '';
            const accessTag = formatAccessTag(c);
            const flags = [
                c.isTest ? 'test' : null,
                accessTag,
            ].filter(Boolean).join(', ');
            const suffix = flags ? ` [${flags}]` : '';

            return `  ${c.name}${active} — ${c.dialect}/${c.database}${suffix}`;

        });

        let resultConfigs: unknown[] = configs;

        if (args.json) {

            const settingsManager = getSettingsManager(projectRoot);
            const [, settingsErr] = await attempt(() => settingsManager.load());
            if (settingsErr) {

                outputError(args, `Failed to load settings: ${settingsErr.message}`);
                process.exit(1);

            }

            const provider = new SettingsProvider(settingsManager);
            resultConfigs = configs.map((summary) => {

                const stored = stateManager.getConfig(summary.name)!;
                const config = withConfigPolicy(stored, provider, false);
                const permissions = Object.keys(MATRIX) as Permission[];
                const effectivePermissions = Object.fromEntries(
                    (['user', 'agent'] as const).map((channel) => [
                        channel,
                        Object.fromEntries(permissions.map((permission) => [
                            permission,
                            getConfigPermission(channel, config, permission),
                        ])),
                    ]),
                );

                return { ...summary, effectivePermissions };

            });

        }

        outputResult(
            args,
            { configs: resultConfigs },
            `Configurations:\n${lines.join('\n')}`,
        );
        process.exit(0);

    },
});

(listCommand as typeof listCommand & { examples: string[] }).examples = [
    'noorm config list',
    'noorm config list --json',
];

export default listCommand;
