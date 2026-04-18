import { describe, it, expect, afterEach } from 'bun:test';

import { loadIdentityFromEnv, CI_ENV_VARS } from '../../../src/core/identity/env.js';
import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { computeIdentityHash } from '../../../src/core/identity/hash.js';

describe('core: identity env loader', () => {

    const originalEnv = { ...process.env };

    afterEach(() => {

        process.env = { ...originalEnv };

    });

    it('returns null when no env vars are set', () => {

        delete process.env[CI_ENV_VARS.privateKey];
        delete process.env[CI_ENV_VARS.name];
        delete process.env[CI_ENV_VARS.email];

        expect(loadIdentityFromEnv()).toBeNull();

    });

    it('returns null when only some env vars are set', () => {

        process.env[CI_ENV_VARS.name] = 'CI Bot';
        delete process.env[CI_ENV_VARS.privateKey];
        delete process.env[CI_ENV_VARS.email];

        expect(loadIdentityFromEnv()).toBeNull();

    });

    it('returns identity + private key + derived public key when all env vars are set', () => {

        const { privateKey, publicKey } = generateKeyPair();

        process.env[CI_ENV_VARS.privateKey] = privateKey;
        process.env[CI_ENV_VARS.name] = 'CI Bot';
        process.env[CI_ENV_VARS.email] = 'ci@example.com';

        const result = loadIdentityFromEnv();

        expect(result).not.toBeNull();
        expect(result!.privateKey).toBe(privateKey);
        expect(result!.identity.publicKey).toBe(publicKey);
        expect(result!.identity.name).toBe('CI Bot');
        expect(result!.identity.email).toBe('ci@example.com');

    });

    it('produces the same identityHash for the same private key on different machines', () => {

        const { privateKey, publicKey } = generateKeyPair();

        process.env[CI_ENV_VARS.privateKey] = privateKey;
        process.env[CI_ENV_VARS.name] = 'CI Bot';
        process.env[CI_ENV_VARS.email] = 'ci@example.com';

        const a = loadIdentityFromEnv()!;
        const b = loadIdentityFromEnv()!;

        expect(a.identity.identityHash).toBe(b.identity.identityHash);

        const expected = computeIdentityHash({
            email: 'ci@example.com',
            name: 'CI Bot',
            machine: publicKey,
            os: 'env',
        });

        expect(a.identity.identityHash).toBe(expected);

    });

    it('rejects invalid hex in private key', () => {

        process.env[CI_ENV_VARS.privateKey] = 'not-valid-hex!!';
        process.env[CI_ENV_VARS.name] = 'CI Bot';
        process.env[CI_ENV_VARS.email] = 'ci@example.com';

        expect(loadIdentityFromEnv()).toBeNull();

    });

    it('rejects private key with wrong length', () => {

        process.env[CI_ENV_VARS.privateKey] = 'aabbccdd';
        process.env[CI_ENV_VARS.name] = 'CI Bot';
        process.env[CI_ENV_VARS.email] = 'ci@example.com';

        expect(loadIdentityFromEnv()).toBeNull();

    });

    it('returns null when private key is structurally valid hex but not a real X25519 key', () => {

        process.env[CI_ENV_VARS.privateKey] = '0'.repeat(96);
        process.env[CI_ENV_VARS.name] = 'CI Bot';
        process.env[CI_ENV_VARS.email] = 'ci@example.com';

        expect(loadIdentityFromEnv()).toBeNull();

    });

    it('trims whitespace from env vars', () => {

        const { privateKey } = generateKeyPair();

        process.env[CI_ENV_VARS.privateKey] = `  ${privateKey}  `;
        process.env[CI_ENV_VARS.name] = '  CI Bot  ';
        process.env[CI_ENV_VARS.email] = '  ci@example.com  ';

        const result = loadIdentityFromEnv();

        expect(result).not.toBeNull();
        expect(result!.identity.name).toBe('CI Bot');
        expect(result!.identity.email).toBe('ci@example.com');
        expect(result!.privateKey).toBe(privateKey);

    });

    it('exports CI_ENV_VARS constant with all env var names', () => {

        expect(CI_ENV_VARS).toEqual({
            privateKey: 'NOORM_IDENTITY_PRIVATE_KEY',
            name: 'NOORM_IDENTITY_NAME',
            email: 'NOORM_IDENTITY_EMAIL',
        });

    });

});
