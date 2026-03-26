/**
 * Vault list headless command.
 *
 * Lists all vault secrets.
 */
import { type HeadlessCommand, handleVaultResult, withVaultContext } from './_helpers.js';
import { getVaultKey, getAllVaultSecrets, getVaultStatus } from '../../core/vault/index.js';

export const help = `
# VAULT LIST

List all vault secrets

## Usage

    noorm -H vault list

## Description

Lists all secrets stored in the vault with metadata (who set each secret and when).
Values are never exposed — only keys and metadata are returned.

Requires vault access.

## Examples

    noorm -H vault list                    List secrets
    noorm -H --json vault list             List as JSON

## JSON Output

    {
        "success": true,
        "secrets": [
            { "key": "API_KEY", "setBy": "alice@example.com", "updatedAt": "2024-01-15T10:30:00Z" },
            { "key": "DB_PASSWORD", "setBy": "bob@example.com", "updatedAt": "2024-01-14T09:00:00Z" }
        ],
        "status": {
            "usersWithAccess": 3,
            "usersWithoutAccess": 1
        }
    }

## See Also

See \`noorm help vault set\`, \`noorm help vault propagate\`.
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

    const [result, err] = await withVaultContext({
        flags,
        logger,
        fn: async ({ ctx, cryptoIdentity, privateKey }) => {

            const db = ctx.kysely;

            // Check status
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

            // Get vault key
            const vaultKey = await getVaultKey(db, cryptoIdentity.identityHash, privateKey, ctx.dialect);

            if (!vaultKey) {

                return { success: false, error: 'Failed to decrypt vault key' };

            }

            // Get all secrets
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

    return handleVaultResult(result, err, flags, logger, (r) => {

        const secrets = r.secrets ?? [];

        if (secrets.length === 0) {

            logger.info('Vault is empty. Use "noorm vault set <key> <value>" to add secrets.');

        }
        else {

            logger.info(`Vault secrets (${secrets.length}):`);

            for (const secret of secrets) {

                logger.info(`  ${secret.key} (set by ${secret.setBy})`);

            }

        }

        if (r.status && r.status.usersWithoutAccess > 0) {

            logger.warn(`${r.status.usersWithoutAccess} users pending vault access. Run "noorm vault propagate" to grant.`);

        }

    });

};
