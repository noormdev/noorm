/**
 * Vault storage CRUD tests.
 *
 * Mirrors `tests/core/vault/idempotent-init.test.ts`'s harness: in-memory SQLite,
 * `v1.up` bootstrap, `seedIdentity` reusing `generateKeyPair`/`computeIdentityHash`.
 * The vault key under test is always obtained via a real `initializeVault()` call
 * (never a hand-rolled buffer) so these tests exercise the full path a real caller
 * takes, including `getVaultKey`'s DB-backed decrypt lookup.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Kysely, SqliteDialect } from 'kysely';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { initializeVault } from '../../../src/core/vault/index.js';
import {
    setVaultSecret,
    getVaultSecret,
    getAllVaultSecrets,
    vaultSecretExists,
    deleteVaultSecret,
    getVaultKey,
    getVaultStatus,
} from '../../../src/core/vault/storage.js';
import {
    NOORM_TABLES,
    type NoormDatabase,
} from '../../../src/core/shared/index.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import {
    generateKeyPair,
    computeIdentityHash,
} from '../../../src/core/identity/index.js';

interface TestIdentity {
    identityHash: string;
    publicKey: string;
    privateKey: string;
}

async function createTestDb(): Promise<Kysely<NoormDatabase>> {

    const db = new Kysely<NoormDatabase>({
        dialect: new SqliteDialect({
            database: new BunSqliteDatabase(':memory:') as never,
        }),
    });

    await v1.up(db as Kysely<unknown>, 'sqlite');

    return db;

}

async function seedIdentity(
    db: Kysely<NoormDatabase>,
    email = 'alice@example.com',
    name = 'Alice',
): Promise<TestIdentity> {

    const { publicKey, privateKey } = generateKeyPair();
    const identityHash = computeIdentityHash({
        email,
        name,
        machine: 'test-machine',
        os: 'test-os',
    });

    await db
        .insertInto(NOORM_TABLES.identities)
        .values({
            identity_hash: identityHash,
            email,
            name,
            machine: 'test-machine',
            os: 'test-os',
            public_key: publicKey,
            encrypted_vault_key: null,
        } as never)
        .execute();

    return { identityHash, publicKey, privateKey };

}

describe('vault: storage CRUD', () => {

    let db: Kysely<NoormDatabase>;

    beforeEach(async () => {

        db = await createTestDb();

    });

    afterEach(async () => {

        await db.destroy();

    });

    it('should round-trip a secret through real DB storage (setVaultSecret -> getVaultSecret)', async () => {

        const alice = await seedIdentity(db);
        const [vaultKey, err] = await initializeVault(db, alice.identityHash, alice.publicKey, 'sqlite');

        expect(err).toBeNull();
        expect(vaultKey).toBeInstanceOf(Buffer);

        const [, setErr] = await setVaultSecret(
            db,
            vaultKey as Buffer,
            'API_KEY',
            'sk-live-abc123',
            alice.identityHash,
            'sqlite',
        );

        expect(setErr).toBeNull();

        const value = await getVaultSecret(db, vaultKey as Buffer, 'API_KEY', 'sqlite');

        expect(value).toBe('sk-live-abc123');

    });

    it('should update the existing row (not insert a duplicate) when setVaultSecret is called twice with the same key', async () => {

        const alice = await seedIdentity(db);
        const [vaultKey] = await initializeVault(db, alice.identityHash, alice.publicKey, 'sqlite');

        await setVaultSecret(db, vaultKey as Buffer, 'API_KEY', 'first-value', alice.identityHash, 'sqlite');
        await setVaultSecret(db, vaultKey as Buffer, 'API_KEY', 'second-value', 'bob@example.com', 'sqlite');

        const rows = await db
            .selectFrom(NOORM_TABLES.vault)
            .selectAll()
            .where('secret_key', '=', 'API_KEY')
            .execute();

        expect(rows.length).toBe(1);
        expect(rows[0].set_by).toBe('bob@example.com');

        const value = await getVaultSecret(db, vaultKey as Buffer, 'API_KEY', 'sqlite');

        expect(value).toBe('second-value');

    });

    it('should return all secrets, correctly decrypted, keyed by secret_key', async () => {

        const alice = await seedIdentity(db);
        const [vaultKey] = await initializeVault(db, alice.identityHash, alice.publicKey, 'sqlite');

        await setVaultSecret(db, vaultKey as Buffer, 'API_KEY', 'value-1', alice.identityHash, 'sqlite');
        await setVaultSecret(db, vaultKey as Buffer, 'DB_PASSWORD', 'value-2', alice.identityHash, 'sqlite');
        await setVaultSecret(db, vaultKey as Buffer, 'JWT_SECRET', 'value-3', alice.identityHash, 'sqlite');

        const secrets = await getAllVaultSecrets(db, vaultKey as Buffer, 'sqlite');

        expect(Object.keys(secrets).sort()).toEqual(['API_KEY', 'DB_PASSWORD', 'JWT_SECRET']);
        expect(secrets.API_KEY.value).toBe('value-1');
        expect(secrets.DB_PASSWORD.value).toBe('value-2');
        expect(secrets.JWT_SECRET.value).toBe('value-3');

    });

    it('should report vaultSecretExists as false before set and true after', async () => {

        const alice = await seedIdentity(db);
        const [vaultKey] = await initializeVault(db, alice.identityHash, alice.publicKey, 'sqlite');

        expect(await vaultSecretExists(db, 'API_KEY', 'sqlite')).toBe(false);

        await setVaultSecret(db, vaultKey as Buffer, 'API_KEY', 'value', alice.identityHash, 'sqlite');

        expect(await vaultSecretExists(db, 'API_KEY', 'sqlite')).toBe(true);

    });

    it('should delete an existing secret and return [true, null]', async () => {

        const alice = await seedIdentity(db);
        const [vaultKey] = await initializeVault(db, alice.identityHash, alice.publicKey, 'sqlite');

        await setVaultSecret(db, vaultKey as Buffer, 'API_KEY', 'value', alice.identityHash, 'sqlite');

        const [deleted, err] = await deleteVaultSecret(db, 'API_KEY', 'sqlite');

        expect(deleted).toBe(true);
        expect(err).toBeNull();
        expect(await vaultSecretExists(db, 'API_KEY', 'sqlite')).toBe(false);

    });

    it('should return [false, null] (not an error) when deleting a key that was never set', async () => {

        const [deleted, err] = await deleteVaultSecret(db, 'NEVER_SET', 'sqlite');

        expect(deleted).toBe(false);
        expect(err).toBeNull();

    });

    it('should decrypt the vault key via getVaultKey with the correct identity + matching private key', async () => {

        const alice = await seedIdentity(db);
        const [vaultKey, err] = await initializeVault(db, alice.identityHash, alice.publicKey, 'sqlite');

        expect(err).toBeNull();

        const fetched = await getVaultKey(db, alice.identityHash, alice.privateKey, 'sqlite');

        expect(fetched).toBeInstanceOf(Buffer);
        expect(fetched?.equals(vaultKey as Buffer)).toBe(true);

    });

    it('should return null from getVaultKey when the identityHash has an encrypted key but the privateKey does not match', async () => {

        const alice = await seedIdentity(db, 'alice@example.com', 'Alice');
        const bob = await seedIdentity(db, 'bob@example.com', 'Bob');

        await initializeVault(db, alice.identityHash, alice.publicKey, 'sqlite');

        // Query alice's identity row (which does hold an encrypted_vault_key,
        // encrypted for alice's public key) but supply bob's privateKey — a
        // mismatched key, never propagated the vault. This reaches the actual
        // decryptVaultKey call inside getVaultKey (unlike passing bob's own
        // identityHash, whose encrypted_vault_key is null and would short-circuit
        // on the row-lookup guard before decryption is ever attempted).
        const fetched = await getVaultKey(db, alice.identityHash, bob.privateKey, 'sqlite');

        expect(fetched).toBeNull();

    });

    it('should reflect isInitialized/usersWithAccess/usersWithoutAccess/hasAccess through getVaultStatus', async () => {

        const alice = await seedIdentity(db, 'alice@example.com', 'Alice');

        const beforeInit = await getVaultStatus(db, alice.identityHash, 'sqlite');

        expect(beforeInit.isInitialized).toBe(false);

        await initializeVault(db, alice.identityHash, alice.publicKey, 'sqlite');

        const afterInit = await getVaultStatus(db, alice.identityHash, 'sqlite');

        expect(afterInit.isInitialized).toBe(true);
        expect(afterInit.usersWithAccess).toBe(1);

        const bob = await seedIdentity(db, 'bob@example.com', 'Bob');

        const afterBobSeeded = await getVaultStatus(db, bob.identityHash, 'sqlite');

        expect(afterBobSeeded.usersWithoutAccess).toBe(1);
        expect(afterBobSeeded.hasAccess).toBe(false);

    });

    describe('absence vs. infra failure', () => {

        it('should resolve getVaultKey to null on genuine absence (identity row exists, key never set)', async () => {

            const alice = await seedIdentity(db);

            const fetched = await getVaultKey(db, alice.identityHash, alice.privateKey, 'sqlite');

            expect(fetched).toBeNull();

        });

        it('should propagate a thrown error from getVaultKey when the query itself fails', async () => {

            const alice = await seedIdentity(db);

            await db.destroy();

            await expect(
                getVaultKey(db, alice.identityHash, alice.privateKey, 'sqlite'),
            ).rejects.toThrow();

            // Recreate so afterEach can destroy cleanly.
            db = await createTestDb();

        });

        it('should resolve getVaultSecret to null on genuine absence (key never set)', async () => {

            const alice = await seedIdentity(db);
            const [vaultKey] = await initializeVault(db, alice.identityHash, alice.publicKey, 'sqlite');

            const value = await getVaultSecret(db, vaultKey as Buffer, 'NEVER_SET', 'sqlite');

            expect(value).toBeNull();

        });

        it('should propagate a thrown error from getVaultSecret when the query itself fails', async () => {

            const alice = await seedIdentity(db);
            const [vaultKey] = await initializeVault(db, alice.identityHash, alice.publicKey, 'sqlite');

            await db.destroy();

            await expect(
                getVaultSecret(db, vaultKey as Buffer, 'API_KEY', 'sqlite'),
            ).rejects.toThrow();

            // Recreate so afterEach can destroy cleanly.
            db = await createTestDb();

        });

    });

});
