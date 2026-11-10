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
    existsSync,
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

        writeFileSync(join(noormDir, 'identity.json'), JSON.stringify({ name: 'Rotator', email: 'rotate@example.com' }));

        const result = runInit([]);

        expect(result.status).not.toBe(0);
        expect(readFileSync(keyPath, 'utf8')).toBe(existingKey);

    });

    it('should back up a lone private key before --force --yes replaces it', () => {

        rmSync(join(noormDir, 'identity.pub'));

        const result = runInit(['--force', '--yes']);
        const backups = backupFiles();

        expect(result.status).toBe(0);
        expect(backups.length).toBe(1);
        expect(readFileSync(join(noormDir, backups[0]!), 'utf8')).toBe(existingKey);

    });

});

/**
 * `--name` and `--email` used to be required even though the TUI prefilled
 * both from git. The headless command now reads the same defaults, and refuses
 * to invent an email: an identity with an empty one is written into every
 * audit row and shared-config envelope it touches.
 */
describe('cli: identity init defaults', () => {

    let fakeHome: string;
    let keyPath: string;

    beforeEach(() => {

        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-identity-defaults-home-'));
        keyPath = join(fakeHome, '.noorm', 'identity.key');

    });

    afterEach(() => {

        rmSync(fakeHome, { recursive: true, force: true });

    });

    /** Run with git reading nothing but the fake home's `.gitconfig`. */
    function runInit(args: string[], { json = true } = {}) {

        const { GIT_CONFIG_GLOBAL: _global, GIT_DIR: _dir, ...env } = process.env;

        return spawnSync('node', [CLI, 'identity', 'init', ...(json ? ['--json'] : []), ...args], {
            cwd: fakeHome,
            encoding: 'utf-8',
            env: {
                ...env,
                HOME: fakeHome,
                XDG_CONFIG_HOME: join(fakeHome, '.config'),
                GIT_CONFIG_NOSYSTEM: '1',
            },
        });

    }

    function configureGit() {

        writeFileSync(join(fakeHome, '.gitconfig'), '[user]\n\tname = Git Person\n\temail = git@example.com\n');

    }

    it('should take name and email from git when no flags are given', () => {

        configureGit();

        const result = runInit([]);

        expect(result.status).toBe(0);

        const identity = JSON.parse(readFileSync(join(fakeHome, '.noorm', 'identity.json'), 'utf8'));

        expect(identity.name).toBe('Git Person');
        expect(identity.email).toBe('git@example.com');

    });

    it('should let a flag override the git value', () => {

        configureGit();

        const result = runInit(['--email', 'flag@example.com']);

        expect(result.status).toBe(0);

        const identity = JSON.parse(readFileSync(join(fakeHome, '.noorm', 'identity.json'), 'utf8'));

        expect(identity.name).toBe('Git Person');
        expect(identity.email).toBe('flag@example.com');

    });

    it('should fail and point at --email when no email can be determined', () => {

        const result = runInit([]);

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('git config user.email is not set. Pass --email');

    });

    it('should create nothing when no email can be determined', () => {

        runInit([]);

        expect(existsSync(keyPath)).toBe(false);
        expect(existsSync(join(fakeHome, '.noorm', 'identity.json'))).toBe(false);

    });

    it('should treat a whitespace-only flag as absent and use the git value', () => {

        configureGit();

        const result = runInit(['--email', '   ', '--name', ' ']);

        expect(result.status).toBe(0);

        const identity = JSON.parse(readFileSync(join(fakeHome, '.noorm', 'identity.json'), 'utf8'));

        expect(identity.name).toBe('Git Person');
        expect(identity.email).toBe('git@example.com');

    });

    it('should reject a whitespace-only email before backing anything up', () => {

        // A failed replacement that still leaves .bak files behind reads as
        // if the identity had been replaced.
        const existingKey = generateKeyPair().privateKey;

        mkdirSync(join(fakeHome, '.noorm'), { recursive: true });
        writeFileSync(keyPath, existingKey, { mode: 0o600 });

        const result = runInit(['--email', '   ', '--force', '--yes']);

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('Pass --email');
        expect(readdirSync(join(fakeHome, '.noorm'))).toEqual(['identity.key']);
        expect(readFileSync(keyPath, 'utf8')).toBe(existingKey);

    });

    // A private key restored from backup is what every state.enc is encrypted with, so init builds around it.
    describe('with a private key and no other identity file', () => {

        let keypair: ReturnType<typeof generateKeyPair>;

        beforeEach(() => {

            keypair = generateKeyPair();
            mkdirSync(join(fakeHome, '.noorm'), { recursive: true });
            writeFileSync(keyPath, keypair.privateKey, { mode: 0o600 });
            chmodSync(keyPath, 0o600);

        });

        it('should complete the identity and leave the key bytes unchanged', () => {

            configureGit();

            const result = runInit([]);
            const identity = JSON.parse(readFileSync(join(fakeHome, '.noorm', 'identity.json'), 'utf8'));

            expect(result.status).toBe(0);
            expect(readFileSync(keyPath, 'utf8')).toBe(keypair.privateKey);
            expect(readFileSync(join(fakeHome, '.noorm', 'identity.pub'), 'utf8').trim()).toBe(keypair.publicKey);
            expect(identity).toMatchObject({ name: 'Git Person', email: 'git@example.com', publicKey: keypair.publicKey });
            expect(readdirSync(join(fakeHome, '.noorm')).sort()).toEqual(['identity.json', 'identity.key', 'identity.pub']);

        });

        it('should flag the completion in the JSON result', () => {

            configureGit();

            const result = runInit([]);

            expect(JSON.parse(result.stdout)).toMatchObject({
                success: true, completedExistingKey: true, email: 'git@example.com', publicKey: keypair.publicKey,
            });

        });

        it('should say in text that it completed the identity from the existing key', () => {

            configureGit();

            const result = runInit([], { json: false });

            expect(result.status).toBe(0);
            expect(result.stdout).toContain('Identity completed from the existing private key.');
            expect(result.stdout).not.toContain('Identity created.');

        });

        it('should refuse a second init once the identity is complete', () => {

            configureGit();
            runInit([]);

            const result = runInit([]);

            expect(result.status).not.toBe(0);
            expect(`${result.stdout}${result.stderr}`).toContain('Identity already exists. Use --force to overwrite.');
            expect(readFileSync(keyPath, 'utf8')).toBe(keypair.privateKey);

        });

        it('should write nothing when no email can be determined', () => {

            const result = runInit([]);

            expect(result.status).not.toBe(0);
            expect(`${result.stdout}${result.stderr}`).toContain('git config user.email is not set. Pass --email');
            expect(readdirSync(join(fakeHome, '.noorm'))).toEqual(['identity.key']);

        });

        it('should derive a missing public key without asking for a name or email the stored metadata already has', () => {

            const metadata = JSON.stringify({ name: 'Stored Person', email: 'stored@example.com', publicKey: keypair.publicKey });
            writeFileSync(join(fakeHome, '.noorm', 'identity.json'), metadata);

            const result = runInit([]);

            expect(result.status).toBe(0);
            expect(JSON.parse(result.stdout)).toMatchObject({ completedExistingKey: true, name: 'Stored Person', email: 'stored@example.com' });
            expect(readFileSync(join(fakeHome, '.noorm', 'identity.pub'), 'utf8').trim()).toBe(keypair.publicKey);
            expect(readFileSync(join(fakeHome, '.noorm', 'identity.json'), 'utf8')).toBe(metadata);
            expect(readFileSync(keyPath, 'utf8')).toBe(keypair.privateKey);

        });

        it('should surface the permission error and never offer to replace the key', () => {

            configureGit();
            chmodSync(keyPath, 0o644);

            const result = runInit([]);
            const output = `${result.stdout}${result.stderr}`;

            expect(result.status).not.toBe(0);
            expect(output).toContain('Insecure permissions on private key file');
            expect(output).not.toContain('--force');
            expect(readdirSync(join(fakeHome, '.noorm'))).toEqual(['identity.key']);
            expect(readFileSync(keyPath, 'utf8')).toBe(keypair.privateKey);

        });

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

    // The override is this process's identity only: no key file would be written, so there is nothing to report as created.
    it('should refuse when NOORM_IDENTITY_PRIVATE_KEY supplies the key and no key file exists', () => {

        const result = spawnSync(
            'node',
            [CLI, 'identity', 'init', '--name', 'Env', '--email', 'env@example.com'],
            {
                cwd: fakeHome, encoding: 'utf-8',
                env: {
                    ...process.env, HOME: fakeHome,
                    NOORM_IDENTITY_PRIVATE_KEY: generateKeyPair().privateKey,
                    NOORM_IDENTITY_NAME: 'Env',
                    NOORM_IDENTITY_EMAIL: 'env@example.com',
                },
            },
        );

        expect(result.status).toBe(1);
        expect(result.stdout + result.stderr).toContain('NOORM_IDENTITY_PRIVATE_KEY is set');
        expect(result.stdout + result.stderr).not.toContain('Identity created');
        expect(readdirSync(join(fakeHome, '.noorm'))).toEqual([]);

    });

});
