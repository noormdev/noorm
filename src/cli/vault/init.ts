/**
 * noorm vault init — initialize the vault for the current database.
 */
import { defineCommand } from 'citty';

import { withVaultContext, sharedArgs, isYesMode } from '../_utils.js';
import { initializeVaultChecked, getVaultStatus, checkVaultPolicy } from '../../core/vault/index.js';
import type { VaultPolicyGate } from '../../core/vault/index.js';

const initCommand = defineCommand({
    meta: {
        name: 'init',
        description: 'Initialize the vault for the current database',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
        yes: sharedArgs.yes,
    },
    async run({ args }) {

        const [result, err] = await withVaultContext({
            args,
            fn: async ({ ctx, cryptoIdentity }) => {

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
                        message: check.blockedReason ?? `Cannot initialize the vault on config "${config.name}".`,
                    };

                }

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

                if (check.requiresConfirmation && !isYesMode(args)) {

                    return {
                        success: false,
                        message: `Initializing the vault on config "${config.name}" requires confirmation `
                            + `(${check.confirmationPhrase}). Pass --yes to confirm.`,
                    };

                }

                const [, initErr] = await initializeVaultChecked(
                    gate,
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
