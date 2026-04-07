/**
 * noorm vault set <key> <value> — set a vault secret.
 */
import { defineCommand } from 'citty';

import { withVaultContext, sharedArgs } from '../_utils.js';
import { getVaultKey, setVaultSecret } from '../../core/vault/index.js';

const setCommand = defineCommand({
    meta: {
        name: 'set',
        description: 'Set a vault secret',
    },
    args: {
        key: { type: 'positional', description: 'Secret key name', required: true },
        value: { type: 'positional', description: 'Secret value', required: true },
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [result, err] = await withVaultContext({
            args,
            fn: async ({ ctx, cryptoIdentity, privateKey }) => {

                const db = ctx.kysely;
                const vaultKey = await getVaultKey(db, cryptoIdentity.identityHash, privateKey, ctx.dialect);

                if (!vaultKey) {

                    return {
                        success: false,
                        error: 'No vault access. Run "noorm vault init" or wait for propagation.',
                    };

                }

                const [, setErr] = await setVaultSecret(
                    db,
                    vaultKey,
                    args.key,
                    args.value,
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
    'noorm vault set DB_PASSWORD "secret123"',
    'noorm vault set API_KEY "sk-live-..." --json',
];

export default setCommand;
