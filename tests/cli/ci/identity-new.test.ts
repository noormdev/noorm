import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { derivePublicKeyFromPrivate } from '../../../src/core/identity/crypto.js';
import { computeIdentityHash } from '../../../src/core/identity/hash.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');

describe('cli: noorm ci identity new', () => {

    it('prints env block with a valid derived keypair', () => {

        const result = spawnSync(
            'node',
            [CLI, 'ci', 'identity', 'new', '--name', 'CI Bot', '--email', 'ci@test.com'],
            { encoding: 'utf-8' },
        );

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('CI Bot');
        expect(result.stdout).toContain('ci@test.com');
        expect(result.stdout).toContain('NOORM_IDENTITY_PRIVATE_KEY=');

    });

    it('emits JSON with publicKey derived from privateKey and a matching identityHash', () => {

        const result = spawnSync(
            'node',
            [CLI, 'ci', 'identity', 'new', '--name', 'CI Bot', '--email', 'ci@test.com', '--json'],
            { encoding: 'utf-8' },
        );

        expect(result.status).toBe(0);

        const json = JSON.parse(result.stdout.trim());

        expect(json.name).toBe('CI Bot');
        expect(json.email).toBe('ci@test.com');
        expect(typeof json.privateKey).toBe('string');
        expect(json.privateKey.length).toBe(96);

        const derivedPub = derivePublicKeyFromPrivate(json.privateKey);
        expect(derivedPub).toBe(json.publicKey);

        const expectedHash = computeIdentityHash({
            email: 'ci@test.com',
            name: 'CI Bot',
            machine: json.publicKey,
            os: 'env',
        });

        expect(json.identityHash).toBe(expectedHash);

        expect(json.envBlock).toEqual({
            NOORM_IDENTITY_PRIVATE_KEY: json.privateKey,
            NOORM_IDENTITY_NAME: 'CI Bot',
            NOORM_IDENTITY_EMAIL: 'ci@test.com',
        });

    });

    it('exits 1 when --name is missing', () => {

        const result = spawnSync(
            'node',
            [CLI, 'ci', 'identity', 'new', '--email', 'ci@test.com'],
            { encoding: 'utf-8' },
        );

        expect(result.status).not.toBe(0);

    });

    it('exits 1 when --email is missing', () => {

        const result = spawnSync(
            'node',
            [CLI, 'ci', 'identity', 'new', '--name', 'CI Bot'],
            { encoding: 'utf-8' },
        );

        expect(result.status).not.toBe(0);

    });

});
