/**
 * Key file storage for cryptographic identity.
 *
 * Private key stored at ~/.noorm/identity.key
 * Public key stored at ~/.noorm/identity.pub
 *
 * Private key is outside encrypted state to avoid bootstrap problem
 * (we need the key to decrypt state, but state contains the key).
 *
 * @example
 * ```typescript
 * // First-time setup
 * const keypair = generateKeyPair()
 * await saveKeyPair(keypair)
 *
 * // Later sessions
 * const privateKey = await loadPrivateKey()
 * ```
 */
import { homedir } from 'os';
import { join } from 'path';
import { chmod, mkdir, readFile, stat, writeFile } from 'fs/promises';
import { attempt, attemptSync } from '@logosdx/utils';

import type { KeyPair, CryptoIdentity } from './types.js';

// =============================================================================
// Constants
// =============================================================================

/** Base directory for noorm global config */
const NOORM_HOME = join(homedir(), '.noorm');

/** Private key file path */
const PRIVATE_KEY_PATH = join(NOORM_HOME, 'identity.key');

/** Public key file path */
const PUBLIC_KEY_PATH = join(NOORM_HOME, 'identity.pub');

/** File permissions: owner read/write only */
const PRIVATE_KEY_MODE = 0o600;

/** File permissions: owner read/write, others read */
const PUBLIC_KEY_MODE = 0o644;

/** Identity metadata file path */
const IDENTITY_METADATA_PATH = join(NOORM_HOME, 'identity.json');

// =============================================================================
// Directory Setup
// =============================================================================

/**
 * Ensure ~/.noorm directory exists.
 */
async function ensureNoormDir(): Promise<void> {

    const [, err] = await attempt(() => mkdir(NOORM_HOME, { recursive: true }));

    if (err) {

        throw new Error(`Failed to create ${NOORM_HOME}: ${err.message}`);

    }

}

// =============================================================================
// Key Storage
// =============================================================================

/**
 * Save keypair to disk.
 *
 * Creates ~/.noorm directory if it doesn't exist.
 * Sets appropriate file permissions (600 for private, 644 for public).
 *
 * @param keypair - The keypair to save
 *
 * @example
 * ```typescript
 * const keypair = generateKeyPair()
 * await saveKeyPair(keypair)
 * ```
 */
export async function saveKeyPair(keypair: KeyPair): Promise<void> {

    await ensureNoormDir();

    // Write private key
    const [, privateErr] = await attempt(() =>
        writeFile(PRIVATE_KEY_PATH, keypair.privateKey, {
            encoding: 'utf8',
            mode: PRIVATE_KEY_MODE,
        }),
    );

    if (privateErr) {

        throw new Error(`Failed to write private key: ${privateErr.message}`);

    }

    // Ensure permissions are correct (writeFile mode may not work on all platforms)
    await attempt(() => chmod(PRIVATE_KEY_PATH, PRIVATE_KEY_MODE));

    // Write public key
    const [, publicErr] = await attempt(() =>
        writeFile(PUBLIC_KEY_PATH, keypair.publicKey, { encoding: 'utf8', mode: PUBLIC_KEY_MODE }),
    );

    if (publicErr) {

        throw new Error(`Failed to write public key: ${publicErr.message}`);

    }

    await attempt(() => chmod(PUBLIC_KEY_PATH, PUBLIC_KEY_MODE));

}

/**
 * Save identity metadata to disk.
 *
 * Stores name, email, machine, OS alongside key files so that
 * identity can be reconstructed for new projects.
 *
 * @param identity - The identity metadata to save
 *
 * @example
 * ```typescript
 * const { identity } = await createCryptoIdentity({ name, email })
 * await saveIdentityMetadata(identity)
 * ```
 */
export async function saveIdentityMetadata(identity: CryptoIdentity): Promise<void> {

    await ensureNoormDir();

    const metadata = {
        identityHash: identity.identityHash,
        name: identity.name,
        email: identity.email,
        publicKey: identity.publicKey,
        machine: identity.machine,
        os: identity.os,
        createdAt: identity.createdAt,
    };

    const [, err] = await attempt(() =>
        writeFile(IDENTITY_METADATA_PATH, JSON.stringify(metadata, null, 2), { encoding: 'utf8' }),
    );

    if (err) {

        throw new Error(`Failed to write identity metadata: ${err.message}`);

    }

}

/**
 * Load identity metadata from disk.
 *
 * @returns Identity metadata or null if not found
 *
 * @example
 * ```typescript
 * const identity = await loadIdentityMetadata()
 * if (identity) {
 *     await state.setIdentity(identity)
 * }
 * ```
 */
export async function loadIdentityMetadata(): Promise<CryptoIdentity | null> {

    const [content, err] = await attempt(() =>
        readFile(IDENTITY_METADATA_PATH, { encoding: 'utf8' }),
    );

    if (err) {

        // File doesn't exist = no metadata yet
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {

            return null;

        }

        throw new Error(`Failed to read identity metadata: ${err.message}`);

    }

    const [parsed, parseErr] = attemptSync(() => JSON.parse(content!) as CryptoIdentity);

    if (parseErr) {

        return null;

    }

    return parsed;

}

/**
 * Load private key from disk.
 *
 * @returns Private key as hex string, or null if not found
 *
 * @example
 * ```typescript
 * const privateKey = await loadPrivateKey()
 * if (!privateKey) {
 *     // First-time setup needed
 * }
 * ```
 */
export async function loadPrivateKey(): Promise<string | null> {

    const [content, err] = await attempt(() => readFile(PRIVATE_KEY_PATH, { encoding: 'utf8' }));

    if (err) {

        // File doesn't exist = no identity yet
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {

            return null;

        }

        throw new Error(`Failed to read private key: ${err.message}`);

    }

    return content.trim();

}

/**
 * Load public key from disk.
 *
 * @returns Public key as hex string, or null if not found
 *
 * @example
 * ```typescript
 * const publicKey = await loadPublicKey()
 * console.log(`Share this with others: ${publicKey}`)
 * ```
 */
export async function loadPublicKey(): Promise<string | null> {

    const [content, err] = await attempt(() => readFile(PUBLIC_KEY_PATH, { encoding: 'utf8' }));

    if (err) {

        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {

            return null;

        }

        throw new Error(`Failed to read public key: ${err.message}`);

    }

    return content.trim();

}

/**
 * Load full keypair from disk.
 *
 * @returns Keypair or null if identity not set up
 *
 * @example
 * ```typescript
 * const keypair = await loadKeyPair()
 * if (!keypair) {
 *     console.log('Run noorm identity init first')
 * }
 * ```
 */
export async function loadKeyPair(): Promise<KeyPair | null> {

    const privateKey = await loadPrivateKey();
    const publicKey = await loadPublicKey();

    if (!privateKey || !publicKey) {

        return null;

    }

    return { privateKey, publicKey };

}

/**
 * Check if identity key files exist.
 *
 * @returns True if both key files exist
 */
export async function hasKeyFiles(): Promise<boolean> {

    const [privateStat] = await attempt(() => stat(PRIVATE_KEY_PATH));
    const [publicStat] = await attempt(() => stat(PUBLIC_KEY_PATH));

    return !!privateStat && !!publicStat;

}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate that private key file has correct permissions.
 *
 * @returns True if permissions are 600 (owner read/write only)
 */
export async function validateKeyPermissions(): Promise<boolean> {

    const [stats, err] = await attempt(() => stat(PRIVATE_KEY_PATH));

    if (err) {

        return false;

    }

    // Check mode (mask off file type bits)
    const mode = stats.mode & 0o777;

    return mode === PRIVATE_KEY_MODE;

}

/**
 * Validate that a hex string is a valid X25519 key.
 *
 * X25519 keys are 32 bytes = 64 hex characters for the raw key,
 * but in DER format they're longer due to ASN.1 encoding.
 *
 * @param hex - Hex-encoded key to validate
 * @returns True if the key appears valid
 */
export function isValidKeyHex(hex: string): boolean {

    // Check hex format
    if (!/^[0-9a-f]+$/i.test(hex)) {

        return false;

    }

    // DER-encoded X25519 keys have specific lengths
    // PKCS8 private key: 48 bytes = 96 hex chars
    // SPKI public key: 44 bytes = 88 hex chars
    const validLengths = [88, 96];

    return validLengths.includes(hex.length);

}

// =============================================================================
// Path Accessors
// =============================================================================

/**
 * Get the path to the private key file.
 */
export function getPrivateKeyPath(): string {

    return PRIVATE_KEY_PATH;

}

/**
 * Get the path to the public key file.
 */
export function getPublicKeyPath(): string {

    return PUBLIC_KEY_PATH;

}

/**
 * Get the path to the noorm home directory.
 */
export function getNoormHomePath(): string {

    return NOORM_HOME;

}
