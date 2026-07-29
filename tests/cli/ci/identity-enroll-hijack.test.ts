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
import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Kysely } from 'kysely';

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
    /** Hash both parties compute — derived from the published bot public key */
    botIdentityHash: string;
}

/**
 * Build a project whose active config is a bootstrapped SQLite database, with
 * an operator identity that already holds vault access (the precondition
 * `enroll` enforces before it will propagate anything).
 */
async function setupEnrollFixture(): Promise<EnrollFixture> {

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
        access: { user: 'admin', mcp: 'admin' },
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

        const result = runEnroll(fx, ['--public-key', fx.botPublicKey]);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('"alreadyEnrolled":true');

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
