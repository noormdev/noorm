/**
 * Vault list headless command.
 *
 * Lists all vault secrets.
 */
import { type HeadlessCommand, withVaultContext } from './_helpers.js';
import { getVaultKey, getAllVaultSecrets, getVaultStatus } from '../../core/vault/index.js';

export const help = `
# VAULT LIST

List all vault secrets

## Usage

    noorm vault list

## Description

Lists all secrets stored in the vault. Values are shown masked for security.

Requires vault access.

## Examples

    noorm vault list

## JSON Output

    {
        "success": true,
        "secrets": [
            { "key": "API_KEY", "setBy": "alice@example.com", "updatedAt": "2024-01-15T10:30:00Z" },
            { "key": "DB_PASSWORD", "setBy": "bob@example.com", "updatedAt": "2024-01-14T09:00:00Z" }
        ]
    }
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

    const [result, err] = await withVaultContext({
        flags,
        logger,
        fn: async ({ ctx, cryptoIdentity, privateKey }) => {

            const db = ctx.kysely;

            // Check status
            const status = await getVaultStatus(db, cryptoIdentity.identityHash);

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

            // Get vault key
            const vaultKey = await getVaultKey(db, cryptoIdentity.identityHash, privateKey);

            if (!vaultKey) {

                return { success: false, error: 'Failed to decrypt vault key' };

            }

            // Get all secrets
            const secrets = await getAllVaultSecrets(db, vaultKey);
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

            const secrets = result.secrets ?? [];

            if (secrets.length === 0) {

                logger.info('Vault is empty. Use "noorm vault set <key> <value>" to add secrets.');

            }
            else {

                logger.info(`Vault secrets (${secrets.length}):`);

                for (const secret of secrets) {

                    logger.info(`  ${secret.key} (set by ${secret.setBy})`);

                }

            }

            if (result.status && result.status.usersWithoutAccess > 0) {

                logger.warn(`${result.status.usersWithoutAccess} users pending vault access. Run "noorm vault propagate" to grant.`);

            }

        }
        else {

            logger.error(result?.error ?? 'Unknown error');

        }

    }

    return result?.success ? 0 : 1;

};
