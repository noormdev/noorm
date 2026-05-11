/**
 * Vault init() idempotency tests.
 *
 * Asserts the contract documented on `initializeVault`:
 *   - First call:  [Buffer, null]
 *   - Repeat call: [null, null] (no state change, no event)
 *   - DB error:    [null, Error]
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Kysely, SqliteDialect } from 'kysely';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { initializeVault } from '../../../src/core/vault/index.js';
import { observer } from '../../../src/core/observer.js';
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

describe('vault: initializeVault idempotency', () => {

    let db: Kysely<NoormDatabase>;

    beforeEach(async () => {

        db = await createTestDb();

    });

    afterEach(async () => {

        await db.destroy();

    });

    it('should return [Buffer, null] on first init', async () => {

        const alice = await seedIdentity(db);

        const [vaultKey, err] = await initializeVault(
            db,
            alice.identityHash,
            alice.publicKey,
            'sqlite',
        );

        expect(err).toBeNull();
        expect(vaultKey).toBeInstanceOf(Buffer);
        expect(vaultKey?.length).toBe(32);

    });

    it('should return [null, null] on repeat init (idempotent)', async () => {

        const alice = await seedIdentity(db);

        const [firstKey, firstErr] = await initializeVault(
            db,
            alice.identityHash,
            alice.publicKey,
            'sqlite',
        );

        expect(firstErr).toBeNull();
        expect(firstKey).toBeInstanceOf(Buffer);

        const [secondKey, secondErr] = await initializeVault(
            db,
            alice.identityHash,
            alice.publicKey,
            'sqlite',
        );

        expect(secondErr).toBeNull();
        expect(secondKey).toBeNull();

    });

    it('should not regenerate the encrypted_vault_key on repeat init', async () => {

        const alice = await seedIdentity(db);

        await initializeVault(db, alice.identityHash, alice.publicKey, 'sqlite');

        const beforeRows = await db
            .selectFrom(NOORM_TABLES.identities)
            .select('encrypted_vault_key')
            .where('encrypted_vault_key', 'is not', null)
            .execute();

        expect(beforeRows.length).toBe(1);
        const originalEncryptedKey = beforeRows[0].encrypted_vault_key;

        await initializeVault(db, alice.identityHash, alice.publicKey, 'sqlite');

        const afterRows = await db
            .selectFrom(NOORM_TABLES.identities)
            .select('encrypted_vault_key')
            .where('encrypted_vault_key', 'is not', null)
            .execute();

        expect(afterRows.length).toBe(1);
        expect(afterRows[0].encrypted_vault_key).toBe(originalEncryptedKey);

    });

    it('should emit vault:initialized event only on first init, not on repeat', async () => {

        const alice = await seedIdentity(db);
        const events: Array<{ identityHash: string }> = [];

        const unsub = observer.on('vault:initialized', (data) => {

            events.push(data);

        });

        await initializeVault(db, alice.identityHash, alice.publicKey, 'sqlite');

        expect(events.length).toBe(1);
        expect(events[0].identityHash).toBe(alice.identityHash);

        await initializeVault(db, alice.identityHash, alice.publicKey, 'sqlite');

        expect(events.length).toBe(1);

        unsub();

    });

    it('should return [null, null] when called by a different identity after init', async () => {

        const alice = await seedIdentity(db, 'alice@example.com', 'Alice');
        const bob = await seedIdentity(db, 'bob@example.com', 'Bob');

        const [firstKey, firstErr] = await initializeVault(
            db,
            alice.identityHash,
            alice.publicKey,
            'sqlite',
        );

        expect(firstErr).toBeNull();
        expect(firstKey).toBeInstanceOf(Buffer);

        const [secondKey, secondErr] = await initializeVault(
            db,
            bob.identityHash,
            bob.publicKey,
            'sqlite',
        );

        expect(secondErr).toBeNull();
        expect(secondKey).toBeNull();

    });

    it('should return [null, Error] on actual DB failure', async () => {

        const alice = await seedIdentity(db);

        // Destroy the connection to force a real DB error on the check query.
        await db.destroy();

        const [vaultKey, err] = await initializeVault(
            db,
            alice.identityHash,
            alice.publicKey,
            'sqlite',
        );

        expect(vaultKey).toBeNull();
        expect(err).toBeInstanceOf(Error);

        // Recreate so afterEach can destroy cleanly.
        db = await createTestDb();

    });

});
