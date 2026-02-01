/**
 * Vault propagate headless command.
 *
 * Propagates vault access to users without it.
 */
import { type HeadlessCommand, withVaultContext } from './_helpers.js';
import {
    getVaultKey,
    propagateVaultKey,
    getUsersWithoutVaultAccess,
} from '../../core/vault/index.js';

export const help = `
# VAULT PROPAGATE

Propagate vault access to new users

## Usage

    noorm vault propagate

## Description

Grants vault access to all registered users who don't have it yet.
Encrypts the vault key with each user's public key.

This is typically done automatically on connect, but can be run
manually to grant access immediately.

Requires vault access.

## Examples

    noorm vault propagate

## JSON Output

    {
        "success": true,
        "propagatedTo": ["alice@example.com", "bob@example.com"],
        "alreadyHadAccess": 3
    }
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

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

            // Get users without access for reporting
            const usersWithout = await getUsersWithoutVaultAccess(db);

            if (usersWithout.length === 0) {

                return {
                    success: true,
                    propagatedTo: [],
                    message: 'All users already have vault access',
                };

            }

            // Propagate to all
            const propagateResult = await propagateVaultKey(db, vaultKey);

            return {
                success: true,
                propagatedTo: propagateResult.propagatedTo,
                alreadyHadAccess: propagateResult.alreadyHadAccess,
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

            const propagated = result.propagatedTo ?? [];

            if (propagated.length === 0) {

                logger.info(result.message ?? 'All users already have vault access');

            }
            else {

                logger.info(`Granted vault access to ${propagated.length} users`);

                for (const hash of propagated) {

                    logger.info(`  ${hash}`);

                }

            }

        }
        else {

            logger.error(result?.error ?? 'Unknown error');

        }

    }

    return result?.success ? 0 : 1;

};
