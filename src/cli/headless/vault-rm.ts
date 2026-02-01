/**
 * Vault rm headless command.
 *
 * Removes a vault secret.
 */
import { type HeadlessCommand, withVaultContext } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';
import { getVaultKey, deleteVaultSecret, vaultSecretExists } from '../../core/vault/index.js';

export const help = `
# VAULT RM

Remove a vault secret

## Usage

    noorm vault rm <key>

## Arguments

    key      Secret key name to remove

## Description

Permanently deletes a secret from the vault.

Requires vault access.

## Examples

    noorm vault rm OLD_API_KEY

## JSON Output

    {
        "success": true,
        "key": "OLD_API_KEY",
        "deleted": true
    }
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    const key = params.name;

    if (!key) {

        if (flags.json) {

            process.stdout.write(JSON.stringify({
                success: false,
                error: 'Usage: noorm vault rm <key>',
            }) + '\n');

        }
        else {

            const output = formatHelp(help);
            process.stdout.write(output + '\n');

        }

        return 1;

    }

    const [result, err] = await withVaultContext({
        flags,
        logger,
        fn: async ({ ctx, cryptoIdentity, privateKey }) => {

            const db = ctx.kysely;

            // Get vault key
            const vaultKey = await getVaultKey(db, cryptoIdentity.identityHash, privateKey);

            if (!vaultKey) {

                return {
                    success: false,
                    error: 'No vault access. Run "noorm vault init" or wait for propagation.',
                };

            }

            // Check if exists
            const exists = await vaultSecretExists(db, key);

            if (!exists) {

                return { success: false, error: `Secret "${key}" not found in vault` };

            }

            // Delete the secret
            const [deleted, deleteErr] = await deleteVaultSecret(db, key);

            if (deleteErr) {

                return { success: false, error: deleteErr.message };

            }

            return { success: true, key, deleted };

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

            logger.info(`Vault secret "${key}" deleted`);

        }
        else {

            logger.error(result?.error ?? 'Unknown error');

        }

    }

    return result?.success ? 0 : 1;

};
