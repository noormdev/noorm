/**
 * Vault init headless command.
 *
 * Initializes the vault for the active config's database.
 */
import type { Kysely } from 'kysely';

import { type HeadlessCommand, handleVaultResult, withVaultContext } from './_helpers.js';
import { initializeVault, getVaultStatus } from '../../core/vault/index.js';
import type { NoormDatabase } from '../../core/shared/index.js';

export const help = `
# VAULT INIT

Initialize the vault for the current database

## Usage

    noorm -H vault init

## Description

Generates a new vault encryption key and stores it encrypted for your identity.
Only the first user to initialize gets the vault key — others receive it via
\`noorm vault propagate\`.

Requires an active config and initialized identity.

## Examples

    noorm -H vault init                    Initialize vault
    noorm -H --json vault init             Initialize and return JSON

## JSON Output

    {
        "success": true,
        "message": "Vault initialized successfully"
    }

If already initialized:

    {
        "success": true,
        "message": "Vault already initialized and you have access"
    }

## See Also

See \`noorm help vault propagate\`, \`noorm help vault set\`.
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    if (flags.json && !params.name && !flags.config) {

        const output = flags.json ? help : help;
        process.stdout.write(output + '\n');

        return 0;

    }

    const [result, err] = await withVaultContext({
        flags,
        logger,
        fn: async ({ ctx, cryptoIdentity }) => {

            const db = ctx.kysely;

            // Check current status
            const status = await getVaultStatus(
                db as Kysely<NoormDatabase>,
                cryptoIdentity.identityHash,
                ctx.dialect,
            );

            if (status.isInitialized) {

                if (status.hasAccess) {

                    return { success: true, message: 'Vault already initialized and you have access' };

                }

                return {
                    success: false,
                    message: 'Vault already initialized but you do not have access. Ask a team member to propagate.',
                };

            }

            // Initialize vault
            const [, initErr] = await initializeVault(
                db as Kysely<NoormDatabase>,
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

    return handleVaultResult(result, err, flags, logger, (r) => {

        logger.info(r.message);

    });

};
