/**
 * Vault init headless command.
 *
 * Initializes the vault for the active config's database.
 */
import type { Kysely } from 'kysely';

import { type HeadlessCommand, withVaultContext } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';
import { initializeVault, getVaultStatus } from '../../core/vault/index.js';
import type { NoormDatabase } from '../../core/shared/index.js';

export const help = `
# VAULT INIT

Initialize the vault for the current database

## Usage

    noorm vault init

## Description

Generates a new vault encryption key and stores it encrypted for your identity.
Only the first user to initialize gets the vault key - others receive it via propagation.

Requires:
- Active config set
- Identity initialized

## Examples

    noorm vault init

## JSON Output

    {
        "success": true,
        "message": "Vault initialized successfully"
    }
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    if (flags.json && !params.name && !flags.config) {

        const output = flags.json ? help : formatHelp(help);
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
            );

            if (initErr) {

                return { success: false, message: initErr.message };

            }

            return { success: true, message: 'Vault initialized successfully' };

        },
    });

    if (err) {

        if (flags.json) {

            process.stdout.write(JSON.stringify({ success: false, error: err.message }) + '\n');

        }
        else {

            logger.error(err.message);

        }

        return 1;

    }

    if (flags.json) {

        process.stdout.write(JSON.stringify(result) + '\n');

    }
    else {

        if (result?.success) {

            logger.info(result.message);

        }
        else {

            logger.error(result?.message ?? 'Unknown error');

        }

    }

    return result?.success ? 0 : 1;

};
