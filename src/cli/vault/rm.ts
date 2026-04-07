/**
 * noorm vault rm <key> — remove a vault secret.
 */
import { defineCommand } from 'citty';

import { withVaultContext, sharedArgs } from '../_utils.js';
import { getVaultKey, deleteVaultSecret, vaultSecretExists } from '../../core/vault/index.js';

const rmCommand = defineCommand({
    meta: {
        name: 'rm',
        description: 'Remove a vault secret',
    },
    args: {
        key: { type: 'positional', description: 'Secret key name to remove', required: true },
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

                const exists = await vaultSecretExists(db, args.key, ctx.dialect);

                if (!exists) {

                    return { success: false, error: `Secret "${args.key}" not found in vault` };

                }

                const [deleted, deleteErr] = await deleteVaultSecret(db, args.key, ctx.dialect);

                if (deleteErr) {

                    return { success: false, error: deleteErr.message };

                }

                return { success: true, key: args.key, deleted };

            },
        });

        if (err) {

            process.exit(1);

        }

        if (args.json) {

            process.stdout.write(JSON.stringify(result) + '\n');

        }
        else if (result?.success) {

            process.stdout.write(`Vault secret "${args.key}" deleted\n`);

        }
        else {

            process.stderr.write(`Error: ${result?.error ?? 'Unknown error'}\n`);

        }

        process.exit(result?.success ? 0 : 1);

    },
});

(rmCommand as typeof rmCommand & { examples: string[] }).examples = [
    'noorm vault rm OLD_API_KEY',
    'noorm vault rm OLD_API_KEY --json',
    'noorm vault rm OLD_API_KEY -c prod',
];

export default rmCommand;
