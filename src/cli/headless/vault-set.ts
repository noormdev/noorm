/**
 * Vault set headless command.
 *
 * Sets a vault secret.
 */
import { type HeadlessCommand, handleVaultResult, requireParams, withVaultContext } from './_helpers.js';
import { getVaultKey, setVaultSecret } from '../../core/vault/index.js';

export const help = `
# VAULT SET

Set a vault secret

## Usage

    noorm vault set <key> <value>

## Arguments

    key      Secret key name (e.g., API_KEY)
    value    Secret value

## Description

Stores an encrypted secret in the vault. Upserts - creates if new, updates if exists.

Requires vault access (run 'noorm vault init' first, or wait for propagation).

## Examples

    noorm vault set API_KEY "sk-live-..."
    noorm vault set DB_PASSWORD "secret123"

## JSON Output

    {
        "success": true,
        "key": "API_KEY",
        "action": "created"
    }
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    const key = params.name as string;
    const value = params.path as string; // Using path param for value

    if (!requireParams({ key, value }, flags, logger, help)) return 1;

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

            // Set the secret
            const [, setErr] = await setVaultSecret(
                db,
                vaultKey,
                key,
                value,
                cryptoIdentity.email,
            );

            if (setErr) {

                return { success: false, error: setErr.message };

            }

            return { success: true, key, action: 'set' };

        },
    });

    return handleVaultResult(result, err, flags, logger, () => {

        logger.info(`Vault secret "${key}" set successfully`);

    });

};
