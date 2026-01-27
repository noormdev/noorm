/**
 * Vault key propagation.
 *
 * Propagates vault access to users who don't have it yet.
 * When a user with vault access connects, they can automatically
 * propagate the vault key to new team members.
 */
import type { Kysely } from 'kysely';

import { attempt } from '@logosdx/utils';

import type { NoormDatabase } from '../shared/tables.js';
import { NOORM_TABLES } from '../shared/tables.js';
import { observer } from '../observer.js';

import type { VaultPropagationResult } from './types.js';
import { encryptVaultKey } from './key.js';

/**
 * User info for propagation.
 */
interface UserForPropagation {
    identityHash: string;
    publicKey: string;
    name: string;
    email: string;
}

/**
 * Get users who don't have vault access yet.
 *
 * @param db - Kysely database instance
 * @returns Array of users without vault access
 *
 * @example
 * ```typescript
 * const users = await getUsersWithoutVaultAccess(db);
 * console.log('Users awaiting access:', users.length);
 * ```
 */
export async function getUsersWithoutVaultAccess(
    db: Kysely<NoormDatabase>,
): Promise<UserForPropagation[]> {

    const [rows, err] = await attempt(async () => {

        return db
            .selectFrom(NOORM_TABLES.identities)
            .select([
                'identity_hash',
                'public_key',
                'name',
                'email',
            ])
            .where('encrypted_vault_key', 'is', null)
            .execute();

    });

    if (err || !rows) return [];

    return rows.map((r) => ({
        identityHash: r.identity_hash,
        publicKey: r.public_key,
        name: r.name,
        email: r.email,
    }));

}

/**
 * Propagate vault key to all users without access.
 *
 * Encrypts the vault key for each user's public key and updates their row.
 *
 * @param db - Kysely database instance
 * @param vaultKey - The decrypted vault key
 * @returns Result with counts of propagated users
 *
 * @example
 * ```typescript
 * const result = await propagateVaultKey(db, vaultKey);
 * if (result.propagatedTo.length > 0) {
 *     console.log('Granted access to:', result.propagatedTo.join(', '));
 * }
 * ```
 */
export async function propagateVaultKey(
    db: Kysely<NoormDatabase>,
    vaultKey: Buffer,
): Promise<VaultPropagationResult> {

    const users = await getUsersWithoutVaultAccess(db);

    if (users.length === 0) {

        // Count users who already have access
        const [countResult] = await attempt(async () => {

            return db
                .selectFrom(NOORM_TABLES.identities)
                .select(db.fn.count('id').as('count'))
                .where('encrypted_vault_key', 'is not', null)
                .executeTakeFirst();

        });

        return {
            propagatedTo: [],
            alreadyHadAccess: countResult ? Number(countResult.count) : 0,
        };

    }

    const propagatedTo: string[] = [];

    for (const user of users) {

        // Encrypt vault key for this user's public key
        const encrypted = encryptVaultKey(vaultKey, user.publicKey);
        const encryptedJson = JSON.stringify(encrypted);

        // Update user's row
        const [, err] = await attempt(async () => {

            return db
                .updateTable(NOORM_TABLES.identities)
                .set({ encrypted_vault_key: encryptedJson })
                .where('identity_hash', '=', user.identityHash)
                .execute();

        });

        if (!err) {

            propagatedTo.push(user.identityHash);

            observer.emit('vault:propagated', {
                toIdentityHash: user.identityHash,
                toEmail: user.email,
            });

        }

    }

    // Count users who already had access
    const [countResult] = await attempt(async () => {

        return db
            .selectFrom(NOORM_TABLES.identities)
            .select(db.fn.count('id').as('count'))
            .where('encrypted_vault_key', 'is not', null)
            .executeTakeFirst();

    });

    const totalWithAccess = countResult ? Number(countResult.count) : 0;
    const alreadyHadAccess = totalWithAccess - propagatedTo.length;

    return {
        propagatedTo,
        alreadyHadAccess,
    };

}

/**
 * Propagate vault key to a specific user.
 *
 * @param db - Kysely database instance
 * @param vaultKey - The decrypted vault key
 * @param targetIdentityHash - Identity hash of user to propagate to
 * @returns True if propagated successfully
 *
 * @example
 * ```typescript
 * const success = await propagateVaultKeyTo(db, vaultKey, 'abc123...');
 * ```
 */
export async function propagateVaultKeyTo(
    db: Kysely<NoormDatabase>,
    vaultKey: Buffer,
    targetIdentityHash: string,
): Promise<boolean> {

    // Get target user's public key
    const [row, err] = await attempt(async () => {

        return db
            .selectFrom(NOORM_TABLES.identities)
            .select(['public_key', 'email', 'encrypted_vault_key'])
            .where('identity_hash', '=', targetIdentityHash)
            .executeTakeFirst();

    });

    if (err || !row) return false;

    // Already has access
    if (row.encrypted_vault_key) return true;

    // Encrypt vault key for user's public key
    const encrypted = encryptVaultKey(vaultKey, row.public_key);
    const encryptedJson = JSON.stringify(encrypted);

    // Update user's row
    const [, updateErr] = await attempt(async () => {

        return db
            .updateTable(NOORM_TABLES.identities)
            .set({ encrypted_vault_key: encryptedJson })
            .where('identity_hash', '=', targetIdentityHash)
            .execute();

    });

    if (updateErr) return false;

    observer.emit('vault:propagated', {
        toIdentityHash: targetIdentityHash,
        toEmail: row.email,
    });

    return true;

}
