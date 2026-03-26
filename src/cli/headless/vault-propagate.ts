/**
 * Vault propagate headless command.
 *
 * Propagates vault access to users without it.
 */
import { type HeadlessCommand, handleVaultResult, withVaultContext } from './_helpers.js';
import {
    getVaultKey,
    propagateVaultKey,
    getUsersWithoutVaultAccess,
} from '../../core/vault/index.js';

export const help = `
# VAULT PROPAGATE

Propagate vault access to new users

## Usage

    noorm -H vault propagate

## Description

Grants vault access to all registered users who don't have it yet.
Encrypts the vault key with each user's public key so they can
decrypt vault secrets.

This happens automatically on connect, but can be run manually to
grant access immediately after new team members register.

Requires vault access.

## Examples

    noorm -H vault propagate                   Propagate access
    noorm -H --json vault propagate            Propagate with JSON output

## JSON Output

    {
        "success": true,
        "propagatedTo": ["alice@example.com", "bob@example.com"],
        "alreadyHadAccess": 3
    }

When all users already have access:

    {
        "success": true,
        "propagatedTo": [],
        "message": "All users already have vault access"
    }

## See Also

See \`noorm help vault init\`, \`noorm help vault list\`.
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

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

            // Get users without access for reporting
            const usersWithout = await getUsersWithoutVaultAccess(db, ctx.dialect);

            if (usersWithout.length === 0) {

                return {
                    success: true,
                    propagatedTo: [],
                    message: 'All users already have vault access',
                };

            }

            // Propagate to all
            const propagateResult = await propagateVaultKey(db, vaultKey, ctx.dialect);

            return {
                success: true,
                propagatedTo: propagateResult.propagatedTo,
                alreadyHadAccess: propagateResult.alreadyHadAccess,
            };

        },
    });

    return handleVaultResult(result, err, flags, logger, (r) => {

        const propagated = r.propagatedTo ?? [];

        if (propagated.length === 0) {

            logger.info(r.message ?? 'All users already have vault access');

        }
        else {

            logger.info(`Granted vault access to ${propagated.length} users`);

            for (const hash of propagated) {

                logger.info(`  ${hash}`);

            }

        }

    });

};
