/**
 * cli: `noorm ci identity enroll` must not hand the vault key to a
 * pre-planted public key (a08 F1, critical).
 *
 * The documented air-gapped flow (docs/guide/automation/ci.md) circulates the
 * CI bot's PUBLIC key over email/Slack, and the enrollment identityHash is
 * `SHA256(email\0name\0publicKey\0'env')` — so its only secret input is a value
 * the flow instructs you to publish. Anyone who can INSERT into the identities
 * table (any holder of any config for that database; vault access NOT required)
 * can pre-register that hash carrying their OWN public key. `enroll` used to
 * look up the hash alone, set `alreadyEnrolled`, and propagate the vault key to
 * whatever key the row happened to hold — reporting `success: true` and echoing
 * the operator's correct key back at them.
 *
 * These tests drive the real compiled CLI against a SQLite project so no
 * container is needed. `--public-key` validation (F8) is covered here too: an
 * invalid key used to persist an unrepairable poisoned row, because the INSERT
 * ran before the propagation that then failed.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { sql, type Kysely } from 'kysely';

import { createConnection } from '../../../src/core/connection/factory.js';
import { bootstrapSchema } from '../../../src/core/version/index.js';
import { getNoormTables, noormDb } from '../../../src/core/shared/tables.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import { StateManager } from '../../../src/core/state/manager.js';
import {
    generateKeyPair,
    derivePublicKeyFromPrivate,
    computeIdentityHash,
} from '../../../src/core/identity/index.js';
import { generateVaultKey, encryptVaultKey, decryptVaultKey } from '../../../src/core/vault/key.js';
import type { EncryptedVaultKey } from '../../../src/core/vault/types.js';
import type { Config } from '../../../src/core/config/types.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const TMP_BASE = join(process.cwd(), 'tmp');

const CONFIG_NAME = 'enroll_target';

const BOT_NAME = 'CI Bot';
const BOT_EMAIL = 'ci-bot@example.com';

interface EnrollFixture {
    dir: string;
    dbPath: string;
    env: Record<string, string>;
    /** Key the attacker plants and hopes to receive the vault under */
    attackerPrivateKey: string;
    attackerPublicKey: string;
    /** The real bot key the operator is told to enroll */
    botPublicKey: string;
    botPrivateKey: string;
    /** Hash both parties compute — derived from the published bot public key */
    botIdentityHash: string;
}

/**
 * Build a project whose active config is a bootstrapped SQLite database, with
 * an operator identity that already holds vault access (the precondition
 * `enroll` enforces before it will propagate anything).
 */
async function setupEnrollFixture(
    access: ConfigAccess = { user: 'admin', agent: 'admin' },
): Promise<EnrollFixture> {

    const testId = randomUUID().slice(0, 8);
    const dir = join(TMP_BASE, `cli-ci-enroll-${testId}`);
    const dbPath = join(dir, '.noorm', 'test.db');

    await mkdir(join(dir, '.noorm'), { recursive: true });
    await mkdir(join(dir, 'sql'), { recursive: true });

    const conn = await createConnection({ dialect: 'sqlite', database: dbPath }, CONFIG_NAME);
    await bootstrapSchema(conn.db as Kysely<NoormDatabase>, 'sqlite');

    // The operator runs under the CI env identity, so their hash is the one
    // loadIdentityFromEnv() computes: machine = derived public key, os = 'env'.
    const operator = generateKeyPair();
    const operatorPublicKey = derivePublicKeyFromPrivate(operator.privateKey);
    const operatorHash = computeIdentityHash({
        email: 'operator@example.com',
        name: 'Vault Operator',
        machine: operatorPublicKey,
        os: 'env',
    });

    const vaultKey = generateVaultKey();

    const tables = getNoormTables('sqlite');
    const ndb = noormDb(conn.db as Kysely<NoormDatabase>, 'sqlite');

    await ndb
        .insertInto(tables.identities as keyof NoormDatabase)
        .values({
            identity_hash: operatorHash,
            email: 'operator@example.com',
            name: 'Vault Operator',
            machine: 'ci',
            os: 'env',
            public_key: operatorPublicKey,
            encrypted_vault_key: JSON.stringify(encryptVaultKey(vaultKey, operatorPublicKey)),
        } as never)
        .execute();

    // The bot mints its keypair; per the documented flow its PUBLIC key is
    // circulated in the clear, which is all the attacker needs to compute the
    // hash the operator will enroll under.
    const bot = generateKeyPair();
    const botPublicKey = bot.publicKey;
    const botIdentityHash = computeIdentityHash({
        email: BOT_EMAIL,
        name: BOT_NAME,
        machine: botPublicKey,
        os: 'env',
    });

    const attacker = generateKeyPair();

    await conn.destroy();

    const config: Config = {
        name: CONFIG_NAME,
        type: 'local',
        isTest: true,
        access,
        connection: { dialect: 'sqlite', database: dbPath },
    };

    const state = new StateManager(dir, { privateKey: operator.privateKey });
    await state.load();
    await state.setConfig(config.name, config);
    await state.setActiveConfig(config.name);

    return {
        dir,
        dbPath,
        attackerPrivateKey: attacker.privateKey,
        attackerPublicKey: attacker.publicKey,
        botPublicKey,
        botPrivateKey: bot.privateKey,
        botIdentityHash,
        env: {
            NOORM_IDENTITY_PRIVATE_KEY: operator.privateKey,
            NOORM_IDENTITY_NAME: 'Vault Operator',
            NOORM_IDENTITY_EMAIL: 'operator@example.com',
            NOORM_ISTEST: 'true',
        },
    };

}

/** Pre-register the bot's hash carrying someone else's public key. */
async function plantRow(fx: EnrollFixture, publicKey: string): Promise<void> {

    const conn = await createConnection({ dialect: 'sqlite', database: fx.dbPath }, CONFIG_NAME);
    const tables = getNoormTables('sqlite');
    const ndb = noormDb(conn.db as Kysely<NoormDatabase>, 'sqlite');

    await ndb
        .insertInto(tables.identities as keyof NoormDatabase)
        .values({
            identity_hash: fx.botIdentityHash,
            email: BOT_EMAIL,
            name: BOT_NAME,
            machine: 'ci',
            os: 'env',
            public_key: publicKey,
            encrypted_vault_key: null,
        } as never)
        .execute();

    await conn.destroy();

}

async function readRow(fx: EnrollFixture, identityHash: string) {

    const conn = await createConnection({ dialect: 'sqlite', database: fx.dbPath }, CONFIG_NAME);
    const tables = getNoormTables('sqlite');
    const ndb = noormDb(conn.db as Kysely<NoormDatabase>, 'sqlite');

    const row = await ndb
        .selectFrom(tables.identities as keyof NoormDatabase)
        .select(['identity_hash', 'public_key', 'encrypted_vault_key'])
        .where('identity_hash', '=', identityHash)
        .executeTakeFirst();

    await conn.destroy();

    return row ?? null;

}

function runEnroll(fx: EnrollFixture, extra: string[]) {

    const result = spawnSync(
        'node',
        [
            CLI, 'ci', 'identity', 'enroll',
            '--config', CONFIG_NAME,
            '--name', BOT_NAME,
            '--email', BOT_EMAIL,
            ...extra,
            '--json',
        ],
        { cwd: fx.dir, encoding: 'utf-8', env: { ...process.env, ...fx.env } },
    );

    return {
        stdout: typeof result.stdout === 'string' ? result.stdout : '',
        stderr: typeof result.stderr === 'string' ? result.stderr : '',
        status: result.status,
    };

}

describe('cli: vault propagation recipient review', () => {

    let fx: EnrollFixture | undefined;

    afterEach(async () => {

        if (fx) await rm(fx.dir, { recursive: true, force: true });
        fx = undefined;

    });

    it('requires human recipient review even when the role allows propagation', async () => {

        fx = await setupEnrollFixture();
        await writeFile(join(fx.dir, '.noorm', 'settings.yml'),
            'access:\n  roles:\n    admin:\n      permissions:\n        vault:propagate: allow\n');
        await plantRow(fx, fx.botPublicKey);
        const invoke = (channel: string, yes: boolean) => spawnSync(
            'node',
            [CLI, 'vault', 'propagate', '--config', CONFIG_NAME, '--json', ...(yes ? ['--yes'] : [])],
            { cwd: fx!.dir, encoding: 'utf-8', env: { ...process.env, ...fx!.env, NOORM_CHANNEL: channel, NOORM_YES: '' } },
        );

        const preview = invoke('user', false);
        expect(preview.status).not.toBe(0);
        expect(preview.stdout + preview.stderr).toContain('Recipient review is required even when policy allows propagation');
        expect((await readRow(fx, fx.botIdentityHash))?.encrypted_vault_key).toBeNull();

        const agent = invoke('agent', true);
        expect(agent.status).not.toBe(0);
        expect(agent.stdout + agent.stderr).toContain('Recipient review requires a human');
        expect((await readRow(fx, fx.botIdentityHash))?.encrypted_vault_key).toBeNull();

        const grant = invoke('user', true);
        expect(grant.status).toBe(0);
        expect((await readRow(fx, fx.botIdentityHash))?.encrypted_vault_key).not.toBeNull();

    });

});

describe('cli: ci identity enroll — pre-planted key hijack (a08 F1)', () => {

    let fx: EnrollFixture | undefined;

    afterEach(async () => {

        if (fx) await rm(fx.dir, { recursive: true, force: true });
        fx = undefined;

    });

    it('refuses to enroll when the stored public key differs from --public-key', async () => {

        fx = await setupEnrollFixture();
        await plantRow(fx, fx.attackerPublicKey);

        // The operator does everything right: they pass the REAL bot key.
        const result = runEnroll(fx, ['--public-key', fx.botPublicKey]);

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toMatch(/public key/i);

    });

    it('does not propagate the vault key to the planted key', async () => {

        fx = await setupEnrollFixture();
        await plantRow(fx, fx.attackerPublicKey);

        runEnroll(fx, ['--public-key', fx.botPublicKey]);

        const row = await readRow(fx, fx.botIdentityHash);

        // The planted row must be left without vault access. Asserting the
        // column is null is not enough on its own — assert the attacker's key
        // cannot open whatever is there.
        expect(row).not.toBeNull();
        expect(row!.encrypted_vault_key).toBeFalsy();

        if (row!.encrypted_vault_key) {

            const parsed = JSON.parse(row!.encrypted_vault_key as string) as EncryptedVaultKey;

            expect(decryptVaultKey(parsed, fx.attackerPrivateKey)).toBeNull();

        }

    });

    it('reports success when the stored public key matches the presented one', async () => {

        fx = await setupEnrollFixture();
        await plantRow(fx, fx.botPublicKey);

        // --yes because granting vault access is a `confirm` cell for every
        // role that holds `vault:propagate`.
        const result = runEnroll(fx, ['--public-key', fx.botPublicKey, '--yes']);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('"alreadyEnrolled":true');

        const row = await readRow(fx, fx.botIdentityHash);

        expect(row!.encrypted_vault_key).toBeTruthy();

        const encrypted = JSON.parse(row!.encrypted_vault_key as string) as EncryptedVaultKey;
        expect(decryptVaultKey(encrypted, fx.botPrivateKey)).not.toBeNull();
        expect(decryptVaultKey(encrypted, fx.attackerPrivateKey)).toBeNull();

    });

    it('rejects a replacement key introduced after the supplied key was validated', async () => {

        fx = await setupEnrollFixture();
        const conn = await createConnection({ dialect: 'sqlite', database: fx.dbPath }, CONFIG_NAME);
        const db = conn.db as Kysely<NoormDatabase>;
        const table = getNoormTables('sqlite').identities;
        // This runs after enrollment inserts the validated recipient but before
        // it executes the grant, deterministically modeling the key race.
        await sql`
            CREATE TRIGGER replace_enrollment_key AFTER INSERT ON ${sql.raw(table)}
            FOR EACH ROW WHEN NEW.identity_hash = ${sql.lit(fx.botIdentityHash)}
            BEGIN
                UPDATE ${sql.raw(table)} SET public_key = ${sql.lit(fx.attackerPublicKey)}
                WHERE identity_hash = NEW.identity_hash;
            END;
        `.execute(db);
        await conn.destroy();

        const result = runEnroll(fx, ['--public-key', fx.botPublicKey, '--yes']);
        expect(result.status).not.toBe(0);
        const row = await readRow(fx, fx.botIdentityHash);
        expect(row?.public_key).toBe(fx.attackerPublicKey);
        expect(row?.encrypted_vault_key).toBeNull();
        if (row?.encrypted_vault_key) {

            expect(decryptVaultKey(JSON.parse(row.encrypted_vault_key as string), fx.attackerPrivateKey)).toBeNull();

        }

    });

    it('concurrent retries grant only the exact reviewed key', async () => {

        fx = await setupEnrollFixture();
        await plantRow(fx, fx.botPublicKey);
        const fixture = fx;
        const children = [0, 1].map(() => spawn('node', [
            CLI, 'ci', 'identity', 'enroll', '--config', CONFIG_NAME,
            '--name', BOT_NAME, '--email', BOT_EMAIL,
            '--public-key', fixture.botPublicKey, '--yes', '--json',
        ], { cwd: fixture.dir, env: { ...process.env, ...fixture.env }, stdio: 'ignore' }));
        const results = await Promise.all(children.map(async (child) => (await once(child, 'close'))[0]));
        expect(results).toEqual([0, 0]);
        const row = await readRow(fixture, fixture.botIdentityHash);
        expect(row?.public_key).toBe(fixture.botPublicKey);
        const encrypted = JSON.parse(row!.encrypted_vault_key as string) as EncryptedVaultKey;
        expect(decryptVaultKey(encrypted, fixture.botPrivateKey)).not.toBeNull();
        expect(decryptVaultKey(encrypted, fixture.attackerPrivateKey)).toBeNull();

    });

});

/**
 * `ci identity enroll` grants irrevocable vault access, so it is a
 * config-scoped action and belongs behind the same `access` matrix as every
 * other vault operation. It called the ungated `propagateVaultKeyTo`, so the
 * config's role was never consulted: a `viewer` config — denied `vault:read`
 * outright — could still hand the vault to a new identity, and no role was
 * ever asked to confirm the grant.
 */
describe('cli: ci identity enroll — vault:propagate authorization', () => {

    let fx: EnrollFixture | undefined;

    afterEach(async () => {

        if (fx) await rm(fx.dir, { recursive: true, force: true });
        fx = undefined;

    });

    it('denies a viewer config outright', async () => {

        fx = await setupEnrollFixture({ user: 'viewer', agent: 'viewer' });

        const result = runEnroll(fx, ['--public-key', fx.botPublicKey, '--yes']);

        expect(result.status).not.toBe(0);

    });

    it('grants no vault access from a viewer config', async () => {

        fx = await setupEnrollFixture({ user: 'viewer', agent: 'viewer' });

        runEnroll(fx, ['--public-key', fx.botPublicKey, '--yes']);

        expect(await readRow(fx, fx.botIdentityHash)).toBeNull();

    });
    it('denies enrollment before reading the vault when vault:read is denied', async () => {

        fx = await setupEnrollFixture({ user: 'enroller', agent: 'viewer' });
        await writeFile(join(fx.dir, '.noorm', 'settings.yml'),
            'access:\n  roles:\n    enroller:\n      extends: admin\n      permissions:\n        vault:read: deny\n');
        const result = runEnroll(fx, ['--public-key', fx.botPublicKey, '--yes']);
        expect(result.status).not.toBe(0);
        expect(result.stdout + result.stderr).toContain('vault:read');
        expect(await readRow(fx, fx.botIdentityHash)).toBeNull();

    });

    it('requires human confirmation before reading the vault', async () => {

        fx = await setupEnrollFixture({ user: 'enroller', agent: 'enroller' });
        await writeFile(join(fx.dir, '.noorm', 'settings.yml'),
            'access:\n  roles:\n    enroller:\n      extends: admin\n      permissions:\n        vault:read: confirm\n        vault:propagate: allow\n');
        const unconfirmed = runEnroll(fx, ['--public-key', fx.botPublicKey]);
        expect(unconfirmed.status).not.toBe(0);
        expect(unconfirmed.stdout + unconfirmed.stderr).toContain('Reading the vault requires confirmation');
        expect(await readRow(fx, fx.botIdentityHash)).toBeNull();
        fx.env['NOORM_CHANNEL'] = 'agent';
        expect(runEnroll(fx, ['--public-key', fx.botPublicKey, '--yes']).status).not.toBe(0);
        expect(await readRow(fx, fx.botIdentityHash)).toBeNull();
        delete fx.env['NOORM_CHANNEL'];
        expect(runEnroll(fx, ['--public-key', fx.botPublicKey, '--yes']).status).toBe(0);

    });


    it('requires confirmation before granting, even as admin', async () => {

        fx = await setupEnrollFixture();

        const result = runEnroll(fx, ['--public-key', fx.botPublicKey]);

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toMatch(/--yes/);

    });

    it('does not let an agent use --yes to approve a grant', async () => {

        fx = await setupEnrollFixture({ user: 'admin', agent: 'admin' });
        fx.env['NOORM_CHANNEL'] = 'agent';
        const result = runEnroll(fx, ['--public-key', fx.botPublicKey, '--yes']);
        expect(result.status).not.toBe(0);
        expect(await readRow(fx, fx.botIdentityHash)).toBeNull();

    });

    it('propagates nothing when confirmation is withheld', async () => {

        fx = await setupEnrollFixture();

        runEnroll(fx, ['--public-key', fx.botPublicKey]);

        const row = await readRow(fx, fx.botIdentityHash);

        // The row may be registered, but the vault key must not be sealed to
        // it until the operator confirms.
        expect(row?.encrypted_vault_key ?? null).toBeNull();

    });

    it('names the identity it is about to grant to, so the operator can check it', async () => {

        fx = await setupEnrollFixture();

        const result = runEnroll(fx, ['--public-key', fx.botPublicKey]);

        // Must be the REFUSAL that names it — a success message mentioning the
        // email would satisfy a bare `toContain` without any gate existing.
        expect(result.status).not.toBe(0);

        const output = `${result.stdout}${result.stderr}`;

        expect(output).toContain(BOT_EMAIL);
        expect(output).toContain(fx.botIdentityHash);

    });

    it('grants once confirmed', async () => {

        fx = await setupEnrollFixture();

        const result = runEnroll(fx, ['--public-key', fx.botPublicKey, '--yes']);

        expect(result.status).toBe(0);

        const row = await readRow(fx, fx.botIdentityHash);

        expect(row!.encrypted_vault_key).toBeTruthy();

    });

});

describe('cli: ci identity enroll — --public-key validation (a08 F8)', () => {

    let fx: EnrollFixture | undefined;

    afterEach(async () => {

        if (fx) await rm(fx.dir, { recursive: true, force: true });
        fx = undefined;

    });

    it('rejects a non-hex --public-key', async () => {

        fx = await setupEnrollFixture();

        const result = runEnroll(fx, ['--public-key', 'zzzz-not-hex']);

        expect(result.status).not.toBe(0);

    });

    it('writes no identity row when --public-key is invalid', async () => {

        fx = await setupEnrollFixture();

        // The poisoned row was unrepairable: a retry short-circuited on
        // alreadyEnrolled and registerIdentity never updates public_key.
        const badKey = 'zzzz-not-hex';
        runEnroll(fx, ['--public-key', badKey]);

        const hash = computeIdentityHash({
            email: BOT_EMAIL,
            name: BOT_NAME,
            machine: badKey,
            os: 'env',
        });

        expect(await readRow(fx, hash)).toBeNull();

    });

    it('rejects a truncated --public-key', async () => {

        fx = await setupEnrollFixture();

        const result = runEnroll(fx, ['--public-key', fx.botPublicKey.slice(0, 40)]);

        expect(result.status).not.toBe(0);

    });

});
