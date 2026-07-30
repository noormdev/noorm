/**
 * noorm vault rm <key> — remove a vault secret.
 */
import { defineCommand } from 'citty';

import { withVaultContext, outputResult, sharedArgs, isYesMode } from '../_utils.js';
import { EXIT } from '../_exit.js';
import { getVaultKeyChecked, deleteVaultSecretChecked, vaultSecretExists, checkVaultPolicy } from '../../core/vault/index.js';
import type { VaultPolicyGate } from '../../core/vault/index.js';
import { resolveChannel } from '../../core/policy/index.js';

const rmCommand = defineCommand({
    meta: {
        name: 'rm',
        description: 'Remove a vault secret',
    },
    args: {
        key: { type: 'positional', description: 'Secret key name to remove', required: true },
        config: sharedArgs.config,
        json: sharedArgs.json,
        yes: sharedArgs.yes,
    },
    async run({ args }) {

        const [result, err] = await withVaultContext({
            args,
            fn: async ({ ctx, cryptoIdentity, privateKey }) => {

                const db = ctx.kysely;
                const config = ctx.noorm.config;
                const gate: VaultPolicyGate = {
                    configName: config.name,
                    access: config.access,
                    channel: resolveChannel(),
                };

                const check = checkVaultPolicy(gate, 'vault:write');

                if (!check.allowed) {

                    return {
                        success: false,
                        error: check.blockedReason ?? `Cannot write the vault on config "${config.name}".`,
                    };

                }

                // The vault has no soft-delete and no history table, so this
                // destroys the team's only copy. `secret rm` — which deletes
                // a recoverable local copy — has always required --yes; the
                // irrecoverable one required nothing.
                if (!isYesMode(args)) {

                    return {
                        success: false,
                        error: `Deleting vault secret "${args.key}" cannot be undone — the team's only copy is destroyed. Pass --yes to confirm.`,
                    };

                }

                const vaultKey = await getVaultKeyChecked(gate, db, cryptoIdentity.identityHash, privateKey, ctx.dialect);

                if (!vaultKey) {

                    return {
                        success: false,
                        error: 'No vault access. Run "noorm vault init" or wait for propagation.',
                    };

                }

                const exists = await vaultSecretExists(db, args.key, ctx.dialect);

                if (!exists) {

                    return { success: false, notFound: true, error: `Secret "${args.key}" not found in vault` };

                }

                const [deleted, deleteErr] = await deleteVaultSecretChecked(gate, db, args.key, ctx.dialect);

                if (deleteErr) {

                    return { success: false, error: deleteErr.message };

                }

                return { success: true, key: args.key, deleted };

            },
        });

        if (err) {

            process.exit(EXIT.FAILURE);

        }

        if (args.json) {

            outputResult(args, result, '');

        }
        else if (result?.success) {

            process.stdout.write(`Vault secret "${args.key}" deleted\n`);

        }
        else {

            process.stderr.write(`Error: ${result?.error ?? 'Unknown error'}\n`);

        }

        // Deleting a key that was never in the vault named a target that does
        // not exist, which the contract separates from a delete that failed.
        if (result?.success) process.exit(EXIT.SUCCESS);

        process.exit(result?.notFound ? EXIT.USAGE : EXIT.FAILURE);

    },
});

(rmCommand as typeof rmCommand & { examples: string[] }).examples = [
    'noorm vault rm OLD_API_KEY --yes',
    'noorm vault rm OLD_API_KEY --yes --json',
    'noorm vault rm OLD_API_KEY --yes -c prod',
];

export default rmCommand;
