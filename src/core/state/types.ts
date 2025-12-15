/**
 * State types.
 *
 * The State object is the in-memory representation of noorm's persistent data.
 * It holds all configs, secrets, and the active config reference.
 */
import type { Config } from '../config/types.js'


/**
 * The root state object stored in .noorm/state.enc
 *
 * Version tracks the package version that last wrote the state.
 * This enables migrations when the state schema changes between versions.
 */
export interface State {

    /** Package version that last saved this state */
    version: string
    activeConfig: string | null
    configs: Record<string, Config>
    secrets: Record<string, Record<string, string>>  // configName -> key -> value
    globalSecrets: Record<string, string>            // key -> value (app-level secrets like API keys)
}


/**
 * Summary for config listings (used by StateManager).
 */
export interface ConfigSummary {

    name: string
    type: 'local' | 'remote'
    isTest: boolean
    protected: boolean
    isActive: boolean
}


/**
 * Encrypted payload structure stored on disk.
 */
export interface EncryptedPayload {

    version: 1
    algorithm: 'aes-256-gcm'
    iv: string          // Base64
    authTag: string     // Base64
    ciphertext: string  // Base64
    salt: string        // Base64
}


/**
 * Create an empty state with the given version.
 *
 * @example
 * ```typescript
 * import { createEmptyState } from './types'
 * import { version } from '../../../package.json'
 *
 * const state = createEmptyState(version)
 * ```
 */
export function createEmptyState(version: string): State {

    return {
        version,
        activeConfig: null,
        configs: {},
        secrets: {},
        globalSecrets: {},
    }
}
