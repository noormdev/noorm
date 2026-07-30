/**
 * noorm vault list — list all vault secrets.
 */
import { defineCommand } from 'citty';

import { withVaultContext, outputResult, sharedArgs } from '../_utils.js';
import { getVaultKeyChecked, getAllVaultSecrets, getVaultStatus, checkVaultPolicy } from '../../core/vault/index.js';
import type { VaultPolicyGate } from '../../core/vault/index.js';
import { resolveChannel } from '../../core/policy/index.js';

const listCommand = defineCommand({
    meta: {
        name: 'list',
        description: 'List all vault secrets',
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
                const config = ctx.noorm.config;
                const gate: VaultPolicyGate = {
                    configName: config.name,
                    access: config.access,
                    channel: resolveChannel(),
                };

                const check = checkVaultPolicy(gate, 'vault:read');

                if (!check.allowed) {

                    return {
                        success: false,
                        error: check.blockedReason ?? `Cannot read the vault on config "${config.name}".`,
                    };

                }

                const status = await getVaultStatus(db, cryptoIdentity.identityHash, ctx.dialect);

                if (!status.isInitialized) {

                    return {
                        success: false,
                        error: 'Vault not initialized. Run "noorm vault init" first.',
                    };

                }

                if (!status.hasAccess) {

                    return {
                        success: false,
                        error: 'No vault access. Wait for a team member to propagate access.',
                    };

                }

                const vaultKey = await getVaultKeyChecked(gate, db, cryptoIdentity.identityHash, privateKey, ctx.dialect);

                if (!vaultKey) {

                    return { success: false, error: 'Failed to decrypt vault key' };

                }

                const secrets = await getAllVaultSecrets(db, vaultKey, ctx.dialect);
                const secretList = Object.values(secrets).map((s) => ({
                    key: s.key,
                    setBy: s.setBy,
                    updatedAt: s.updatedAt.toISOString(),
                }));

                return {
                    success: true,
                    secrets: secretList,
                    status: {
                        usersWithAccess: status.usersWithAccess,
                        usersWithoutAccess: status.usersWithoutAccess,
                    },
                };

            },
        });

        if (err) {

            process.exit(1);

        }

        if (args.json) {

            outputResult(args, result, '');

        }
        else if (result?.success) {

            const secrets = result.secrets ?? [];

            if (secrets.length === 0) {

                process.stdout.write('Vault is empty. Use "noorm vault set <key> <value>" to add secrets.\n');

            }
            else {

                process.stdout.write(`Vault secrets (${secrets.length}):\n`);

                for (const secret of secrets) {

                    process.stdout.write(`  ${secret.key} (set by ${secret.setBy})\n`);

                }

            }

            if (result.status && result.status.usersWithoutAccess > 0) {

                process.stderr.write(`${result.status.usersWithoutAccess} users pending vault access. Run "noorm vault propagate" to grant.\n`);

            }

        }
        else {

            process.stderr.write(`Error: ${result?.error ?? 'Unknown error'}\n`);

        }

        process.exit(result?.success ? 0 : 1);

    },
});

(listCommand as typeof listCommand & { examples: string[] }).examples = [
    'noorm vault list',
    'noorm vault list --json',
    'noorm vault list -c prod',
];

export default listCommand;
