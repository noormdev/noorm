/**
 * Vault storage operations.
 *
 * Database CRUD operations for the vault table and vault key management.
 * All operations use Kysely for type-safe queries.
 */
import type { Kysely } from 'kysely';

import { attempt, attemptSync } from '@logosdx/utils';

import type { NoormDatabase } from '../shared/tables.js';
import { getNoormTables, noormDb } from '../shared/tables.js';
import type { Dialect } from '../connection/types.js';
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
 * Idempotent: if the vault is already initialized, returns [null, null]
 * without modifying state. Only the first call generates and returns
 * the vault key.
 *
 * On first call:
 *   - Generates a new vault key.
 *   - Encrypts it for the current user.
 *   - Emits the `vault:initialized` observer event.
 *   - Returns [vaultKey, null].
 *
 * On repeat calls:
 *   - No state change. No event emission.
 *   - Returns [null, null]. Callers that need the existing key for
 *     ongoing operations should use vault.get / vault.set with their
 *     private key.
 *
 * @param db - Kysely database instance
 * @param identityHash - Current user's identity hash
 * @param publicKey - Current user's public key (hex)
 * @param dialect - Database dialect for table name resolution
 * @returns [Buffer | null, Error | null]
 *   - [Buffer, null] on first successful init.
 *   - [null, null] when the vault is already initialized.
 *   - [null, Error] on actual failure (DB error, etc.).
 *
 * @example
 * ```typescript
 * const [vaultKey, err] = await initializeVault(db, identity.identityHash, identity.publicKey, 'postgres');
 * if (err) throw err;
 * if (vaultKey) {
 *     // first-time init — set initial secrets, etc.
 * }
 * else {
 *     // already initialized — use vault.get / vault.set with private key
 * }
 * ```
 */
export async function initializeVault(
    db: Kysely<NoormDatabase>,
    identityHash: string,
    publicKey: string,
    dialect: Dialect,
): Promise<[Buffer | null, Error | null]> {

    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    // Check if vault is already initialized (any user has a vault key)
    const [existing, checkErr] = await attempt(async () => {

        return ndb
            .selectFrom(tables.identities as keyof NoormDatabase)
            .select('encrypted_vault_key')
            .where('encrypted_vault_key', 'is not', null)
            .limit(1)
            .executeTakeFirst();

    });

    if (checkErr) return [null, checkErr];

    if (existing?.encrypted_vault_key) {

        // Idempotent — vault already initialized, no work done, no event emitted.
        return [null, null];

    }

    // Generate new vault key
    const vaultKey = generateVaultKey();

    // Encrypt for current user
    const encrypted = encryptVaultKey(vaultKey, publicKey);
    const encryptedJson = JSON.stringify(encrypted);

    // Update user's identity row
    const [, updateErr] = await attempt(async () => {

        return ndb
            .updateTable(tables.identities as keyof NoormDatabase)
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
 * Uses dialect-aware table names to support both legacy prefixed and
 * schema-qualified table locations.
 *
 * @param db - Kysely database instance
 * @param identityHash - Current user's identity hash
 * @param privateKey - Current user's private key (hex)
 * @param dialect - Database dialect for table name resolution
 * @returns The decrypted vault key, or null if not found/accessible
 *
 * @example
 * ```typescript
 * const vaultKey = await getVaultKey(db, identity.identityHash, privateKey, 'postgres');
 * if (!vaultKey) {
 *     console.log('No vault access - vault not initialized or not propagated');
 * }
 * ```
 */
export async function getVaultKey(
    db: Kysely<NoormDatabase>,
    identityHash: string,
    privateKey: string,
    dialect: Dialect,
): Promise<Buffer | null> {

    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    const [row, err] = await attempt(async () => {

        return ndb
            .selectFrom(tables.identities as keyof NoormDatabase)
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
 * Uses dialect-aware table names to support both legacy prefixed and
 * schema-qualified table locations.
 *
 * @param db - Kysely database instance
 * @param vaultKey - The decrypted vault key
 * @param secretKey - The secret's key name
 * @param value - The plaintext secret value
 * @param setBy - Identity string of who set this secret
 * @param dialect - Database dialect for table name resolution
 *
 * @example
 * ```typescript
 * await setVaultSecret(db, vaultKey, 'API_KEY', 'sk-live-...', 'alice@example.com', 'postgres');
 * ```
 */
export async function setVaultSecret(
    db: Kysely<NoormDatabase>,
    vaultKey: Buffer,
    secretKey: string,
    value: string,
    setBy: string,
    dialect: Dialect,
): Promise<[void, Error | null]> {

    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    // Encrypt the value
    const encrypted = encryptSecret(value, vaultKey);
    const encryptedJson = JSON.stringify(encrypted);
    const now = new Date().toISOString();

    // Check if exists
    const [existing, checkErr] = await attempt(async () => {

        return ndb
            .selectFrom(tables.vault as keyof NoormDatabase)
            .select('id')
            .where('secret_key', '=', secretKey)
            .executeTakeFirst();

    });

    if (checkErr) return [undefined, checkErr];

    if (existing) {

        // Update existing
        const [, updateErr] = await attempt(async () => {

            return ndb
                .updateTable(tables.vault as keyof NoormDatabase)
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

            return ndb
                .insertInto(tables.vault as keyof NoormDatabase)
                .values({
                    secret_key: secretKey,
                    encrypted_value: encryptedJson,
                    set_by: setBy,
                } as never)
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
 * Uses dialect-aware table names to support both legacy prefixed and
 * schema-qualified table locations.
 *
 * @param db - Kysely database instance
 * @param vaultKey - The decrypted vault key
 * @param secretKey - The secret's key name
 * @param dialect - Database dialect for table name resolution
 * @returns The decrypted secret value, or null if not found
 *
 * @example
 * ```typescript
 * const value = await getVaultSecret(db, vaultKey, 'API_KEY', 'postgres');
 * if (value) {
 *     console.log('Secret found:', value);
 * }
 * ```
 */
export async function getVaultSecret(
    db: Kysely<NoormDatabase>,
    vaultKey: Buffer,
    secretKey: string,
    dialect: Dialect,
): Promise<string | null> {

    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    const [row, err] = await attempt(async () => {

        return ndb
            .selectFrom(tables.vault as keyof NoormDatabase)
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
 * Uses dialect-aware table names to support both legacy prefixed and
 * schema-qualified table locations.
 *
 * @param db - Kysely database instance
 * @param vaultKey - The decrypted vault key
 * @param dialect - Database dialect for table name resolution
 * @returns Map of secret key to VaultSecret
 *
 * @example
 * ```typescript
 * const secrets = await getAllVaultSecrets(db, vaultKey, 'postgres');
 * for (const [key, secret] of Object.entries(secrets)) {
 *     console.log(key, secret.value);
 * }
 * ```
 */
export async function getAllVaultSecrets(
    db: Kysely<NoormDatabase>,
    vaultKey: Buffer,
    dialect: Dialect,
): Promise<Record<string, VaultSecret>> {

    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    const [rows, err] = await attempt(async () => {

        return ndb
            .selectFrom(tables.vault as keyof NoormDatabase)
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
 * Uses dialect-aware table names to support both legacy prefixed and
 * schema-qualified table locations.
 *
 * @param db - Kysely database instance
 * @param dialect - Database dialect for table name resolution
 * @returns Array of secret key names
 *
 * @example
 * ```typescript
 * const keys = await listVaultSecretKeys(db, 'postgres');
 * console.log('Vault contains:', keys);
 * ```
 */
export async function listVaultSecretKeys(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
): Promise<string[]> {

    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    const [rows, err] = await attempt(async () => {

        return ndb
            .selectFrom(tables.vault as keyof NoormDatabase)
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
 * Uses dialect-aware table names to support both legacy prefixed and
 * schema-qualified table locations.
 *
 * @param db - Kysely database instance
 * @param secretKey - The secret's key name
 * @param dialect - Database dialect for table name resolution
 *
 * @example
 * ```typescript
 * await deleteVaultSecret(db, 'OLD_API_KEY', 'postgres');
 * ```
 */
export async function deleteVaultSecret(
    db: Kysely<NoormDatabase>,
    secretKey: string,
    dialect: Dialect,
): Promise<[boolean, Error | null]> {

    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    const [result, err] = await attempt(async () => {

        return ndb
            .deleteFrom(tables.vault as keyof NoormDatabase)
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
 * Uses dialect-aware table names to support both legacy prefixed and
 * schema-qualified table locations.
 *
 * @param db - Kysely database instance
 * @param secretKey - The secret's key name
 * @param dialect - Database dialect for table name resolution
 * @returns True if the secret exists
 */
export async function vaultSecretExists(
    db: Kysely<NoormDatabase>,
    secretKey: string,
    dialect: Dialect,
): Promise<boolean> {

    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    const [row, err] = await attempt(async () => {

        return ndb
            .selectFrom(tables.vault as keyof NoormDatabase)
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
 * Uses dialect-aware table names to support both legacy prefixed and
 * schema-qualified table locations.
 *
 * @param db - Kysely database instance
 * @param identityHash - Current user's identity hash
 * @param dialect - Database dialect for table name resolution
 *
 * @example
 * ```typescript
 * const status = await getVaultStatus(db, identity.identityHash, 'postgres');
 * console.log('Vault initialized:', status.isInitialized);
 * console.log('Has access:', status.hasAccess);
 * ```
 */
export async function getVaultStatus(
    db: Kysely<NoormDatabase>,
    identityHash: string,
    dialect: Dialect,
): Promise<VaultStatus> {

    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    // Count secrets
    const [secretRows] = await attempt(async () => {

        return ndb
            .selectFrom(tables.vault as keyof NoormDatabase)
            .select(ndb.fn.count('id').as('count'))
            .executeTakeFirst();

    });

    const secretCount = secretRows ? Number(secretRows.count) : 0;

    // Count users with/without access
    const [identityRows] = await attempt(async () => {

        return ndb
            .selectFrom(tables.identities as keyof NoormDatabase)
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
