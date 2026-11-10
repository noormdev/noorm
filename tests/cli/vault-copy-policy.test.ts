import { describe, it, expect, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Kysely } from 'kysely';

import { createConnection } from '../../src/core/connection/factory.js';
import { bootstrapSchema } from '../../src/core/version/index.js';
import { NOORM_TABLES, type NoormDatabase } from '../../src/core/shared/index.js';
import { StateManager } from '../../src/core/state/manager.js';
import { generateKeyPair, computeIdentityHash } from '../../src/core/identity/index.js';
import { initializeVault, setVaultSecret, getVaultKey, getVaultSecret } from '../../src/core/vault/index.js';
import type { Config } from '../../src/core/config/types.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');

describe('cli: vault copy destination read policy', () => {

    let dir = '';
    afterEach(async () => {

        if (dir) await rm(dir, { recursive: true, force: true });

    });

    async function fixture(initialized: boolean, poisonKey = true) {

        dir = await mkdtemp(join(tmpdir(), 'noorm-vault-copy-policy-'));
        await mkdir(join(dir, '.noorm'), { recursive: true });
        const identity = generateKeyPair();
        const hash = computeIdentityHash({
            name: 'Copy User', email: 'copy@example.com', machine: identity.publicKey, os: 'env',
        });
        const manager = new StateManager(dir, { privateKey: identity.privateKey });
        await manager.load();
        for (const name of ['source', 'destination']) {

            const config: Config = {
                name, type: 'local', isTest: false,
                access: name === 'source' ? { user: 'admin', agent: 'admin' } : { user: 'writer', agent: 'writer' },
                connection: { dialect: 'sqlite', database: join(dir, `${name}.db`) },
            };
            await manager.setConfig(name, config);
            const conn = await createConnection(config.connection, name);
            const db = conn.db as Kysely<NoormDatabase>;
            await bootstrapSchema(db, 'sqlite');
            if (name === 'source' || initialized) {

                await db.insertInto(NOORM_TABLES.identities).values({
                    identity_hash: hash, email: 'copy@example.com', name: 'Copy User', machine: identity.publicKey,
                    os: 'env', public_key: identity.publicKey, encrypted_vault_key: null,
                } as never).execute();
                const [key, err] = await initializeVault(db, hash, identity.publicKey, 'sqlite');
                if (err || !key) throw err ?? new Error('Vault initialization failed');
                const [, setErr] = await setVaultSecret(db, key, 'API_KEY', name, 'test', 'sqlite');
                if (setErr) throw setErr;
                if (name === 'destination' && poisonKey) {

                    await db.updateTable(NOORM_TABLES.identities).set({ encrypted_vault_key: 'invalid' })
                        .where('identity_hash', '=', hash).execute();

                }

            }
            await conn.destroy();

        }
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {

            if (value !== undefined && !key.startsWith('NOORM_')) env[key] = value;

        }
        Object.assign(env, {
            NOORM_IDENTITY_PRIVATE_KEY: identity.privateKey, NOORM_IDENTITY_NAME: 'Copy User',
            NOORM_IDENTITY_EMAIL: 'copy@example.com', NOORM_CHANNEL: 'user',
        });
        const policy = async (read: 'deny' | 'confirm') => writeFile(join(dir, '.noorm', 'settings.yml'),
            `access:\n  roles:\n    writer:\n      extends: admin\n      permissions:\n        vault:read: ${read}\n        vault:write: allow\n`);
        const run = (args: string[], agent = false) => spawnSync('node', [CLI, 'vault', 'cp', 'API_KEY', 'source', 'destination', '--json', ...args], {
            cwd: dir, encoding: 'utf8', env: { ...env, NOORM_CHANNEL: agent ? 'agent' : 'user' },
        });

        return { policy, run, identity, hash };

    }

    it('denies initialized destination reads before unsealing or disclosing collisions', async () => {

        const { policy, run } = await fixture(true);
        await policy('deny');
        for (const args of [[], ['--dry-run']]) {

            const result = run(args);
            expect(result.status).not.toBe(0);
            expect(result.stdout + result.stderr).toContain('vault:read');
            expect(result.stdout + result.stderr).not.toContain('skipped');

        }
        await policy('confirm');
        for (const args of [[], ['--dry-run']]) {

            const unconfirmed = run(args);
            expect(unconfirmed.status).not.toBe(0);
            const agent = run([...args, '--yes'], true);
            expect(agent.status).not.toBe(0);

        }
        const preview = run(['--dry-run', '--yes']);
        expect(preview.status).toBe(0);
        expect(JSON.parse(preview.stdout).skipped).toEqual(['API_KEY']);

    });

    it('copies to an initialized destination after human confirmation', async () => {

        const { policy, run } = await fixture(true, false);
        await policy('confirm');
        const result = run(['--yes', '--force']);
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout).copied).toEqual(['API_KEY']);

    });

    it('allows a fresh destination to initialize with write but not read', async () => {

        const { policy, run, identity, hash } = await fixture(false);
        await policy('deny');
        const result = run([]);
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout).copied).toEqual(['API_KEY']);
        const conn = await createConnection({ dialect: 'sqlite', database: join(dir, 'destination.db') }, 'destination');
        const db = conn.db as Kysely<NoormDatabase>;
        const key = await getVaultKey(db, hash, identity.privateKey, 'sqlite');
        expect(key).not.toBeNull();
        expect(await getVaultSecret(db, key!, 'API_KEY', 'sqlite')).toBe('source');
        await conn.destroy();

    });

});
