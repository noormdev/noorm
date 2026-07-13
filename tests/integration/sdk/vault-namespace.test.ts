/**
 * Integration tests for VaultNamespace against live postgres/mysql/mssql —
 * proves the tuple-to-throw contract (v1-25) holds against real
 * infrastructure, not the mocked/sqlite harness `tests/sdk/vault-namespace.test.ts`
 * already covers.
 *
 * The pair that matters most is (b)/(c): a genuinely-absent key must
 * resolve `null` (not an error), while a real infra failure (destroyed
 * connection, dropped table) must reject — the SDK boundary must never
 * collapse the two into the same falsy shape.
 *
 * Schema is rebuilt fresh per test (not per describe block) because (e)
 * drops the vault table to force a write failure; leaving that in place
 * would break every test that runs after it in the same dialect block.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';

import type { Kysely } from 'kysely';

import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import { v2 } from '../../../src/core/version/schema/migrations/v2.js';
import { VaultNamespace, VaultAccessError } from '../../../src/sdk/namespaces/vault.js';
import { NotConnectedError } from '../../../src/sdk/guards.js';
import {
    generateKeyPair,
    computeIdentityHash,
} from '../../../src/core/identity/index.js';
import {
    setIdentityOverride,
    clearIdentityOverride,
} from '../../../src/core/identity/storage.js';
import {
    NOORM_TABLES,
    getNoormTables,
    noormDb,
    type NoormDatabase,
    type NoormTableNames,
} from '../../../src/core/shared/index.js';
import {
    createTestConnection,
    skipIfNoContainer,
    TEST_CONNECTIONS,
    makeTestConfig,
} from '../../utils/db.js';

import type { ContextState } from '../../../src/sdk/state.js';
import type { Config } from '../../../src/core/config/types.js';
import type { ConnectionResult, Dialect } from '../../../src/core/connection/types.js';

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

interface TestIdentity {
    identityHash: string;
    publicKey: string;
    privateKey: string;
}

// Children before parents (executions -> change FK). Same order v1.down uses.
const DROP_ORDER: Array<keyof NoormTableNames> = ['vault', 'identities', 'lock', 'executions', 'change', 'version'];

/**
 * Drop every noorm tracking table, in both possible locations.
 *
 * `v2` moves postgres/mssql tables into a schema-qualified `noorm.*`
 * layout — every vault/identity storage function reads through that
 * layout exclusively (`noormDb()`/`getNoormTables()`), so a v1-only
 * bootstrap leaves those functions unable to find their own tables.
 * `v1.down`/`v2.down` assume a known-clean sequential state and abort on
 * the first missing object (e.g. after a test manually drops the vault
 * table), so this drops directly via `ifExists()` in both the
 * schema-qualified and legacy prefixed locations instead — idempotent
 * regardless of what the previous test left behind.
 */
async function dropAllNoormTables(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

    const ndb = noormDb(db as Kysely<NoormDatabase>, dialect);
    const schemaTables = getNoormTables(dialect);

    for (const key of DROP_ORDER) {

        await ndb.schema.dropTable(schemaTables[key]).ifExists().execute();
        await db.schema.dropTable(NOORM_TABLES[key]).ifExists().execute();

    }

}

async function rebuildSchema(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

    await dropAllNoormTables(db, dialect);
    await v1.up(db, dialect);
    await v2.up(db, dialect);

}

async function seedIdentity(
    db: Kysely<unknown>,
    dialect: Dialect,
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

    const ndb = noormDb(db as Kysely<NoormDatabase>, dialect);
    const tables = getNoormTables(dialect);

    await ndb
        .insertInto(tables.identities as keyof NoormDatabase)
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

function makeState(connection: ConnectionResult | null, config: Config): ContextState {

    return {
        connection,
        config,
        settings: {},
        identity: { name: 'tester', source: 'system' },
        options: {},
        projectRoot: '/tmp',
        changeManager: null,
    };

}

// ─────────────────────────────────────────────────────────────
// Suite factory — identical behavior across dialects, only the
// connection/config differ, so one factory generates all three
// `describe` blocks instead of tripling the test bodies.
// ─────────────────────────────────────────────────────────────

function describeVaultNamespace(dialect: Dialect): void {

    describe(`sdk: VaultNamespace live throw contract (${dialect})`, () => {

        let conn: ConnectionResult;
        let config: Config;
        let alice: TestIdentity;

        beforeAll(async () => {

            await skipIfNoContainer(dialect);
            conn = await createTestConnection(dialect);
            config = makeTestConfig(`vault-ns-${dialect}`, TEST_CONNECTIONS[dialect]);

        });

        afterAll(async () => {

            if (!conn) return;

            await dropAllNoormTables(conn.db, dialect);
            await conn.destroy();

        });

        beforeEach(async () => {

            await rebuildSchema(conn.db, dialect);
            alice = await seedIdentity(conn.db, dialect);
            overrideIdentity(alice);

        });

        afterEach(() => {

            clearIdentityOverride();

        });

        it('(a) vault.get() rejects NotConnectedError when there is no connection', async () => {

            const vault = new VaultNamespace(makeState(null, config));

            await expect(vault.get('ANY_KEY', alice.privateKey)).rejects.toThrow(NotConnectedError);

        });

        it('(b) vault.get() resolves null for a genuinely absent key (vault initialized, key never set)', async () => {

            const vault = new VaultNamespace(makeState(conn, config));
            await vault.init();

            const result = await vault.get('MISSING_KEY', alice.privateKey);

            expect(result).toBeNull();

        });

        it('(c) vault.get() rejects on a real infra failure (dedicated connection destroyed before the call)', async () => {

            const vault = new VaultNamespace(makeState(conn, config));
            await vault.init();

            const dedicated = await createTestConnection(dialect);
            const brokenVault = new VaultNamespace(makeState(dedicated, config));
            await dedicated.destroy();

            await expect(brokenVault.get('ANY_KEY', alice.privateKey)).rejects.toThrow();

        });

        it('(d) vault.set() rejects VaultAccessError when this identity has no vault access', async () => {

            // Vault never initialized for this identity — #getVaultKey resolves null.
            const vault = new VaultNamespace(makeState(conn, config));

            await expect(
                vault.set('API_KEY', 'value', alice.privateKey),
            ).rejects.toThrow(VaultAccessError);

        });

        it('(e) vault.set() rejects a generic Error (not VaultAccessError) when the vault table is dropped before the write', async () => {

            const vault = new VaultNamespace(makeState(conn, config));
            await vault.init();

            // Vault key resolves fine (identities table intact); drop the vault
            // table so setVaultSecret's write fails after #getVaultKey succeeds.
            const ndb = noormDb(conn.db as Kysely<NoormDatabase>, dialect);
            await ndb.schema.dropTable(getNoormTables(dialect).vault).execute();

            const err = await vault.set('API_KEY', 'value', alice.privateKey).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(Error);
            expect(err).not.toBeInstanceOf(VaultAccessError);

        });

        it('(f) vault.get() rejects when the vault secrets table is gone but the identity/key is intact (isolates getVaultSecret\'s read-path throw)', async () => {

            const vault = new VaultNamespace(makeState(conn, config));
            await vault.init();

            // Vault key resolves fine (identities table intact); drop only the
            // vault table so getVaultSecret's read fails after #getVaultKey
            // succeeds — case (c) destroys the whole connection and only
            // proves #getVaultKey's throw, since that read happens first.
            const ndb = noormDb(conn.db as Kysely<NoormDatabase>, dialect);
            await ndb.schema.dropTable(getNoormTables(dialect).vault).execute();

            const err = await vault.get('ANY_KEY', alice.privateKey).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(Error);
            expect(err).not.toBeInstanceOf(NotConnectedError);

        });

    });

}

describeVaultNamespace('postgres');
describeVaultNamespace('mysql');
describeVaultNamespace('mssql');
