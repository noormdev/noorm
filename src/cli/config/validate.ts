/**
 * noorm config validate — validate a configuration can connect.
 *
 * Tests database connectivity and checks required fields. Mirrors
 * the TUI ConfigValidateScreen but for headless/CI use.
 */
import { attempt, attemptSync } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { validateConfigChecks } from '../../core/config/validate.js';
import { resolveConfig } from '../../core/config/resolver.js';
import { SettingsProvider } from '../../core/config/resolver.js';
import { getSettingsManager } from '../../core/settings/index.js';
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

        const settings = getSettingsManager(projectRoot);
        const [, settingsErr] = await attempt(() => settings.load());
        if (settingsErr) {

            outputError(args, `Failed to load settings: ${settingsErr.message}`);
            process.exit(EXIT.USAGE);

        }
        const [effective, resolveErr] = attemptSync(() => resolveConfig(stateManager, { name: args.name, settings: new SettingsProvider(settings) }));
        if (resolveErr || !effective) {

            outputError(args, `Failed to resolve config: ${resolveErr?.message ?? 'not found'}`);
            process.exit(EXIT.USAGE);

        }
        const { checks, valid } = await validateConfigChecks(effective);
        const password = effective.connection.password;
        if (password) {

            for (const check of checks) check.detail = check.detail.split(password).join('[redacted]');

        }

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
