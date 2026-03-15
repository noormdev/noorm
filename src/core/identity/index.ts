/**
 * Identity module.
 *
 * Two types of identity in noorm:
 * 1. Audit Identity - Simple name/email for tracking "who executed this"
 * 2. Cryptographic Identity - Full keypair system for config sharing
 *
 * Audit identity resolution is cached for the duration of a command.
 * Cryptographic identity is created on first run and stored in state.
*/
import { attempt } from '@logosdx/utils';
import type { Kysely } from 'kysely';

import type { NoormDatabase } from '../shared/tables.js';
import type { Dialect } from '../connection/types.js';
import { observer } from '../observer.js';

import type { CryptoIdentity, Identity, IdentityOptions } from './types.js';
import { resolveIdentity as resolve } from './resolver.js';
import { loadExistingIdentity } from './factory.js';
import { registerIdentity } from './sync.js';

// =============================================================================
// Re-exports
// =============================================================================

// Types
export * from './types.js';

// Resolver utilities
export { formatIdentity, identityToString } from './resolver.js';

// Cryptographic operations
export {
    generateKeyPair,
    encryptForRecipient,
    decryptWithPrivateKey,
    deriveStateKey,
    encryptState,
    decryptState,
} from './crypto.js';

// Key storage
export {
    saveKeyPair,
    loadPrivateKey,
    loadPublicKey,
    loadKeyPair,
    hasKeyFiles,
    validateKeyPermissions,
    isValidKeyHex,
    getPrivateKeyPath,
    getPublicKeyPath,
    getNoormHomePath,
    saveIdentityMetadata,
    loadIdentityMetadata,
} from './storage.js';

// Hash utilities
export { computeIdentityHash, isValidIdentityHash, truncateHash } from './hash.js';

// Factory
export {
    detectIdentityDefaults,
    createCryptoIdentity,
    createIdentityForExistingKeys,
    regenerateKeyPair,
    loadExistingIdentity,
} from './factory.js';

export type { IdentityDefaults, CreateIdentityResult } from './factory.js';
export type { IdentityHashInput } from './hash.js';

// Sync (database identity registration and discovery)
export {
    registerIdentity,
    fetchKnownUsers,
    syncIdentity,
    syncIdentityWithConfig,
} from './sync.js';

export type { IdentitySyncResult } from './sync.js';


// =============================================================================
// Audit Identity Resolution (cached)
// =============================================================================

let cachedIdentity: Identity | null = null;

/**
 * Get the current audit identity (cached).
 *
 * Results are cached unless a config or crypto override is provided,
 * since overrides may vary between calls.
 *
 * @example
 * ```typescript
 * const identity = resolveIdentity()
 * console.log(`Executed by: ${formatIdentity(identity)}`)
 * ```
 *
 * @example
 * ```typescript
 * // With crypto identity from state
 * const identity = resolveIdentity({
 *     cryptoIdentity: state.identity,
 * })
 * ```
 */
export function resolveIdentity(options: IdentityOptions = {}): Identity {

    // Don't cache if using overrides (might change between calls)
    if (options.configIdentity || options.cryptoIdentity) {

        return resolve(options);

    }

    if (!cachedIdentity) {

        cachedIdentity = resolve(options);

    }

    return cachedIdentity;

}

/**
 * Clear the identity cache.
 *
 * Useful for testing or when environment changes.
 */
export function clearIdentityCache(): void {

    cachedIdentity = null;

}

/**
 * Get audit identity with config awareness.
 *
 * Convenience function that extracts the identity override from a config.
 *
 * @example
 * ```typescript
 * const config = await resolveConfig(state)
 * const identity = getIdentityForConfig(config)
 * ```
 */
export function getIdentityForConfig(config: { identity?: string }): Identity {

    return resolveIdentity({ configIdentity: config.identity });

}

/**
 * Get audit identity with crypto identity awareness.
 *
 * Convenience function that uses crypto identity if available,
 * falling back to other sources.
 *
 * @example
 * ```typescript
 * const identity = getIdentityWithCrypto(state.identity, config)
 * ```
 */
export function getIdentityWithCrypto(
    cryptoIdentity: CryptoIdentity | null,
    config?: { identity?: string },
): Identity {

    return resolveIdentity({
        configIdentity: config?.identity,
        cryptoIdentity,
    });

}

/**
 * Load identity from disk and register it in the database.
 *
 * Ensures the current user's identity is present in the tracking tables
 * after schema bootstrap or migration.
 *
 * @example
 * ```typescript
 * await waitForIdentityToLoad(db, 'postgres')
 * ```
 */
export async function waitForIdentityToLoad(db: Kysely<NoormDatabase>, dialect: Dialect) {

    // Load identity from ~/.noorm/
    const identity = await loadExistingIdentity();

    if (!identity) observer.emit('identity:not-found');
    if (!identity) return;

    const [, err] = await attempt(() => registerIdentity(db, identity, dialect));

    if (err) observer.emit('error', {
        error: err,
        source: 'identity:ensure',
        context: { identity },
    });

}
