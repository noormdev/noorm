/**
 * noorm vault set <key> [value] — set a vault secret.
 */
import { defineCommand } from 'citty';

import { withVaultContext, sharedArgs, isYesMode } from '../_utils.js';
import { readSecretValue } from './_secret-value.js';
import { getVaultKeyChecked, setVaultSecretChecked, checkVaultPolicy } from '../../core/vault/index.js';
import type { VaultPolicyGate } from '../../core/vault/index.js';

const setCommand = defineCommand({
    meta: {
        name: 'set',
        description: 'Set a vault secret',
    },
    args: {
        key: { type: 'positional', description: 'Secret key name', required: true },
        value: { type: 'positional', description: 'Secret value (omit with --stdin)', required: false },
        stdin: { type: 'boolean', description: 'Read the value from stdin instead of argv' },
        config: sharedArgs.config,
        json: sharedArgs.json,
        yes: sharedArgs.yes,
    },
    async run({ args }) {

        const [value, valueErr] = await readSecretValue(args);

        if (valueErr) {

            process.stderr.write(`Error: ${valueErr.message}\n`);
            process.exit(1);

        }

        const [result, err] = await withVaultContext({
            args,
            fn: async ({ ctx, cryptoIdentity, privateKey }) => {

                const db = ctx.kysely;
                const config = ctx.noorm.config;
                const gate: VaultPolicyGate = {
                    configName: config.name,
                    access: config.access,
                    channel: 'user',
                };

                const check = checkVaultPolicy(gate, 'vault:write');

                if (!check.allowed) {

                    return {
                        success: false,
                        error: check.blockedReason ?? `Cannot write the vault on config "${config.name}".`,
                    };

                }

                if (check.requiresConfirmation && !isYesMode(args)) {

                    return {
                        success: false,
                        error: `Writing the vault on config "${config.name}" requires confirmation `
                            + `(${check.confirmationPhrase}). Pass --yes to confirm.`,
                    };

                }

                const vaultKey = await getVaultKeyChecked(gate, db, cryptoIdentity.identityHash, privateKey, ctx.dialect);

                if (!vaultKey) {

                    return {
                        success: false,
                        error: 'No vault access. Run "noorm vault init" or wait for propagation.',
                    };

                }

                const [, setErr] = await setVaultSecretChecked(
                    gate,
                    db,
                    vaultKey,
                    args.key,
                    value as string,
                    cryptoIdentity.email,
                    ctx.dialect,
                );

                if (setErr) {

                    return { success: false, error: setErr.message };

                }

                return { success: true, key: args.key, action: 'set' };

            },
        });

        if (err) {

            process.exit(1);

        }

        if (args.json) {

            process.stdout.write(JSON.stringify(result) + '\n');

        }
        else if (result?.success) {

            process.stdout.write(`Vault secret "${args.key}" set successfully\n`);

        }
        else {

            process.stderr.write(`Error: ${result?.error ?? 'Unknown error'}\n`);

        }

        process.exit(result?.success ? 0 : 1);

    },
});

(setCommand as typeof setCommand & { examples: string[] }).examples = [
    'noorm vault set API_KEY "sk-live-..."',
    'echo "$API_KEY" | noorm vault set API_KEY --stdin',
    'noorm vault set API_KEY "sk-live-..." --json',
];

export default setCommand;
