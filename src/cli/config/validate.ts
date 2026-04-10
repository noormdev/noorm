/**
 * noorm config validate — validate a configuration can connect.
 *
 * Tests database connectivity and checks required fields. Mirrors
 * the TUI ConfigValidateScreen but for headless/CI use.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { testConnection } from '../../core/connection/factory.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

interface CheckResult {
    key: string;
    label: string;
    status: 'success' | 'error';
    detail: string;
}

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
            process.exit(1);

        }

        const checks: CheckResult[] = [];
        let valid = true;

        // Connection test
        const connResult = await testConnection(config.connection);

        checks.push({
            key: 'connection',
            label: 'Connection',
            status: connResult.ok ? 'success' : 'error',
            detail: connResult.ok ? 'Connection successful' : (connResult.error ?? 'Connection failed'),
        });

        if (!connResult.ok) valid = false;

        // Required fields
        const requiredChecks = [
            { key: 'name', label: 'Name', value: config.name },
            { key: 'database', label: 'Database', value: config.connection.database },
        ];

        for (const check of requiredChecks) {

            const isSet = Boolean(check.value);
            checks.push({
                key: check.key,
                label: check.label,
                status: isSet ? 'success' : 'error',
                detail: isSet ? check.value : 'Not set',
            });

            if (!isSet) valid = false;

        }

        // Host check for non-SQLite
        if (config.connection.dialect !== 'sqlite') {

            const hasHost = Boolean(config.connection.host);
            checks.push({
                key: 'host',
                label: 'Host',
                status: hasHost ? 'success' : 'error',
                detail: hasHost ? config.connection.host! : 'Not set',
            });

            if (!hasHost) valid = false;

        }

        // Output
        const statusText = valid ? 'VALID' : 'INVALID';
        const lines = checks.map((c) => {

            const icon = c.status === 'success' ? '+' : 'x';

            return `  [${icon}] ${c.label}: ${c.detail}`;

        });

        const text = `${args.name}: ${statusText}\n${lines.join('\n')}`;

        outputResult(args, { config: args.name, valid, checks }, text);
        process.exit(valid ? 0 : 1);

    },
});

(validateCommand as typeof validateCommand & { examples: string[] }).examples = [
    'noorm config validate dev',
    'noorm config validate production --json',
];

export default validateCommand;
