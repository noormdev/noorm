/**
 * Vault storage operations.
 *
 * Database CRUD operations for the vault table and vault key management.
 * All operations use Kysely for type-safe queries.
 */
import type { Kysely } from 'kysely';

import { attempt, attemptSync } from '@logosdx/utils';

import type { NoormDatabase } from '../shared/tables.js';
import { NOORM_TABLES } from '../shared/tables.js';
import { observer } from '../observer.js';

import type { EncryptedVaultKey, VaultSecret, VaultStatus } from './types.js';
import {
    generateVaultKey,
    encryptVaultKey,
    decryptVaultKey,
    encryptSecret,
    decryptSecret,
} from './key.js';

/**
 * Initialize the vault for a database.
 *
 * Generates a new vault key and stores it encrypted for the current user.
 * Only the first user to initialize gets the vault key.
 *
 * @param db - Kysely database instance
 * @param identityHash - Current user's identity hash
 * @param publicKey - Current user's public key (hex)
 *
 * @example
 * ```typescript
 * const [, err] = await initializeVault(db, identity.identityHash, identity.publicKey);
 * if (err) console.error('Failed to initialize vault');
 * ```
 */
export async function initializeVault(
    db: Kysely<NoormDatabase>,
    identityHash: string,
    publicKey: string,
): Promise<[Buffer | null, Error | null]> {

    // Check if vault is already initialized (any user has a vault key)
    const [existing, checkErr] = await attempt(async () => {

        return db
            .selectFrom(NOORM_TABLES.identities)
            .select('encrypted_vault_key')
            .where('encrypted_vault_key', 'is not', null)
            .limit(1)
            .executeTakeFirst();

    });

    if (checkErr) return [null, checkErr];

    if (existing?.encrypted_vault_key) {

        return [null, new Error('Vault already initialized')];

    }

    // Generate new vault key
    const vaultKey = generateVaultKey();

    // Encrypt for current user
    const encrypted = encryptVaultKey(vaultKey, publicKey);
    const encryptedJson = JSON.stringify(encrypted);

    // Update user's identity row
    const [, updateErr] = await attempt(async () => {

        return db
            .updateTable(NOORM_TABLES.identities)
            .set({ encrypted_vault_key: encryptedJson })
            .where('identity_hash', '=', identityHash)
            .execute();

    });

    if (updateErr) return [null, updateErr];

    observer.emit('vault:initialized', { identityHash });

    return [vaultKey, null];

}

/**
 * Get the vault key for the current user.
 *
 * Fetches and decrypts the vault key from the user's identity row.
 *
 * @param db - Kysely database instance
 * @param identityHash - Current user's identity hash
 * @param privateKey - Current user's private key (hex)
 * @returns The decrypted vault key, or null if not found/accessible
 *
 * @example
 * ```typescript
 * const vaultKey = await getVaultKey(db, identity.identityHash, privateKey);
 * if (!vaultKey) {
 *     console.log('No vault access - vault not initialized or not propagated');
 * }
 * ```
 */
export async function getVaultKey(
    db: Kysely<NoormDatabase>,
    identityHash: string,
    privateKey: string,
): Promise<Buffer | null> {

    const [row, err] = await attempt(async () => {

        return db
            .selectFrom(NOORM_TABLES.identities)
            .select('encrypted_vault_key')
            .where('identity_hash', '=', identityHash)
            .executeTakeFirst();

    });

    if (err || !row?.encrypted_vault_key) return null;

    const encryptedValue = row.encrypted_vault_key;

    const [parsed, parseErr] = attemptSync(() =>
        JSON.parse(encryptedValue) as EncryptedVaultKey,
    );

    if (parseErr) return null;

    return decryptVaultKey(parsed, privateKey);

}

/**
 * Set a vault secret.
 *
 * Encrypts and stores a secret in the vault table.
 * Upserts - creates if new, updates if exists.
 *
 * @param db - Kysely database instance
 * @param vaultKey - The decrypted vault key
 * @param secretKey - The secret's key name
 * @param value - The plaintext secret value
 * @param setBy - Identity string of who set this secret
 *
 * @example
 * ```typescript
 * await setVaultSecret(db, vaultKey, 'API_KEY', 'sk-live-...', 'alice@example.com');
 * ```
 */
export async function setVaultSecret(
    db: Kysely<NoormDatabase>,
    vaultKey: Buffer,
    secretKey: string,
    value: string,
    setBy: string,
): Promise<[void, Error | null]> {

    // Encrypt the value
    const encrypted = encryptSecret(value, vaultKey);
    const encryptedJson = JSON.stringify(encrypted);
    const now = new Date().toISOString();

    // Check if exists
    const [existing, checkErr] = await attempt(async () => {

        return db
            .selectFrom(NOORM_TABLES.vault)
            .select('id')
            .where('secret_key', '=', secretKey)
            .executeTakeFirst();

    });

    if (checkErr) return [undefined, checkErr];

    if (existing) {

        // Update existing
        const [, updateErr] = await attempt(async () => {

            return db
                .updateTable(NOORM_TABLES.vault)
                .set({
                    encrypted_value: encryptedJson,
                    set_by: setBy,
                    updated_at: now as unknown as Date,
                })
                .where('secret_key', '=', secretKey)
                .execute();

        });

        if (updateErr) return [undefined, updateErr];

        observer.emit('vault:secret:updated', { key: secretKey, setBy });

    }
    else {

        // Insert new
        const [, insertErr] = await attempt(async () => {

            return db
                .insertInto(NOORM_TABLES.vault)
                .values({
                    secret_key: secretKey,
                    encrypted_value: encryptedJson,
                    set_by: setBy,
                })
                .execute();

        });

        if (insertErr) return [undefined, insertErr];

        observer.emit('vault:secret:created', { key: secretKey, setBy });

    }

    return [undefined, null];

}

/**
 * Get a vault secret by key.
 *
 * @param db - Kysely database instance
 * @param vaultKey - The decrypted vault key
 * @param secretKey - The secret's key name
 * @returns The decrypted secret value, or null if not found
 *
 * @example
 * ```typescript
 * const value = await getVaultSecret(db, vaultKey, 'API_KEY');
 * if (value) {
 *     console.log('Secret found:', value);
 * }
 * ```
 */
export async function getVaultSecret(
    db: Kysely<NoormDatabase>,
    vaultKey: Buffer,
    secretKey: string,
): Promise<string | null> {

    const [row, err] = await attempt(async () => {

        return db
            .selectFrom(NOORM_TABLES.vault)
            .select('encrypted_value')
            .where('secret_key', '=', secretKey)
            .executeTakeFirst();

    });

    if (err || !row) return null;

    const [parsed, parseErr] = attemptSync(() =>
        JSON.parse(row.encrypted_value) as { iv: string; authTag: string; ciphertext: string },
    );

    if (parseErr) return null;

    return decryptSecret(parsed, vaultKey);

}

/**
 * Get all vault secrets.
 *
 * @param db - Kysely database instance
 * @param vaultKey - The decrypted vault key
 * @returns Map of secret key to VaultSecret
 *
 * @example
 * ```typescript
 * const secrets = await getAllVaultSecrets(db, vaultKey);
 * for (const [key, secret] of Object.entries(secrets)) {
 *     console.log(key, secret.value);
 * }
 * ```
 */
export async function getAllVaultSecrets(
    db: Kysely<NoormDatabase>,
    vaultKey: Buffer,
): Promise<Record<string, VaultSecret>> {

    const [rows, err] = await attempt(async () => {

        return db
            .selectFrom(NOORM_TABLES.vault)
            .selectAll()
            .execute();

    });

    if (err || !rows) return {};

    const secrets: Record<string, VaultSecret> = {};

    for (const row of rows) {

        const [parsed, parseErr] = attemptSync(() =>
            JSON.parse(row.encrypted_value) as { iv: string; authTag: string; ciphertext: string },
        );

        if (parseErr) continue;

        const value = decryptSecret(parsed, vaultKey);
        if (!value) continue;

        secrets[row.secret_key] = {
            key: row.secret_key,
            value,
            setBy: row.set_by,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        };

    }

    return secrets;

}

/**
 * List all vault secret keys (without decrypting values).
 *
 * @param db - Kysely database instance
 * @returns Array of secret key names
 *
 * @example
 * ```typescript
 * const keys = await listVaultSecretKeys(db);
 * console.log('Vault contains:', keys);
 * ```
 */
export async function listVaultSecretKeys(
    db: Kysely<NoormDatabase>,
): Promise<string[]> {

    const [rows, err] = await attempt(async () => {

        return db
            .selectFrom(NOORM_TABLES.vault)
            .select('secret_key')
            .orderBy('secret_key', 'asc')
            .execute();

    });

    if (err || !rows) return [];

    return rows.map((r) => r.secret_key);

}

/**
 * Delete a vault secret.
 *
 * @param db - Kysely database instance
 * @param secretKey - The secret's key name
 *
 * @example
 * ```typescript
 * await deleteVaultSecret(db, 'OLD_API_KEY');
 * ```
 */
export async function deleteVaultSecret(
    db: Kysely<NoormDatabase>,
    secretKey: string,
): Promise<[boolean, Error | null]> {

    const [result, err] = await attempt(async () => {

        return db
            .deleteFrom(NOORM_TABLES.vault)
            .where('secret_key', '=', secretKey)
            .execute();

    });

    if (err || !result) return [false, err ?? new Error('Delete failed')];

    const firstResult = result[0];
    const deleted = !!firstResult && Number(firstResult.numDeletedRows) > 0;

    if (deleted) {

        observer.emit('vault:secret:deleted', { key: secretKey });

    }

    return [deleted, null];

}

/**
 * Check if a vault secret exists.
 *
 * @param db - Kysely database instance
 * @param secretKey - The secret's key name
 * @returns True if the secret exists
 */
export async function vaultSecretExists(
    db: Kysely<NoormDatabase>,
    secretKey: string,
): Promise<boolean> {

    const [row, err] = await attempt(async () => {

        return db
            .selectFrom(NOORM_TABLES.vault)
            .select('id')
            .where('secret_key', '=', secretKey)
            .executeTakeFirst();

    });

    if (err) return false;

    return !!row;

}

/**
 * Get vault status.
 *
 * @param db - Kysely database instance
 * @param identityHash - Current user's identity hash
 *
 * @example
 * ```typescript
 * const status = await getVaultStatus(db, identity.identityHash);
 * console.log('Vault initialized:', status.isInitialized);
 * console.log('Has access:', status.hasAccess);
 * ```
 */
export async function getVaultStatus(
    db: Kysely<NoormDatabase>,
    identityHash: string,
): Promise<VaultStatus> {

    // Count secrets
    const [secretRows] = await attempt(async () => {

        return db
            .selectFrom(NOORM_TABLES.vault)
            .select(db.fn.count('id').as('count'))
            .executeTakeFirst();

    });

    const secretCount = secretRows ? Number(secretRows.count) : 0;

    // Count users with/without access
    const [identityRows] = await attempt(async () => {

        return db
            .selectFrom(NOORM_TABLES.identities)
            .select([
                'identity_hash',
                'encrypted_vault_key',
            ])
            .execute();

    });

    const identities = identityRows ?? [];
    const usersWithAccess = identities.filter((i) => i.encrypted_vault_key !== null).length;
    const usersWithoutAccess = identities.filter((i) => i.encrypted_vault_key === null).length;
    const isInitialized = usersWithAccess > 0;

    // Check if current user has access
    const currentUser = identities.find((i) => i.identity_hash === identityHash);
    const hasAccess = currentUser?.encrypted_vault_key !== null;

    return {
        isInitialized,
        hasAccess,
        secretCount,
        usersWithAccess,
        usersWithoutAccess,
    };

}
