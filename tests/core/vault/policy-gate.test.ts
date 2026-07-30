/**
 * Vault authorization tests.
 *
 * The vault is the team's shared secret store and `access` is the only
 * authorization mechanism noorm has. Before these tests existed a `viewer`
 * config — denied `run build` — could still write, delete and hand out every
 * vault secret, because no vault permission existed and no vault code path
 * consulted the policy.
 *
 * These assert the *intent*: a role that cannot run a build cannot touch the
 * secret store either, on any surface, because the gate lives in core.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Kysely, SqliteDialect } from 'kysely';
import { attempt } from '@logosdx/utils';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import {
    initializeVault,
    initializeVaultChecked,
    getVaultKeyChecked,
    setVaultSecretChecked,
    deleteVaultSecretChecked,
    listVaultSecretKeysChecked,
    getVaultSecret,
} from '../../../src/core/vault/storage.js';
import { propagateVaultKeyChecked, propagateVaultKeyToChecked } from '../../../src/core/vault/propagate.js';
import type { VaultPolicyGate } from '../../../src/core/vault/policy.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';
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

const gateFor = (access: ConfigAccess): VaultPolicyGate => ({
    configName: 'testcfg',
    access,
    channel: 'user',
});

const VIEWER = gateFor({ user: 'viewer', agent: 'viewer' });
const ADMIN = gateFor({ user: 'admin', agent: 'admin' });

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

describe('vault: policy gate', () => {

    let db: Kysely<NoormDatabase>;
    let alice: TestIdentity;
    let vaultKey: Buffer;

    beforeEach(async () => {

        db = await createTestDb();
        alice = await seedIdentity(db);

        const [key, err] = await initializeVault(db, alice.identityHash, alice.publicKey, 'sqlite');

        expect(err).toBeNull();

        vaultKey = key as Buffer;

    });

    afterEach(async () => {

        await db.destroy();

    });

    it('should refuse a viewer the vault key, so no read path can decrypt', async () => {

        const [, err] = await attempt(() =>
            getVaultKeyChecked(VIEWER, db, alice.identityHash, alice.privateKey, 'sqlite'),
        );

        expect(err).toBeInstanceOf(Error);
        expect(err?.message).toContain('vault:read');

    });

    it('should refuse a viewer a vault write and leave the secret unwritten', async () => {

        const [, err] = await attempt(() =>
            setVaultSecretChecked(VIEWER, db, vaultKey, 'API_KEY', 'sk-viewer-wrote-this', 'alice', 'sqlite'),
        );

        expect(err).toBeInstanceOf(Error);
        expect(err?.message).toContain('vault:write');

        // The denial must be an actual block, not just a thrown message.
        expect(await getVaultSecret(db, vaultKey, 'API_KEY', 'sqlite')).toBeNull();

    });

    it('should refuse a viewer a vault delete and leave the secret intact', async () => {

        await setVaultSecretChecked(ADMIN, db, vaultKey, 'KEEP_ME', 'still-here', 'alice', 'sqlite');

        const [, err] = await attempt(() =>
            deleteVaultSecretChecked(VIEWER, db, 'KEEP_ME', 'sqlite'),
        );

        expect(err).toBeInstanceOf(Error);
        expect(err?.message).toContain('vault:write');
        expect(await getVaultSecret(db, vaultKey, 'KEEP_ME', 'sqlite')).toBe('still-here');

    });

    it('should refuse a viewer the list of vault key names', async () => {

        const [, err] = await attempt(() => listVaultSecretKeysChecked(VIEWER, db, 'sqlite'));

        expect(err).toBeInstanceOf(Error);
        expect(err?.message).toContain('vault:read');

    });

    it('should refuse a viewer vault init', async () => {

        const [, err] = await attempt(() =>
            initializeVaultChecked(VIEWER, db, alice.identityHash, alice.publicKey, 'sqlite'),
        );

        expect(err).toBeInstanceOf(Error);
        expect(err?.message).toContain('vault:write');

    });

    it('should refuse a viewer propagation, so a denied role cannot hand out the vault', async () => {

        const bob = await seedIdentity(db, 'bob@example.com', 'Bob');

        const [, err] = await attempt(() =>
            propagateVaultKeyChecked(VIEWER, db, vaultKey, 'sqlite'),
        );

        expect(err).toBeInstanceOf(Error);
        expect(err?.message).toContain('vault:propagate');

        const [, toErr] = await attempt(() =>
            propagateVaultKeyToChecked(VIEWER, db, vaultKey, bob.identityHash, 'sqlite'),
        );

        expect(toErr).toBeInstanceOf(Error);

        // Bob must still be locked out.
        const row = await db
            .selectFrom(NOORM_TABLES.identities)
            .select('encrypted_vault_key')
            .where('identity_hash', '=', bob.identityHash)
            .executeTakeFirst();

        expect(row?.encrypted_vault_key).toBeNull();

    });

    it('should deny when the config carries no access declaration at all', async () => {

        const noAccess: VaultPolicyGate = { configName: 'legacy', channel: 'user' };

        const [, err] = await attempt(() =>
            setVaultSecretChecked(noAccess, db, vaultKey, 'K', 'v', 'alice', 'sqlite'),
        );

        expect(err).toBeInstanceOf(Error);
        expect(err?.message).toContain('no access configuration');

    });

    it('should let an admin through every gated operation', async () => {

        const [, setErr] = await setVaultSecretChecked(ADMIN, db, vaultKey, 'API_KEY', 'sk-live', 'alice', 'sqlite');

        expect(setErr).toBeNull();

        expect(await listVaultSecretKeysChecked(ADMIN, db, 'sqlite')).toContain('API_KEY');
        expect(await getVaultKeyChecked(ADMIN, db, alice.identityHash, alice.privateKey, 'sqlite')).toBeInstanceOf(Buffer);

        const [deleted, delErr] = await deleteVaultSecretChecked(ADMIN, db, 'API_KEY', 'sqlite');

        expect(delErr).toBeNull();
        expect(deleted).toBe(true);

    });

});
