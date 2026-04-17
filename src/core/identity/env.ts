/**
 * CI identity loader.
 *
 * Bootstraps a CryptoIdentity from environment variables so CI runners
 * can decrypt vault/state without writing key files to disk. The public
 * key is derived from the private key, and the identityHash is computed
 * from `email + name + publicKey` so that the same private key produces
 * the same identity on any CI runner — `os.hostname()` is intentionally
 * NOT part of the hash, otherwise every runner would appear as a new
 * user in the audit trail.
 *
 * Required env vars:
 * - NOORM_IDENTITY_PRIVATE_KEY — X25519 private key (hex-encoded PKCS8 DER, 96 hex chars)
 * - NOORM_IDENTITY_NAME — Display name
 * - NOORM_IDENTITY_EMAIL — Email address
 *
 * @example
 * ```typescript
 * const ci = loadIdentityFromEnv();
 * if (ci) {
 *     setKeyOverride(ci.privateKey);
 *     setIdentityOverride(ci.identity);
 * }
 * ```
 */
import { attemptSync } from '@logosdx/utils';

import { derivePublicKeyFromPrivate } from './crypto.js';
import { computeIdentityHash } from './hash.js';
import { isValidKeyHex } from './storage.js';
import type { CryptoIdentity } from './types.js';

/**
 * Environment variable names for CI identity.
 */
export const CI_ENV_VARS = {
    privateKey: 'NOORM_IDENTITY_PRIVATE_KEY',
    name: 'NOORM_IDENTITY_NAME',
    email: 'NOORM_IDENTITY_EMAIL',
} as const;

/**
 * Result from loading CI identity from environment.
 */
export interface EnvIdentityResult {

    /** Reconstructed crypto identity (with derived public key) */
    identity: CryptoIdentity;

    /** The private key hex string for state/vault decryption */
    privateKey: string;

    /** Audit identity source marker */
    source: 'env';

}

/**
 * Load a CryptoIdentity from CI environment variables.
 *
 * Returns null if any required env var is missing, the private key fails
 * hex/length validation, or the key cannot be parsed as a valid X25519
 * private key. Does not touch the filesystem.
 */
export function loadIdentityFromEnv(): EnvIdentityResult | null {

    const rawKey = process.env[CI_ENV_VARS.privateKey];
    const rawName = process.env[CI_ENV_VARS.name];
    const rawEmail = process.env[CI_ENV_VARS.email];

    if (!rawKey || !rawName || !rawEmail) {

        return null;

    }

    const privateKey = rawKey.trim();
    const name = rawName.trim();
    const email = rawEmail.trim();

    if (!name || !email) {

        return null;

    }

    if (!isValidKeyHex(privateKey)) {

        return null;

    }

    const [publicKey, deriveErr] = attemptSync(() => derivePublicKeyFromPrivate(privateKey));

    if (deriveErr || !publicKey) {

        return null;

    }

    const identityHash = computeIdentityHash({
        email,
        name,
        machine: publicKey,
        os: 'env',
    });

    const identity: CryptoIdentity = {
        identityHash,
        name,
        email,
        publicKey,
        machine: 'ci',
        os: 'env',
        createdAt: new Date().toISOString(),
    };

    return { identity, privateKey, source: 'env' };

}
