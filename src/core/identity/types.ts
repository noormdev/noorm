/**
 * Identity types.
 *
 * Two types of identity in noorm:
 * 1. Audit Identity - Simple name/email for tracking "who executed this"
 * 2. Cryptographic Identity - Full keypair system for config sharing and team discovery
 */


// =============================================================================
// Audit Identity (for tracking tables)
// =============================================================================


/**
 * Source of audit identity resolution.
 */
export type IdentitySource = 'state' | 'config' | 'env' | 'git' | 'system'


/**
 * Resolved audit identity.
 *
 * Used for tracking "who" executed a changeset or SQL file.
 *
 * @example
 * ```typescript
 * const identity: Identity = {
 *     name: 'John Doe',
 *     email: 'john@example.com',
 *     source: 'git',
 * }
 * ```
 */
export interface Identity {

    /** User's name */
    name: string

    /** User's email (optional) */
    email?: string

    /** How the identity was resolved */
    source: IdentitySource
}


/**
 * Options for audit identity resolution.
 */
export interface IdentityOptions {

    /** Override from config */
    configIdentity?: string

    /** Skip git lookup (faster, for CI) */
    skipGit?: boolean

    /** Cryptographic identity from state (highest priority) */
    cryptoIdentity?: CryptoIdentity | null
}


// =============================================================================
// Cryptographic Identity (for config sharing and team discovery)
// =============================================================================


/**
 * Cryptographic identity for secure config sharing.
 *
 * Created on first run and stored in encrypted state.
 * Private key stored separately at ~/.noorm/identity.key
 *
 * @example
 * ```typescript
 * const cryptoIdentity: CryptoIdentity = {
 *     identityHash: 'abc123...',
 *     name: 'Alice Smith',
 *     email: 'alice@example.com',
 *     publicKey: 'x25519-pubkey-hex...',
 *     machine: 'alice-macbook',
 *     os: 'darwin 24.5.0',
 *     createdAt: '2024-01-15T10:30:00Z',
 * }
 * ```
 */
export interface CryptoIdentity {

    /** SHA-256(email + '\0' + name + '\0' + machine + '\0' + os) */
    identityHash: string

    /** User's display name */
    name: string

    /** User's email address */
    email: string

    /** X25519 public key (hex encoded) */
    publicKey: string

    /** Machine hostname */
    machine: string

    /** OS platform and version (e.g., "darwin 24.5.0") */
    os: string

    /** ISO timestamp of when identity was created */
    createdAt: string
}


/**
 * Input for creating a new cryptographic identity.
 */
export interface CryptoIdentityInput {

    /** User's display name */
    name: string

    /** User's email address */
    email: string

    /** Machine hostname (defaults to os.hostname()) */
    machine?: string
}


/**
 * Generated keypair for cryptographic identity.
 */
export interface KeyPair {

    /** X25519 public key (hex encoded) */
    publicKey: string

    /** X25519 private key (hex encoded) */
    privateKey: string
}


// =============================================================================
// Known Users (discovered from database sync)
// =============================================================================


/**
 * Cached identity discovered from database sync.
 *
 * Same user on different machines = different identities with different keypairs.
 *
 * @example
 * ```typescript
 * const knownUser: KnownUser = {
 *     identityHash: 'abc123...',
 *     name: 'Bob Jones',
 *     email: 'bob@company.com',
 *     publicKey: 'x25519-pubkey-hex...',
 *     machine: 'bob-workstation',
 *     os: 'linux 5.15.0',
 *     lastSeen: '2024-01-15T10:30:00Z',
 *     source: 'prod-db',
 * }
 * ```
 */
export interface KnownUser {

    /** SHA-256(email + '\0' + name + '\0' + machine + '\0' + os) */
    identityHash: string

    /** User's email */
    email: string

    /** User's display name */
    name: string

    /** X25519 public key (hex encoded) */
    publicKey: string

    /** Machine hostname */
    machine: string

    /** OS platform and version */
    os: string

    /** ISO timestamp of last database activity */
    lastSeen: string

    /** Config name where this user was discovered */
    source: string
}


// =============================================================================
// Encrypted Sharing (for config export/import)
// =============================================================================


/**
 * Encrypted payload for config sharing.
 *
 * Uses X25519 + AES-256-GCM (ephemeral keypair pattern).
 */
export interface SharedConfigPayload {

    /** Payload format version */
    version: number

    /** Sender's email */
    sender: string

    /** Recipient's email */
    recipient: string

    /** Ephemeral X25519 public key (hex) */
    ephemeralPubKey: string

    /** Initialization vector (hex) */
    iv: string

    /** Authentication tag (hex) */
    authTag: string

    /** Encrypted config data (hex) */
    ciphertext: string
}


/**
 * Decrypted config data from sharing.
 *
 * NOTE: user/password are NOT included - recipient provides their own.
 */
export interface ExportedConfig {

    /** Config name */
    name: string

    /** Database dialect */
    dialect: string

    /** Connection details (excluding user/password) */
    connection: {
        host?: string
        port?: number
        database: string
        ssl?: boolean
        pool?: { min?: number; max?: number }
    }

    /** File paths */
    paths: {
        schema: string
        changesets: string
    }

    /** Test database flag */
    isTest: boolean

    /** Protection flag */
    protected: boolean

    /** Config-scoped secrets */
    secrets: Record<string, string>
}
