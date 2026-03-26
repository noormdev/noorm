/**
 * Vault rm headless command.
 *
 * Removes a vault secret.
 */
import { type HeadlessCommand, handleVaultResult, requireParams, withVaultContext } from './_helpers.js';
import { getVaultKey, deleteVaultSecret, vaultSecretExists } from '../../core/vault/index.js';

export const help = `
# VAULT RM

Remove a vault secret

## Usage

    noorm -H vault rm <key>

## Arguments

    key      Secret key name to remove

## Description

Permanently deletes a secret from the vault. Fails if the key does not exist.

Requires vault access.

## Examples

    noorm -H vault rm OLD_API_KEY                Remove a secret
    noorm -H --json vault rm OLD_API_KEY         Remove with JSON output

## JSON Output

    {
        "success": true,
        "key": "OLD_API_KEY",
        "deleted": true
    }

## See Also

See \`noorm help vault list\`, \`noorm help vault set\`.
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    const key = params.name as string;

    if (!requireParams({ key }, flags, logger, help)) return 1;

    const [result, err] = await withVaultContext({
        flags,
        logger,
        fn: async ({ ctx, cryptoIdentity, privateKey }) => {

            const db = ctx.kysely;

            // Get vault key
            const vaultKey = await getVaultKey(db, cryptoIdentity.identityHash, privateKey, ctx.dialect);

            if (!vaultKey) {

                return {
                    success: false,
                    error: 'No vault access. Run "noorm vault init" or wait for propagation.',
                };

            }

            // Check if exists
            const exists = await vaultSecretExists(db, key, ctx.dialect);

            if (!exists) {

                return { success: false, error: `Secret "${key}" not found in vault` };

            }

            // Delete the secret
            const [deleted, deleteErr] = await deleteVaultSecret(db, key, ctx.dialect);

            if (deleteErr) {

                return { success: false, error: deleteErr.message };

            }

            return { success: true, key, deleted };

        },
    });

    return handleVaultResult(result, err, flags, logger, () => {

        logger.info(`Vault secret "${key}" deleted`);

    });

};
