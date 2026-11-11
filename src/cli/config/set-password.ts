/** noorm config set-password <name> [value]: replace a stored config's password, for rotation jobs. */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { outputResult, outputError, sharedArgs, isYesMode } from '../_utils.js';
import { readSecretValue } from '../vault/_secret-value.js';
import { resolveSecretPolicy } from '../secret/_policy.js';
import { EXIT } from '../_exit.js';

const setPasswordCommand = defineCommand({
    meta: {
        name: 'set-password',
        description: 'Set the database password of a stored config',
    },
    args: {
        name: { type: 'positional', description: 'Config name', required: true },
        value: { type: 'positional', description: 'New password (omit with --stdin)', required: false },
        stdin: { type: 'boolean', description: 'Read the password from stdin instead of argv' },
        json: sharedArgs.json,
        yes: sharedArgs.yes,
    },
    async run({ args }) {

        const [password, passwordErr] = await readSecretValue(args);

        if (passwordErr) {

            outputError(args, passwordErr.message);
            process.exit(1);

        }

        // A rotation script whose variable came back empty must not wipe the stored password.
        if (password === '') {

            outputError(args, 'The new password is empty.');
            process.exit(1);

        }

        const projectRoot = process.cwd();
        const [, initErr] = await attempt(() => initState(projectRoot));

        if (initErr) {

            outputError(args, `Failed to load state: ${initErr.message}`);
            process.exit(1);

        }

        const stateManager = getStateManager(projectRoot);
        const accessError = stateManager.getConfigAccessError(args.name);

        if (accessError) {

            outputError(args, accessError);
            process.exit(EXIT.USAGE);

        }

        if (!stateManager.getConfig(args.name)) {

            outputError(args, `Config "${args.name}" not found.`);
            process.exit(EXIT.USAGE);

        }

        const resolved = await resolveSecretPolicy(stateManager, args.name, 'config:write', projectRoot);

        if (!resolved.ok) {

            outputError(args, resolved.error);
            process.exit(1);

        }

        const { configName, check } = resolved;
        const config = stateManager.getConfig(configName);

        if (!config) {

            outputError(args, `Config "${configName}" not found.`);
            process.exit(EXIT.USAGE);

        }

        if (config.connection.dialect === 'sqlite') {

            outputError(args, `Config "${configName}" uses SQLite, which has no password.`);
            process.exit(1);

        }

        if (check.requiresConfirmation && !isYesMode(args)) {

            outputError(
                args,
                `Changing the password of config "${configName}" requires confirmation (${check.confirmationPhrase}). Pass --yes to confirm.`,
            );
            process.exit(1);

        }

        const [, saveErr] = await attempt(() =>
            stateManager.setConfig(configName, {
                ...config,
                connection: { ...config.connection, password: password as string },
            }),
        );

        if (saveErr) {

            outputError(args, `Failed to save config: ${saveErr.message}`);
            process.exit(1);

        }

        outputResult(
            args,
            { success: true, name: configName },
            `Password set for config "${configName}".`,
        );

        process.exit(0);

    },
});

(setPasswordCommand as typeof setPasswordCommand & { examples: string[] }).examples = [
    'echo "$NEW_PASSWORD" | noorm config set-password prod --stdin --yes',
    'noorm config set-password staging "s3cret" --yes',
    'noorm config set-password prod --stdin --yes --json < ./new-password.txt',
];

export default setPasswordCommand;
