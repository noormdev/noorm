/**
 * State types.
 *
 * The State object is the in-memory representation of noorm's persistent data.
 * It holds identity, configs, secrets, and known users.
 */
import type { Config } from '../config/types.js'
import type { CryptoIdentity, KnownUser } from '../identity/types.js'


/**
 * The root state object stored in .noorm/state.enc
 *
 * Version tracks the package version that last wrote the state.
 * This enables migrations when the state schema changes between versions.
 */
export interface State {

    /** Package version that last saved this state */
    version: string

    /** User's cryptographic identity (null if not set up yet) */
    identity: CryptoIdentity | null

    /** Known users discovered from database syncs (identityHash -> KnownUser) */
    knownUsers: Record<string, KnownUser>

    /** Currently selected config name */
    activeConfig: string | null

    /** All database configs (name -> Config) */
    configs: Record<string, Config>

    /** Config-scoped secrets (configName -> key -> value) */
    secrets: Record<string, Record<string, string>>

    /** App-level secrets (key -> value) */
    globalSecrets: Record<string, string>
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
    dialect: string
    database: string
}


/**
 * Encrypted payload structure stored on disk.
 *
 * Uses AES-256-GCM with key derived from the user's private key via HKDF.
 */
export interface EncryptedPayload {

    /** Encryption algorithm (always AES-256-GCM) */
    algorithm: 'aes-256-gcm'

    /** Initialization vector (base64) */
    iv: string

    /** Authentication tag (base64) */
    authTag: string

    /** Encrypted state (base64) */
    ciphertext: string
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
        identity: null,
        knownUsers: {},
        activeConfig: null,
        configs: {},
        secrets: {},
        globalSecrets: {},
    }
}
