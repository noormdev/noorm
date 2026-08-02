/**
 * noorm config validate — validate a configuration can connect.
 *
 * Tests database connectivity and checks required fields. Mirrors
 * the TUI ConfigValidateScreen but for headless/CI use.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { validateConfigChecks } from '../../core/config/validate.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

const validateCommand = defineCommand({
    meta: {
        name: 'validate',
        description: 'Validate configuration can connect',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Configuration name to validate',
            required: true,
        },
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
        const config = stateManager.getConfig(args.name);

        if (!config) {

            outputError(args, `Config "${args.name}" not found.`);
            process.exit(EXIT.USAGE);

        }

        const { checks, valid } = await validateConfigChecks(config);

        // Output
        const statusText = valid ? 'VALID' : 'INVALID';
        const lines = checks.map((c) => {

            const icon = c.status === 'success' ? '+' : 'x';

            return `  [${icon}] ${c.label}: ${c.detail}`;

        });

        const text = `${args.name}: ${statusText}\n${lines.join('\n')}`;

        // Explicit `success`: toJsonEnvelope derives it from a `status` field
        // and defaults to true, so an invalid config would report success:true
        // while exiting 1, and a CI job branching on .success would read a
        // failed validation as a pass.
        outputResult(args, { success: valid, config: args.name, valid, checks }, text);
        process.exit(valid ? 0 : 1);

    },
});

(validateCommand as typeof validateCommand & { examples: string[] }).examples = [
    'noorm config validate dev',
    'noorm config validate production --json',
];

export default validateCommand;
