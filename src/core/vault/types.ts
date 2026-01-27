/**
 * Vault types.
 *
 * Types for the vault system that stores encrypted secrets shared across the team.
 * Vault secrets are stored in the database and encrypted with a vault key that is
 * distributed to team members via their public keys.
 */

/**
 * Encrypted vault key payload.
 *
 * The vault key is encrypted for each user using their public key.
 * Uses the ephemeral keypair pattern (same as config sharing).
 */
export interface EncryptedVaultKey {
    /** Ephemeral X25519 public key (hex) */
    ephemeralPubKey: string;

    /** Initialization vector (hex) */
    iv: string;

    /** Authentication tag (hex) */
    authTag: string;

    /** Encrypted vault key (hex) */
    ciphertext: string;
}

/**
 * Encrypted secret value.
 *
 * Stored in the encrypted_value column of __noorm_vault__.
 * Uses AES-256-GCM with the vault key.
 */
export interface EncryptedSecret {
    /** Initialization vector (hex) */
    iv: string;

    /** Authentication tag (hex) */
    authTag: string;

    /** Encrypted value (hex) */
    ciphertext: string;
}

/**
 * Vault secret entry (decrypted).
 */
export interface VaultSecret {
    /** Secret key name */
    key: string;

    /** Decrypted value */
    value: string;

    /** Identity who set this secret */
    setBy: string;

    /** When created */
    createdAt: Date;

    /** When last updated */
    updatedAt: Date;
}

/**
 * Result of vault copy operation.
 */
export interface VaultCopyResult {
    /** Keys that were successfully copied */
    copied: string[];

    /** Keys that were skipped (already exist and force not set) */
    skipped: string[];

    /** Keys that failed with errors */
    errors: Array<{ key: string; error: string }>;
}

/**
 * Result of vault propagation.
 */
export interface VaultPropagationResult {
    /** Identity hashes that received the vault key */
    propagatedTo: string[];

    /** Count of users who already had access */
    alreadyHadAccess: number;
}

/**
 * Vault status for the current user.
 */
export interface VaultStatus {
    /** Whether the vault is initialized (at least one user has the vault key) */
    isInitialized: boolean;

    /** Whether the current user has access to the vault */
    hasAccess: boolean;

    /** Number of secrets in the vault */
    secretCount: number;

    /** Number of users with vault access */
    usersWithAccess: number;

    /** Number of users without vault access */
    usersWithoutAccess: number;
}
