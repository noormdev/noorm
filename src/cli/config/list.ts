/**
 * noorm config list — list all available configurations.
 *
 * Reads encrypted state and displays config summaries with dialect,
 * database, and active status. No database connection required.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
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
        const configs = stateManager.listConfigs();

        if (configs.length === 0) {

            outputResult(args, { configs: [] }, 'No configurations found.');
            process.exit(0);

        }

        const lines = configs.map((c) => {

            const active = c.isActive ? ' (active)' : '';
            const flags = [
                c.isTest ? 'test' : null,
                c.protected ? 'protected' : null,
            ].filter(Boolean).join(', ');
            const suffix = flags ? ` [${flags}]` : '';

            return `  ${c.name}${active} — ${c.dialect}/${c.database}${suffix}`;

        });

        outputResult(
            args,
            { configs },
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
