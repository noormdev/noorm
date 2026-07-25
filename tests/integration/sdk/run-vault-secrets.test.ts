/**
 * Integration tests for CP6 — the render path connects the vault tier.
 *
 * `resolveSecret`/`buildSecretsContext` (`src/core/vault/resolve.ts`)
 * implemented the documented config-local > global-local > vault
 * precedence with no production caller: every render-context builder
 * called `StateManager.getAllSecrets(configName)` instead, which never
 * touches the vault. A `noorm vault set` secret reached no template, for
 * any identity. Proven here against a live database — a mock would not
 * catch a defect that lived entirely in which resolver function got
 * called, not in the resolver logic itself.
 *
 * `RunNamespace` and `TemplatesNamespace` are asserted against the same
 * vault-only secret to prove the apply path and the render/preview path
 * resolve identical tiers — the parity CP6 exists to guarantee.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Kysely } from 'kysely';

import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import { v2 } from '../../../src/core/version/schema/migrations/v2.js';
import { RunNamespace } from '../../../src/sdk/namespaces/run.js';
import { TemplatesNamespace } from '../../../src/sdk/namespaces/templates.js';
import {
    generateKeyPair,
    computeIdentityHash,
} from '../../../src/core/identity/index.js';
import {
    setIdentityOverride,
    clearIdentityOverride,
    setKeyOverride,
    clearKeyOverride,
} from '../../../src/core/identity/storage.js';
import { initializeVault, setVaultSecret } from '../../../src/core/vault/index.js';
import {
    NOORM_TABLES,
    getNoormTables,
    noormDb,
    type NoormDatabase,
    type NoormTableNames,
} from '../../../src/core/shared/index.js';
import { getStateManager, resetStateManager } from '../../../src/core/state/index.js';
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
// Fixtures — mirrors tests/integration/sdk/vault-namespace.test.ts's
// schema/identity harness (postgres only here; the vault resolver itself
// is dialect-agnostic, and CP6 does not touch dialect-specific code).
// ─────────────────────────────────────────────────────────────

const dialect: Dialect = 'postgres';

interface TestIdentity {
    identityHash: string;
    email: string;
    publicKey: string;
    privateKey: string;
}

const DROP_ORDER: Array<keyof NoormTableNames> = ['vault', 'identities', 'lock', 'executions', 'change', 'version'];

async function dropAllNoormTables(db: Kysely<unknown>): Promise<void> {

    const ndb = noormDb(db as Kysely<NoormDatabase>, dialect);
    const schemaTables = getNoormTables(dialect);

    for (const key of DROP_ORDER) {

        await ndb.schema.dropTable(schemaTables[key]).ifExists().execute();
        await db.schema.dropTable(NOORM_TABLES[key]).ifExists().execute();

    }

}

async function rebuildSchema(db: Kysely<unknown>): Promise<void> {

    await dropAllNoormTables(db);
    await v1.up(db, dialect);
    await v2.up(db, dialect);

}

async function seedIdentity(db: Kysely<unknown>, email = 'alice@example.com', name = 'Alice'): Promise<TestIdentity> {

    const { publicKey, privateKey } = generateKeyPair();
    const identityHash = computeIdentityHash({ email, name, machine: 'test-machine', os: 'test-os' });

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

    return { identityHash, email, publicKey, privateKey };

}

function overrideIdentity(identity: TestIdentity, name = 'Alice'): void {

    setIdentityOverride({
        identityHash: identity.identityHash,
        name,
        email: identity.email,
        publicKey: identity.publicKey,
        machine: 'test-machine',
        os: 'test-os',
        createdAt: new Date().toISOString(),
    });
    setKeyOverride(identity.privateKey);

}

// ─────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────

describe('sdk: render path connects the vault tier (CP6, postgres)', () => {

    let conn: ConnectionResult;
    let config: Config;
    let projectRoot: string;
    let identity: TestIdentity;

    beforeAll(async () => {

        await skipIfNoContainer(dialect);
        conn = await createTestConnection(dialect);
        config = makeTestConfig('vault-render-postgres', TEST_CONNECTIONS[dialect]);

    });

    afterAll(async () => {

        if (!conn) return;

        await dropAllNoormTables(conn.db);
        await conn.destroy();

    });

    beforeEach(async () => {

        await rebuildSchema(conn.db);
        identity = await seedIdentity(conn.db);

        projectRoot = await mkdtemp(join(tmpdir(), 'noorm-vault-render-'));
        await mkdir(join(projectRoot, 'sql'), { recursive: true });

        resetStateManager();
        const state = getStateManager(projectRoot);
        await state.load();
        await state.setConfig(config.name, config);

    });

    afterEach(async () => {

        clearIdentityOverride();
        clearKeyOverride();
        resetStateManager();
        await rm(projectRoot, { recursive: true, force: true });

    });

    function makeState(): ContextState {

        return {
            connection: conn,
            config,
            settings: {},
            identity: { name: 'tester', source: 'system' },
            options: {},
            projectRoot,
            changeManager: null,
        };

    }

    async function writeTemplate(key: string): Promise<string> {

        const relPath = join('sql', `${key.toLowerCase()}.sql.tmpl`);
        await writeFile(join(projectRoot, relPath), `select '{%~ $.secrets.${key} %}' as val;`);

        return relPath;

    }

    it('resolves a secret set only in the vault tier', async () => {

        const [vaultKey, initErr] = await initializeVault(conn.db, identity.identityHash, identity.publicKey, dialect);
        expect(initErr).toBeNull();
        expect(vaultKey).not.toBeNull();

        const [, setErr] = await setVaultSecret(conn.db, vaultKey!, 'DB_PASS_WORKER', 'vault-only-value', identity.email, dialect);
        expect(setErr).toBeNull();

        overrideIdentity(identity);

        const relPath = await writeTemplate('DB_PASS_WORKER');
        const templates = new TemplatesNamespace(makeState());

        const result = await templates.render(relPath);

        expect(result.sql).toContain('vault-only-value');

    });

    it('applies config-local > global-local > vault precedence for the same key', async () => {

        const [vaultKey] = await initializeVault(conn.db, identity.identityHash, identity.publicKey, dialect);
        await setVaultSecret(conn.db, vaultKey!, 'SHARED_KEY', 'from-vault', identity.email, dialect);
        await setVaultSecret(conn.db, vaultKey!, 'GLOBAL_OR_VAULT', 'from-vault-2', identity.email, dialect);

        overrideIdentity(identity);

        const state = getStateManager(projectRoot);
        await state.setGlobalSecret('SHARED_KEY', 'from-global');
        await state.setGlobalSecret('GLOBAL_OR_VAULT', 'from-global-2');
        await state.setSecret(config.name, 'SHARED_KEY', 'from-config');

        const templates = new TemplatesNamespace(makeState());

        // config-local beats global-local and vault for the same key
        const allThreeTiers = await templates.render(await writeTemplate('SHARED_KEY'));
        expect(allThreeTiers.sql).toContain('from-config');
        expect(allThreeTiers.sql).not.toContain('from-global');
        expect(allThreeTiers.sql).not.toContain('from-vault');

        // global-local beats vault when no config-local override exists
        const globalOverVault = await templates.render(await writeTemplate('GLOBAL_OR_VAULT'));
        expect(globalOverVault.sql).toContain('from-global-2');
        expect(globalOverVault.sql).not.toContain('from-vault-2');

    });

    it('degrades to local tiers without throwing when this identity has no vault key', async () => {

        // Vault never initialized for this identity — the resolver must
        // still resolve local secrets, not throw.
        overrideIdentity(identity);

        const state = getStateManager(projectRoot);
        await state.setSecret(config.name, 'LOCAL_ONLY', 'config-value');

        const templates = new TemplatesNamespace(makeState());

        const result = await templates.render(await writeTemplate('LOCAL_ONLY'));

        expect(result.sql).toContain('config-value');

    });

    it('RunNamespace resolves the same vault-tier secret TemplatesNamespace does (apply/preview parity)', async () => {

        const [vaultKey] = await initializeVault(conn.db, identity.identityHash, identity.publicKey, dialect);
        await setVaultSecret(conn.db, vaultKey!, 'PARITY_KEY', 'vault-parity-value', identity.email, dialect);

        overrideIdentity(identity);

        const relPath = await writeTemplate('PARITY_KEY');

        const templates = new TemplatesNamespace(makeState());
        const rendered = await templates.render(relPath);

        const run = new RunNamespace(makeState());
        const previewed = await run.preview([join(projectRoot, relPath)]);

        expect(rendered.sql).toContain('vault-parity-value');
        expect(previewed[0]?.status).toBe('success');
        expect(previewed[0]?.renderedSql).toContain('vault-parity-value');

    });

});
