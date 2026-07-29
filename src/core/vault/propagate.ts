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
import { getNoormTables, noormDb } from '../shared/tables.js';
import type { Dialect } from '../connection/types.js';
import { observer } from '../observer.js';

import type { FailedVaultPropagation, PendingVaultUser, VaultPropagationResult } from './types.js';
import { encryptVaultKey } from './key.js';
import { assertVaultPolicy } from './policy.js';
import type { VaultPolicyGate } from './policy.js';

/**
 * Get users who don't have vault access yet.
 *
 * Uses dialect-aware table names to support both legacy prefixed and
 * schema-qualified table locations.
 *
 * Returns a tuple rather than a bare array because "nobody is waiting" and
 * "the query failed" are opposite answers that used to collapse into the same
 * empty array — an operator was told "all users already have vault access"
 * when the database had in fact refused the read.
 *
 * @param db - Kysely database instance
 * @param dialect - Database dialect for table name resolution
 * @returns [users, null] on success, [null, Error] when the query failed
 *
 * @example
 * ```typescript
 * const [users, err] = await getUsersWithoutVaultAccess(db, 'postgres');
 * if (err) throw err;
 * console.log('Users awaiting access:', users.length);
 * ```
 */
export async function getUsersWithoutVaultAccess(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
): Promise<[PendingVaultUser[], null] | [null, Error]> {

    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    const [rows, err] = await attempt(async () => {

        return ndb
            .selectFrom(tables.identities as keyof NoormDatabase)
            .select([
                'identity_hash',
                'public_key',
                'name',
                'email',
            ])
            .where('encrypted_vault_key', 'is', null)
            .execute();

    });

    if (err) return [null, err];

    if (!rows) return [null, new Error('Failed to read identities awaiting vault access')];

    return [
        rows.map((r) => ({
            identityHash: r.identity_hash,
            publicKey: r.public_key,
            name: r.name,
            email: r.email,
        })),
        null,
    ];

}

/**
 * Options for `propagateVaultKey`.
 */
export interface VaultPropagationOptions {
    /**
     * Identity hashes to grant access to. Omitted means "every identity
     * currently without access" — the historical behaviour, which callers
     * should only reach for after showing the operator that list.
     */
    targets?: string[];
}

/**
 * Propagate vault key to users without access.
 *
 * Encrypts the vault key for each user's public key and updates their row.
 * Uses dialect-aware table names to support both legacy prefixed and
 * schema-qualified table locations.
 *
 * Per-user failures land in `result.failed` rather than being dropped: a
 * grant that silently skipped a teammate left both parties believing access
 * had been handed over, with no signal on either side.
 *
 * @param db - Kysely database instance
 * @param vaultKey - The decrypted vault key
 * @param dialect - Database dialect for table name resolution
 * @param options - Restrict propagation to specific identity hashes
 * @returns Result with granted, already-had, and failed targets
 *
 * @example
 * ```typescript
 * const result = await propagateVaultKey(db, vaultKey, 'postgres', { targets: [hash] });
 * if (result.failed.length > 0) throw new Error('partial propagation');
 * ```
 */
export async function propagateVaultKey(
    db: Kysely<NoormDatabase>,
    vaultKey: Buffer,
    dialect: Dialect,
    options: VaultPropagationOptions = {},
): Promise<VaultPropagationResult> {

    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    const countWithAccess = async (): Promise<number> => {

        const [countResult] = await attempt(async () => {

            return ndb
                .selectFrom(tables.identities as keyof NoormDatabase)
                .select(ndb.fn.count('id').as('count'))
                .where('encrypted_vault_key', 'is not', null)
                .executeTakeFirst();

        });

        return countResult ? Number(countResult.count) : 0;

    };

    const [pending, pendingErr] = await getUsersWithoutVaultAccess(db, dialect);

    if (pendingErr) throw pendingErr;

    const users = options.targets
        ? pending.filter((u) => options.targets?.includes(u.identityHash))
        : pending;

    if (users.length === 0) {

        return {
            propagatedTo: [],
            alreadyHadAccess: await countWithAccess(),
            failed: [],
        };

    }

    const propagatedTo: string[] = [];
    const failed: FailedVaultPropagation[] = [];

    for (const user of users) {

        // Encrypt vault key for this user's public key
        const encrypted = encryptVaultKey(vaultKey, user.publicKey);
        const encryptedJson = JSON.stringify(encrypted);

        // Update user's row
        const [, err] = await attempt(async () => {

            return ndb
                .updateTable(tables.identities as keyof NoormDatabase)
                .set({ encrypted_vault_key: encryptedJson })
                .where('identity_hash', '=', user.identityHash)
                .execute();

        });

        if (err) {

            failed.push({
                identityHash: user.identityHash,
                email: user.email,
                error: err.message,
            });

            observer.emit('error', {
                source: 'vault:propagate',
                error: err,
                context: { identityHash: user.identityHash, email: user.email },
            });

            continue;

        }

        propagatedTo.push(user.identityHash);

        observer.emit('vault:propagated', {
            toIdentityHash: user.identityHash,
            toEmail: user.email,
        });

    }

    const alreadyHadAccess = (await countWithAccess()) - propagatedTo.length;

    return {
        propagatedTo,
        alreadyHadAccess,
        failed,
    };

}

/**
 * `propagateVaultKey` gated on `vault:propagate`.
 *
 * @throws Error carrying the policy's blockedReason when the gate denies.
 *
 * @example
 * const result = await propagateVaultKeyChecked(gate, db, vaultKey, 'postgres', { targets });
 */
export async function propagateVaultKeyChecked(
    gate: VaultPolicyGate,
    db: Kysely<NoormDatabase>,
    vaultKey: Buffer,
    dialect: Dialect,
    options: VaultPropagationOptions = {},
): Promise<VaultPropagationResult> {

    assertVaultPolicy(gate, 'vault:propagate');

    return propagateVaultKey(db, vaultKey, dialect, options);

}

/**
 * Propagate vault key to a specific user.
 *
 * Uses dialect-aware table names to support both legacy prefixed and
 * schema-qualified table locations.
 *
 * @param db - Kysely database instance
 * @param vaultKey - The decrypted vault key
 * @param targetIdentityHash - Identity hash of user to propagate to
 * @param dialect - Database dialect for table name resolution
 * @returns True if propagated successfully
 *
 * @example
 * ```typescript
 * const success = await propagateVaultKeyTo(db, vaultKey, 'abc123...', 'postgres');
 * ```
 */
export async function propagateVaultKeyTo(
    db: Kysely<NoormDatabase>,
    vaultKey: Buffer,
    targetIdentityHash: string,
    dialect: Dialect,
): Promise<boolean> {

    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    // Get target user's public key
    const [row, err] = await attempt(async () => {

        return ndb
            .selectFrom(tables.identities as keyof NoormDatabase)
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

        return ndb
            .updateTable(tables.identities as keyof NoormDatabase)
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

/**
 * `propagateVaultKeyTo` gated on `vault:propagate`.
 *
 * @throws Error carrying the policy's blockedReason when the gate denies.
 *
 * @example
 * const ok = await propagateVaultKeyToChecked(gate, db, vaultKey, hash, 'postgres');
 */
export async function propagateVaultKeyToChecked(
    gate: VaultPolicyGate,
    db: Kysely<NoormDatabase>,
    vaultKey: Buffer,
    targetIdentityHash: string,
    dialect: Dialect,
): Promise<boolean> {

    assertVaultPolicy(gate, 'vault:propagate');

    return propagateVaultKeyTo(db, vaultKey, targetIdentityHash, dialect);

}
