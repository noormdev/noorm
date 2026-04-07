/**
 * Screen-level identity resolution.
 *
 * Wraps the core resolveIdentity with null coalescing for the
 * common screen pattern where cryptoIdentity may be undefined.
 *
 * @example
 * ```typescript
 * const identity = resolveScreenIdentity(cryptoIdentity);
 * ```
 */
import type { CryptoIdentity, Identity } from '../../core/identity/types.js';
import { resolveIdentity } from '../../core/identity/resolver.js';

/**
 * Resolve identity for screen operations.
 *
 * Handles the null/undefined coalescing that every screen does manually.
 *
 * @example
 * ```typescript
 * const { identity } = useAppContext();
 * const resolved = resolveScreenIdentity(identity);
 * ```
 */
export function resolveScreenIdentity(cryptoIdentity: CryptoIdentity | null | undefined): Identity {

    return resolveIdentity({
        cryptoIdentity: cryptoIdentity ?? null,
    });

}
