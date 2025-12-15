/**
 * Identity module - determines who executed operations.
 *
 * Identity resolution is cached for the duration of a command
 * since it won't change mid-execution.
 */
import type { Identity, IdentityOptions } from './types.js'
import { resolveIdentity as resolve, formatIdentity, identityToString } from './resolver.js'


// Re-export types and utilities
export * from './types.js'
export { formatIdentity, identityToString } from './resolver.js'


let cachedIdentity: Identity | null = null


/**
 * Get the current identity (cached).
 *
 * Results are cached unless a config override is provided,
 * since config overrides may vary between calls.
 *
 * @example
 * ```typescript
 * const identity = resolveIdentity()
 * console.log(`Executed by: ${formatIdentity(identity)}`)
 * ```
 */
export function resolveIdentity(options: IdentityOptions = {}): Identity {

    // Don't cache if using config override (might change between calls)
    if (options.configIdentity) {

        return resolve(options)
    }

    if (!cachedIdentity) {

        cachedIdentity = resolve(options)
    }

    return cachedIdentity
}


/**
 * Clear the identity cache.
 *
 * Useful for testing or when environment changes.
 */
export function clearIdentityCache(): void {

    cachedIdentity = null
}


/**
 * Get identity with config awareness.
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

    return resolveIdentity({ configIdentity: config.identity })
}
