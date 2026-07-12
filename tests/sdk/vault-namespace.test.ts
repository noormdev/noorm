/**
 * VaultNamespace SDK wrapper tests — tuple-to-throw contract conversion (v1-25 CP2).
 *
 * `init()`/`set()`/`delete()`/`copy()` used to return `[value, Error|null]` tuples;
 * they now throw. `get`/`getAll`/`list`/`exists`/`propagate`/`status` are untouched
 * by this checkpoint (already fixed in CP1 via storage.ts) and aren't re-tested here.
 *
 * Harness mirrors `tests/core/vault/storage.test.ts`: in-memory SQLite, `v1.up`
 * bootstrap, `seedIdentity` reusing `generateKeyPair`/`computeIdentityHash`. The
 * `ContextState` construction mirrors `tests/sdk/destructive-ops.test.ts`'s
 * `makeState`/`makeConfig`, adapted to carry a real `connection`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, SqliteDialect } from 'kysely';

import { BunSqliteDatabase } from '../../src/core/connection/dialects/sqlite-bun.js';
import { VaultNamespace } from '../../src/sdk/namespaces/vault.js';
import { VaultAccessError } from '../../src/sdk/namespaces/vault.js';
import { initializeVault, setVaultSecret } from '../../src/core/vault/index.js';
import type { VaultCopyResult } from '../../src/core/vault/index.js';
import {
    NOORM_TABLES,
    type NoormDatabase,
} from '../../src/core/shared/index.js';
import { v1 } from '../../src/core/version/schema/migrations/v1.js';
import {
    generateKeyPair,
    computeIdentityHash,
} from '../../src/core/identity/index.js';
import {
    setIdentityOverride,
    clearIdentityOverride,
} from '../../src/core/identity/storage.js';

import type { ContextState } from '../../src/sdk/state.js';
import type { Config } from '../../src/core/config/types.js';

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

function makeConfig(name: string, connectionOverrides: Record<string, unknown> = {}): Config {

    return {
        name,
        type: 'local',
        isTest: false,
        access: { user: 'admin', mcp: 'admin' },
        connection: { dialect: 'sqlite', database: ':memory:', ...connectionOverrides },
    };

}

function makeState(db: Kysely<NoormDatabase>, config: Config = makeConfig('vault-ns-test')): ContextState {

    return {
        connection: {
            db: db as unknown as Kysely<unknown>,
            dialect: 'sqlite',
            destroy: () => db.destroy(),
        },
        config,
        settings: {},
        identity: { name: 'tester', source: 'system' },
        options: {},
        projectRoot: '/tmp',
        changeManager: null,
    };

}

function overrideIdentity(identity: TestIdentity, email = 'alice@example.com', name = 'Alice'): void {

    setIdentityOverride({
        identityHash: identity.identityHash,
        name,
        email,
        publicKey: identity.publicKey,
        machine: 'test-machine',
        os: 'test-os',
        createdAt: new Date().toISOString(),
    });

}

describe('sdk: VaultNamespace tuple-to-throw contract', () => {

    let db: Kysely<NoormDatabase>;
    let alice: TestIdentity;

    beforeEach(async () => {

        db = await createTestDb();
        alice = await seedIdentity(db);

        overrideIdentity(alice);

    });

    afterEach(async () => {

        clearIdentityOverride();
        await db.destroy();

    });

    describe('init()', () => {

        it('should resolve to a Buffer (not a tuple) on first init', async () => {

            const vault = new VaultNamespace(makeState(db));

            const result = await vault.init();

            expect(Array.isArray(result)).toBe(false);
            expect(result).toBeInstanceOf(Buffer);
            expect(result?.length).toBe(32);

        });

        it('should resolve to null (not [null, null]) on repeat init — legitimately not an error', async () => {

            const vault = new VaultNamespace(makeState(db));

            await vault.init();
            const second = await vault.init();

            expect(Array.isArray(second)).toBe(false);
            expect(second).toBeNull();

        });

        it('should throw the underlying Error (not resolve a tuple) on DB failure', async () => {

            const vault = new VaultNamespace(makeState(db));

            await db.destroy();

            await expect(vault.init()).rejects.toThrow();

            // Recreate so afterEach can destroy cleanly and re-seed the identity
            // override to match the fresh db's identity row.
            db = await createTestDb();
            alice = await seedIdentity(db);
            overrideIdentity(alice);

        });

    });

    describe('set()', () => {

        it('should resolve to undefined (not a tuple) on success', async () => {

            const vault = new VaultNamespace(makeState(db));
            await vault.init();

            const result = await vault.set('API_KEY', 'sk-live-abc', alice.privateKey);

            expect(Array.isArray(result)).toBe(false);
            expect(result).toBeUndefined();

        });

        it('should throw VaultAccessError (not a generic Error) when no vault key is available', async () => {

            // Vault never initialized for this identity — #getVaultKey resolves null.
            const vault = new VaultNamespace(makeState(db));

            await expect(
                vault.set('API_KEY', 'value', alice.privateKey),
            ).rejects.toThrow(VaultAccessError);

        });

        it('VaultAccessError should be instanceof-matchable and name the config', async () => {

            const vault = new VaultNamespace(makeState(db, makeConfig('no-access-config')));

            const err = await vault.set('API_KEY', 'value', alice.privateKey).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(VaultAccessError);
            expect((err as Error).message).toContain('no-access-config');

        });

        it('should throw the underlying Error (not VaultAccessError, not a tuple) when the vault key is valid but the write fails', async () => {

            const vault = new VaultNamespace(makeState(db));
            await vault.init();

            // Vault key resolves fine (identities table intact); drop the vault
            // table so setVaultSecret's write fails after #getVaultKey succeeds.
            await db.schema.dropTable(NOORM_TABLES.vault).execute();

            const err = await vault.set('API_KEY', 'value', alice.privateKey).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(Error);
            expect(err).not.toBeInstanceOf(VaultAccessError);

        });

    });

    describe('delete()', () => {

        it('should resolve to true (not a tuple) when the key existed', async () => {

            const vault = new VaultNamespace(makeState(db));
            await vault.init();
            await vault.set('API_KEY', 'value', alice.privateKey);

            const result = await vault.delete('API_KEY');

            expect(Array.isArray(result)).toBe(false);
            expect(result).toBe(true);

        });

        it('should resolve to false (not a tuple, not an error) when the key was never set', async () => {

            const vault = new VaultNamespace(makeState(db));

            const result = await vault.delete('NEVER_SET');

            expect(Array.isArray(result)).toBe(false);
            expect(result).toBe(false);

        });

        it('should throw the underlying Error (not resolve a tuple) on DB failure', async () => {

            const vault = new VaultNamespace(makeState(db));

            await db.destroy();

            await expect(vault.delete('API_KEY')).rejects.toThrow();

            db = await createTestDb();
            alice = await seedIdentity(db);
            overrideIdentity(alice);

        });

    });

    describe('copy()', () => {

        const tempFiles: string[] = [];

        afterEach(async () => {

            for (const file of tempFiles.splice(0)) {

                await unlink(file).catch(() => {});

            }

        });

        it('should resolve to a VaultCopyResult (not a tuple) on success', async () => {

            const sourceFile = join(
                tmpdir(),
                `noorm-vault-copy-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
            );
            tempFiles.push(sourceFile);

            const sourceSetupDb = new Kysely<NoormDatabase>({
                dialect: new SqliteDialect({ database: new BunSqliteDatabase(sourceFile) as never }),
            });

            await v1.up(sourceSetupDb as Kysely<unknown>, 'sqlite');
            await sourceSetupDb
                .insertInto(NOORM_TABLES.identities)
                .values({
                    identity_hash: alice.identityHash,
                    email: 'alice@example.com',
                    name: 'Alice',
                    machine: 'test-machine',
                    os: 'test-os',
                    public_key: alice.publicKey,
                    encrypted_vault_key: null,
                } as never)
                .execute();

            const [vaultKey] = await initializeVault(sourceSetupDb, alice.identityHash, alice.publicKey, 'sqlite');
            await setVaultSecret(sourceSetupDb, vaultKey as Buffer, 'API_KEY', 'sk-live-abc', alice.identityHash, 'sqlite');
            await sourceSetupDb.destroy();

            const sourceConfig = makeConfig('vault-copy-source', { database: sourceFile });
            const destConfig = makeConfig('vault-copy-dest');

            const vault = new VaultNamespace(makeState(db, sourceConfig));

            const result: VaultCopyResult = await vault.copy(destConfig, ['API_KEY'], alice.privateKey);

            expect(Array.isArray(result)).toBe(false);
            expect(result.copied).toEqual(['API_KEY']);
            expect(result.errors).toEqual([]);

        });

        it('should throw the underlying Error (not resolve a tuple) when the source vault is unreachable', async () => {

            const brokenConfig = makeConfig('vault-copy-broken', { database: '/nonexistent-dir-noorm-test/broken.sqlite' });

            const vault = new VaultNamespace(makeState(db, brokenConfig));

            await expect(
                vault.copy(makeConfig('vault-copy-dest'), ['API_KEY'], alice.privateKey),
            ).rejects.toThrow();

        });

    });

});
