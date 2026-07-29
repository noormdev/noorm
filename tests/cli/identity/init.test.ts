/**
 * cli: `noorm identity init --force` is an irreversible destroy-all-state
 * button (a08 F2, critical).
 *
 * The state encryption key is HKDF(privateKey, info='noorm-state-encryption'),
 * so regenerating the keypair renders every `state.enc` on the machine —
 * every project's configs, secrets and DB passwords — permanently
 * undecryptable. The only guard was `--force`, described as "Overwrite
 * existing identity", with no warning, no backup and no confirmation.
 *
 * `identity init` resolves ~/.noorm from `homedir()` at module import time, so
 * each case spawns the compiled CLI with HOME repointed at a throwaway dir —
 * same idiom as tests/core/identity/storage-key-permission-guard.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
    mkdtempSync,
    rmSync,
    mkdirSync,
    writeFileSync,
    readFileSync,
    readdirSync,
    chmodSync,
    statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');

describe('cli: identity init --force', () => {

    let fakeHome: string;
    let noormDir: string;
    let keyPath: string;
    let existingKey: string;

    beforeEach(() => {

        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-identity-init-home-'));
        noormDir = join(fakeHome, '.noorm');
        mkdirSync(noormDir, { recursive: true });

        const keypair = generateKeyPair();
        existingKey = keypair.privateKey;
        keyPath = join(noormDir, 'identity.key');

        writeFileSync(keyPath, keypair.privateKey, { mode: 0o600 });
        chmodSync(keyPath, 0o600);
        writeFileSync(join(noormDir, 'identity.pub'), keypair.publicKey, { mode: 0o644 });

    });

    afterEach(() => {

        rmSync(fakeHome, { recursive: true, force: true });

    });

    function runInit(args: string[]) {

        const result = spawnSync(
            'node',
            [CLI, 'identity', 'init', '--name', 'Rotator', '--email', 'rotate@example.com', ...args],
            { cwd: fakeHome, encoding: 'utf-8', env: { ...process.env, HOME: fakeHome } },
        );

        return {
            stdout: typeof result.stdout === 'string' ? result.stdout : '',
            stderr: typeof result.stderr === 'string' ? result.stderr : '',
            status: result.status,
        };

    }

    function backupFiles() {

        return readdirSync(noormDir).filter((f) => f.startsWith('identity.key.bak-'));

    }

    it('refuses --force without --yes', () => {

        const result = runInit(['--force']);

        expect(result.status).not.toBe(0);

    });

    it('leaves the existing key untouched when --yes is absent', () => {

        runInit(['--force']);

        expect(readFileSync(keyPath, 'utf8')).toBe(existingKey);

    });

    it('warns that state becomes unrecoverable rather than just "overwrite"', () => {

        const result = runInit(['--force']);

        expect(`${result.stdout}${result.stderr}`).toMatch(/state|unrecoverab|decrypt/i);

    });

    it('backs up the previous key before overwriting it', () => {

        const result = runInit(['--force', '--yes']);

        expect(result.status).toBe(0);

        const backups = backupFiles();

        expect(backups.length).toBe(1);
        expect(readFileSync(join(noormDir, backups[0]!), 'utf8')).toBe(existingKey);

    });

    it('writes the backup with owner-only permissions', () => {

        runInit(['--force', '--yes']);

        const backups = backupFiles();
        const mode = statSync(join(noormDir, backups[0]!)).mode & 0o777;

        expect(mode & 0o077).toBe(0);

    });

    it('actually rotates the key when --force --yes is given', () => {

        runInit(['--force', '--yes']);

        expect(readFileSync(keyPath, 'utf8')).not.toBe(existingKey);

    });

    it('still refuses a plain init when an identity already exists', () => {

        const result = runInit([]);

        expect(result.status).not.toBe(0);
        expect(readFileSync(keyPath, 'utf8')).toBe(existingKey);

    });

});

describe('cli: identity init (first run)', () => {

    let fakeHome: string;

    beforeEach(() => {

        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-identity-first-home-'));
        mkdirSync(join(fakeHome, '.noorm'), { recursive: true });

    });

    afterEach(() => {

        rmSync(fakeHome, { recursive: true, force: true });

    });

    it('creates an identity with no flags beyond name and email', () => {

        const result = spawnSync(
            'node',
            [CLI, 'identity', 'init', '--name', 'First Run', '--email', 'first@example.com', '--json'],
            { cwd: fakeHome, encoding: 'utf-8', env: { ...process.env, HOME: fakeHome } },
        );

        expect(result.status).toBe(0);
        expect(readFileSync(join(fakeHome, '.noorm', 'identity.key'), 'utf8')).toMatch(/^[0-9a-f]{96}$/);

    });

});
