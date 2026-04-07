/**
 * noorm vault init — initialize the vault for the current database.
 */
import { defineCommand } from 'citty';

import { withVaultContext, sharedArgs } from '../_utils.js';
import { initializeVault, getVaultStatus } from '../../core/vault/index.js';

const initCommand = defineCommand({
    meta: {
        name: 'init',
        description: 'Initialize the vault for the current database',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [result, err] = await withVaultContext({
            args,
            fn: async ({ ctx, cryptoIdentity }) => {

                const db = ctx.kysely;
                const status = await getVaultStatus(db, cryptoIdentity.identityHash, ctx.dialect);

                if (status.isInitialized) {

                    if (status.hasAccess) {

                        return { success: true, message: 'Vault already initialized and you have access' };

                    }

                    return {
                        success: false,
                        message: 'Vault already initialized but you do not have access. Ask a team member to propagate.',
                    };

                }

                const [, initErr] = await initializeVault(
                    db,
                    cryptoIdentity.identityHash,
                    cryptoIdentity.publicKey,
                    ctx.dialect,
                );

                if (initErr) {

                    return { success: false, message: initErr.message };

                }

                return { success: true, message: 'Vault initialized successfully' };

            },
        });

        if (err) {

            process.exit(1);

        }

        if (args.json) {

            process.stdout.write(JSON.stringify(result) + '\n');

        }
        else if (result?.success) {

            process.stdout.write(`${result.message}\n`);

        }
        else {

            process.stderr.write(`Error: ${result?.message ?? 'Unknown error'}\n`);

        }

        process.exit(result?.success ? 0 : 1);

    },
});

(initCommand as typeof initCommand & { examples: string[] }).examples = [
    'noorm vault init',
    'noorm vault init --json',
    'noorm vault init -c prod',
];

export default initCommand;
