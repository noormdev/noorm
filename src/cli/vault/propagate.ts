/**
 * noorm vault propagate — propagate vault access to new users.
 */
import { defineCommand } from 'citty';

import { withVaultContext, sharedArgs } from '../_utils.js';
import {
    getVaultKey,
    propagateVaultKey,
    getUsersWithoutVaultAccess,
} from '../../core/vault/index.js';

const propagateCommand = defineCommand({
    meta: {
        name: 'propagate',
        description: 'Propagate vault access to new users',
    },
    args: {
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

                const usersWithout = await getUsersWithoutVaultAccess(db, ctx.dialect);

                if (usersWithout.length === 0) {

                    return {
                        success: true,
                        propagatedTo: [] as string[],
                        message: 'All users already have vault access',
                    };

                }

                const propagateResult = await propagateVaultKey(db, vaultKey, ctx.dialect);

                return {
                    success: true,
                    propagatedTo: propagateResult.propagatedTo,
                    alreadyHadAccess: propagateResult.alreadyHadAccess,
                };

            },
        });

        if (err) {

            process.exit(1);

        }

        if (args.json) {

            process.stdout.write(JSON.stringify(result) + '\n');

        }
        else if (result?.success) {

            const propagated = result.propagatedTo ?? [];

            if (propagated.length === 0) {

                process.stdout.write(`${result.message ?? 'All users already have vault access'}\n`);

            }
            else {

                process.stdout.write(`Granted vault access to ${propagated.length} users\n`);

                for (const hash of propagated) {

                    process.stdout.write(`  ${hash}\n`);

                }

            }

        }
        else {

            process.stderr.write(`Error: ${result?.error ?? 'Unknown error'}\n`);

        }

        process.exit(result?.success ? 0 : 1);

    },
});

(propagateCommand as typeof propagateCommand & { examples: string[] }).examples = [
    'noorm vault propagate',
    'noorm vault propagate --json',
    'noorm vault propagate -c prod',
];

export default propagateCommand;
