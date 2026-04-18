import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateKeyPair } from '../../src/core/identity/crypto.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');

describe('cli: noorm identity ci', () => {

    let tmpDir: string;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-identity-ci-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n');

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });

    });

    it('exits 1 when env vars are missing', () => {

        const result = spawnSync('node', [CLI, 'identity', 'ci'], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: {
                ...process.env,
                NOORM_IDENTITY_PRIVATE_KEY: '',
                NOORM_IDENTITY_NAME: '',
                NOORM_IDENTITY_EMAIL: '',
            },
        });

        expect(result.status).toBe(1);
        expect(result.stderr + result.stdout).toContain('NOORM_IDENTITY_PRIVATE_KEY');

    });

    it('exits 1 when private key is invalid hex', () => {

        const result = spawnSync('node', [CLI, 'identity', 'ci'], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: {
                ...process.env,
                NOORM_IDENTITY_PRIVATE_KEY: 'not-hex',
                NOORM_IDENTITY_NAME: 'CI Bot',
                NOORM_IDENTITY_EMAIL: 'ci@test.com',
            },
        });

        expect(result.status).toBe(1);

    });

    it('succeeds with valid env vars and prints fingerprint', () => {

        const { privateKey, publicKey } = generateKeyPair();

        const result = spawnSync('node', [CLI, 'identity', 'ci'], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: {
                ...process.env,
                NOORM_IDENTITY_PRIVATE_KEY: privateKey,
                NOORM_IDENTITY_NAME: 'CI Bot',
                NOORM_IDENTITY_EMAIL: 'ci@test.com',
            },
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('CI Bot');
        expect(result.stdout).toContain(publicKey);

    });

    it('outputs JSON with --json flag', () => {

        const { privateKey, publicKey } = generateKeyPair();

        const result = spawnSync('node', [CLI, 'identity', 'ci', '--json'], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: {
                ...process.env,
                NOORM_IDENTITY_PRIVATE_KEY: privateKey,
                NOORM_IDENTITY_NAME: 'CI Bot',
                NOORM_IDENTITY_EMAIL: 'ci@test.com',
            },
        });

        expect(result.status).toBe(0);
        const json = JSON.parse(result.stdout.trim());
        expect(json.name).toBe('CI Bot');
        expect(json.email).toBe('ci@test.com');
        expect(json.publicKey).toBe(publicKey);
        expect(json.source).toBe('env');

    });

});
