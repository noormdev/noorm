/**
 * `resolveVaultKey` (v1/49-54 finding 2) — the shared "resolve the vault
 * key for the current identity, degrade to null on any failure" helper.
 * Before this it was copy-pasted near-identically in five places (`run`/
 * `changes`/`templates` SDK namespaces plus `run preview`/`run inspect`);
 * this pins the degrade contract once so a future change is one edit, not
 * five found by grep. Live-vault precedence for the render-context
 * builders that call it is proven in
 * `tests/integration/sdk/run-vault-secrets.test.ts` and
 * `tests/sdk/render-vault-tier.test.ts`.
 *
 * SQLite in-memory keeps this fast and offline — no live DB required to
 * prove the degrade path.
 */
import { afterEach, describe, expect, it } from 'bun:test';

import type { Kysely } from 'kysely';

import { resolveVaultKey } from '../../../src/core/vault/index.js';
import { createConnection } from '../../../src/core/connection/factory.js';
import { generateKeyPair, computeIdentityHash } from '../../../src/core/identity/index.js';
import {
    setIdentityOverride,
    clearIdentityOverride,
    setKeyOverride,
    clearKeyOverride,
} from '../../../src/core/identity/storage.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';

afterEach(() => {

    clearIdentityOverride();
    clearKeyOverride();

});

describe('vault: resolveVaultKey (shared degrade helper)', () => {

    it('degrades to null, no throw, when no identity is set up', async () => {

        clearIdentityOverride();
        clearKeyOverride();

        const conn = await createConnection({ dialect: 'sqlite', database: ':memory:' }, '__test__');

        const vaultKey = await resolveVaultKey(conn.db as unknown as Kysely<NoormDatabase>, 'sqlite');

        expect(vaultKey).toBeNull();

        await conn.destroy();

    });

    it('degrades to null, no throw, when the identity/vault tables cannot be reached', async () => {

        const { publicKey, privateKey } = generateKeyPair();
        const identityHash = computeIdentityHash({
            email: 'probe@example.com',
            name: 'Probe',
            machine: 'test-machine',
            os: 'test-os',
        });

        setIdentityOverride({
            identityHash,
            name: 'Probe',
            email: 'probe@example.com',
            publicKey,
            machine: 'test-machine',
            os: 'test-os',
            createdAt: new Date().toISOString(),
        });
        setKeyOverride(privateKey);

        // No schema bootstrapped — the identities table doesn't exist, so
        // the lookup fails exactly like an unreachable database would.
        const conn = await createConnection({ dialect: 'sqlite', database: ':memory:' }, '__test__');

        const vaultKey = await resolveVaultKey(conn.db as unknown as Kysely<NoormDatabase>, 'sqlite');

        expect(vaultKey).toBeNull();

        await conn.destroy();

    });

});
