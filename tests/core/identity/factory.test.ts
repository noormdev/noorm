/**
 * Identity factory tests.
 */
import { describe, it, expect } from 'vitest';
import {
    detectIdentityDefaults,
    createCryptoIdentity,
    regenerateKeyPair,
} from '../../../src/core/identity/factory.js';
import { isValidIdentityHash } from '../../../src/core/identity/hash.js';
import { isValidKeyHex } from '../../../src/core/identity/storage.js';

describe('identity: factory', () => {

    describe('detectIdentityDefaults', () => {

        it('should return defaults object', () => {

            const defaults = detectIdentityDefaults();

            expect(defaults).toHaveProperty('name');
            expect(defaults).toHaveProperty('email');
            expect(defaults).toHaveProperty('machine');
            expect(defaults).toHaveProperty('os');

        });

        it('should have non-empty name', () => {

            const defaults = detectIdentityDefaults();

            expect(defaults.name).toBeTruthy();
            expect(typeof defaults.name).toBe('string');

        });

        it('should have non-empty machine', () => {

            const defaults = detectIdentityDefaults();

            expect(defaults.machine).toBeTruthy();
            expect(typeof defaults.machine).toBe('string');

        });

        it('should have non-empty os', () => {

            const defaults = detectIdentityDefaults();

            expect(defaults.os).toBeTruthy();
            expect(typeof defaults.os).toBe('string');
            // OS should include platform and release
            expect(defaults.os).toMatch(/\s/);

        });

        it('email may be empty if git not configured', () => {

            const defaults = detectIdentityDefaults();

            // Email is string (may be empty)
            expect(typeof defaults.email).toBe('string');

        });

    });

    describe('createCryptoIdentity', () => {

        it('should create identity with all required fields', async () => {

            const { identity, keypair: _keypair } = await createCryptoIdentity(
                {
                    name: 'Test User',
                    email: 'test@example.com',
                },
                false,
            ); // Don't save keys to disk

            expect(identity.name).toBe('Test User');
            expect(identity.email).toBe('test@example.com');
            expect(identity.identityHash).toBeTruthy();
            expect(identity.publicKey).toBeTruthy();
            expect(identity.machine).toBeTruthy();
            expect(identity.os).toBeTruthy();
            expect(identity.createdAt).toBeTruthy();

        });

        it('should generate valid identity hash', async () => {

            const { identity } = await createCryptoIdentity(
                {
                    name: 'Test User',
                    email: 'test@example.com',
                },
                false,
            );

            expect(isValidIdentityHash(identity.identityHash)).toBe(true);

        });

        it('should generate valid keypair', async () => {

            const { keypair } = await createCryptoIdentity(
                {
                    name: 'Test User',
                    email: 'test@example.com',
                },
                false,
            );

            expect(isValidKeyHex(keypair.publicKey)).toBe(true);
            expect(isValidKeyHex(keypair.privateKey)).toBe(true);

        });

        it('should store public key in identity', async () => {

            const { identity, keypair } = await createCryptoIdentity(
                {
                    name: 'Test User',
                    email: 'test@example.com',
                },
                false,
            );

            expect(identity.publicKey).toBe(keypair.publicKey);

        });

        it('should use provided machine name', async () => {

            const { identity } = await createCryptoIdentity(
                {
                    name: 'Test User',
                    email: 'test@example.com',
                    machine: 'custom-machine',
                },
                false,
            );

            expect(identity.machine).toBe('custom-machine');

        });

        it('should trim whitespace from inputs', async () => {

            const { identity } = await createCryptoIdentity(
                {
                    name: '  Test User  ',
                    email: '  test@example.com  ',
                    machine: '  custom-machine  ',
                },
                false,
            );

            expect(identity.name).toBe('Test User');
            expect(identity.email).toBe('test@example.com');
            expect(identity.machine).toBe('custom-machine');

        });

        it('should set createdAt to current time', async () => {

            const before = new Date().toISOString();
            const { identity } = await createCryptoIdentity(
                {
                    name: 'Test User',
                    email: 'test@example.com',
                },
                false,
            );
            const after = new Date().toISOString();

            expect(identity.createdAt >= before).toBe(true);
            expect(identity.createdAt <= after).toBe(true);

        });

        it('should throw if name is empty', async () => {

            await expect(
                createCryptoIdentity(
                    {
                        name: '',
                        email: 'test@example.com',
                    },
                    false,
                ),
            ).rejects.toThrow(/name/i);

        });

        it('should throw if email is empty', async () => {

            await expect(
                createCryptoIdentity(
                    {
                        name: 'Test User',
                        email: '',
                    },
                    false,
                ),
            ).rejects.toThrow(/email/i);

        });

        it('should throw if name is whitespace only', async () => {

            await expect(
                createCryptoIdentity(
                    {
                        name: '   ',
                        email: 'test@example.com',
                    },
                    false,
                ),
            ).rejects.toThrow(/name/i);

        });

        it('should produce consistent hash for same inputs', async () => {

            const input = {
                name: 'Test User',
                email: 'test@example.com',
                machine: 'test-machine',
            };

            const { identity: id1 } = await createCryptoIdentity(input, false);
            const { identity: id2 } = await createCryptoIdentity(input, false);

            // Same inputs = same hash (ignoring OS version which is auto-detected)
            expect(id1.identityHash).toBe(id2.identityHash);

        });

        it('should produce different hash for different machines', async () => {

            const { identity: id1 } = await createCryptoIdentity(
                {
                    name: 'Test User',
                    email: 'test@example.com',
                    machine: 'machine-1',
                },
                false,
            );

            const { identity: id2 } = await createCryptoIdentity(
                {
                    name: 'Test User',
                    email: 'test@example.com',
                    machine: 'machine-2',
                },
                false,
            );

            expect(id1.identityHash).not.toBe(id2.identityHash);

        });

    });

    describe('regenerateKeyPair', () => {

        it('should generate new keypair', async () => {

            const { identity: original, keypair: originalKeypair } = await createCryptoIdentity(
                {
                    name: 'Test User',
                    email: 'test@example.com',
                },
                false,
            );

            const { identity: _updated, keypair: newKeypair } = await regenerateKeyPair(
                original,
                false,
            );

            expect(newKeypair.publicKey).not.toBe(originalKeypair.publicKey);
            expect(newKeypair.privateKey).not.toBe(originalKeypair.privateKey);

        });

        it('should update public key in identity', async () => {

            const { identity: original } = await createCryptoIdentity(
                {
                    name: 'Test User',
                    email: 'test@example.com',
                },
                false,
            );

            const { identity: updated, keypair: newKeypair } = await regenerateKeyPair(
                original,
                false,
            );

            expect(updated.publicKey).toBe(newKeypair.publicKey);
            expect(updated.publicKey).not.toBe(original.publicKey);

        });

        it('should preserve identity hash', async () => {

            const { identity: original } = await createCryptoIdentity(
                {
                    name: 'Test User',
                    email: 'test@example.com',
                },
                false,
            );

            const { identity: updated } = await regenerateKeyPair(original, false);

            // Hash is based on user details, not keys
            expect(updated.identityHash).toBe(original.identityHash);

        });

        it('should preserve all other fields', async () => {

            const { identity: original } = await createCryptoIdentity(
                {
                    name: 'Test User',
                    email: 'test@example.com',
                    machine: 'test-machine',
                },
                false,
            );

            const { identity: updated } = await regenerateKeyPair(original, false);

            expect(updated.name).toBe(original.name);
            expect(updated.email).toBe(original.email);
            expect(updated.machine).toBe(original.machine);
            expect(updated.os).toBe(original.os);
            expect(updated.createdAt).toBe(original.createdAt);

        });

    });

});
