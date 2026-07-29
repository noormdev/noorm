/**
 * Vault propagation tests.
 *
 * `propagate.ts` shipped with no test coverage at all, and carried three
 * defects: a partial grant reported as complete success, a query failure
 * indistinguishable from "nobody is waiting", and no way to target specific
 * identities. These assert the intent — an operator must be able to tell
 * whether their teammate actually got access.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { attempt } from '@logosdx/utils';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { initializeVault, getVaultStatus, setVaultSecret } from '../../../src/core/vault/storage.js';
import { propagateVaultKey, getUsersWithoutVaultAccess } from '../../../src/core/vault/propagate.js';
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
    email: string,
    name: string,
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

describe('vault: propagation', () => {

    let db: Kysely<NoormDatabase>;
    let alice: TestIdentity;
    let vaultKey: Buffer;

    beforeEach(async () => {

        db = await createTestDb();
        alice = await seedIdentity(db, 'alice@example.com', 'Alice');

        const [key] = await initializeVault(db, alice.identityHash, alice.publicKey, 'sqlite');

        vaultKey = key as Buffer;

    });

    afterEach(async () => {

        await db.destroy();

    });

    it('should report a failed grant in failed[] instead of claiming success', async () => {

        const bob = await seedIdentity(db, 'bob@example.com', 'Bob');
        const carol = await seedIdentity(db, 'carol@example.com', 'Carol');

        // Block Bob's row specifically, leaving Carol's grant to succeed —
        // the partial-failure shape that used to report success:true.
        await sql`
            CREATE TRIGGER block_bob BEFORE UPDATE ON ${sql.raw(NOORM_TABLES.identities)}
            FOR EACH ROW WHEN new.identity_hash = ${sql.lit(bob.identityHash)}
            BEGIN SELECT RAISE(ABORT, 'blocked'); END;
        `.execute(db);

        const errors: unknown[] = [];
        const off = observer.on('error', (data) => errors.push(data));

        const result = await propagateVaultKey(db, vaultKey, 'sqlite');

        off?.cleanup?.();

        expect(result.propagatedTo).toEqual([carol.identityHash]);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]?.identityHash).toBe(bob.identityHash);
        expect(result.failed[0]?.email).toBe('bob@example.com');
        expect(errors).toHaveLength(1);

        // Bob must still be without access — the whole point of reporting it.
        const row = await db
            .selectFrom(NOORM_TABLES.identities)
            .select('encrypted_vault_key')
            .where('identity_hash', '=', bob.identityHash)
            .executeTakeFirst();

        expect(row?.encrypted_vault_key).toBeNull();

    });

    it('should grant only the targeted identities, not everyone waiting', async () => {

        const bob = await seedIdentity(db, 'bob@example.com', 'Bob');
        const mallory = await seedIdentity(db, 'mallory@evil.local', 'Mallory');

        const result = await propagateVaultKey(db, vaultKey, 'sqlite', { targets: [bob.identityHash] });

        expect(result.propagatedTo).toEqual([bob.identityHash]);
        expect(result.failed).toEqual([]);

        // An identity that merely connected must not receive the vault key
        // just because someone else was granted access.
        const rogue = await db
            .selectFrom(NOORM_TABLES.identities)
            .select('encrypted_vault_key')
            .where('identity_hash', '=', mallory.identityHash)
            .executeTakeFirst();

        expect(rogue?.encrypted_vault_key).toBeNull();

    });

    it('should surface a query failure rather than report "everyone has access"', async () => {

        await sql`DROP TABLE ${sql.raw(NOORM_TABLES.identities)}`.execute(db);

        const [users, err] = await getUsersWithoutVaultAccess(db, 'sqlite');

        expect(users).toBeNull();
        expect(err).toBeInstanceOf(Error);

        // propagate must not swallow it into a benign-looking result either.
        const [, propErr] = await attempt(() => propagateVaultKey(db, vaultKey, 'sqlite'));

        expect(propErr).toBeInstanceOf(Error);

    });

    it('should report no vault access for an identity with no row', async () => {

        // A read-only DB user, a failed insert, or a dump taken before the
        // user joined all produce this. `undefined !== null` reported it as
        // having access.
        const status = await getVaultStatus(db, 'f'.repeat(64), 'sqlite');

        expect(status.isInitialized).toBe(true);
        expect(status.hasAccess).toBe(false);

    });

    it('should reject a vault key name the template layer cannot address', async () => {

        const [, err] = await setVaultSecret(db, vaultKey, 'weird-key!', 'v', 'alice', 'sqlite');

        expect(err).toBeInstanceOf(Error);
        expect(err?.message).toContain('weird-key!');

        // The same name `secret set` rejects must not be writable via the vault.
        const [, leadingUnderscore] = await setVaultSecret(db, vaultKey, '_LEADING', 'v', 'alice', 'sqlite');

        expect(leadingUnderscore).toBeInstanceOf(Error);

    });

});
