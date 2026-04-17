import { describe, it, expect, afterEach } from 'bun:test';

import {
    setKeyOverride,
    clearKeyOverride,
    getKeyOverride,
    setIdentityOverride,
    clearIdentityOverride,
    getIdentityOverride,
    loadPrivateKey,
    loadIdentityMetadata,
} from '../../../src/core/identity/storage.js';
import type { CryptoIdentity } from '../../../src/core/identity/types.js';

describe('core: identity in-memory overrides', () => {

    afterEach(() => {

        clearKeyOverride();
        clearIdentityOverride();

    });

    it('getKeyOverride returns null when no override is set', () => {

        expect(getKeyOverride()).toBeNull();

    });

    it('setKeyOverride / clearKeyOverride round-trip', () => {

        setKeyOverride('a'.repeat(96));

        expect(getKeyOverride()).toBe('a'.repeat(96));

        clearKeyOverride();

        expect(getKeyOverride()).toBeNull();

    });

    it('loadPrivateKey returns the override when set, without touching disk', async () => {

        setKeyOverride('deadbeef'.repeat(12));

        const key = await loadPrivateKey();

        expect(key).toBe('deadbeef'.repeat(12));

    });

    it('getIdentityOverride returns null when no override is set', () => {

        expect(getIdentityOverride()).toBeNull();

    });

    it('setIdentityOverride / clearIdentityOverride round-trip', () => {

        const ident: CryptoIdentity = {
            identityHash: 'a'.repeat(64),
            name: 'CI Bot',
            email: 'ci@example.com',
            publicKey: 'b'.repeat(72),
            machine: 'ci',
            os: 'env',
            createdAt: new Date().toISOString(),
        };

        setIdentityOverride(ident);

        expect(getIdentityOverride()).toEqual(ident);

        clearIdentityOverride();

        expect(getIdentityOverride()).toBeNull();

    });

    it('loadIdentityMetadata returns the override when set, without touching disk', async () => {

        const ident: CryptoIdentity = {
            identityHash: 'c'.repeat(64),
            name: 'CI Bot',
            email: 'ci@example.com',
            publicKey: 'd'.repeat(72),
            machine: 'ci',
            os: 'env',
            createdAt: new Date().toISOString(),
        };

        setIdentityOverride(ident);

        const meta = await loadIdentityMetadata();

        expect(meta).toEqual(ident);

    });

});
