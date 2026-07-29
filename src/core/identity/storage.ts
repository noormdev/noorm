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
 * Copy the existing identity files aside before they are overwritten.
 *
 * `deriveStateKey` is HKDF over the private key, so replacing the keypair
 * makes every `state.enc` on the machine undecryptable — configs, secrets and
 * database passwords, with no recovery path. Nothing in noorm re-encrypts
 * existing state under a new key, so the old key file is the only way back.
 *
 * Backups are written owner-only, including the public key and metadata, so a
 * recovery copy never widens the permissions of what it copies.
 *
 * @returns Absolute paths of the backup files that were written
 *
 * @throws Error if the private key exists but cannot be backed up — the caller
 * must not proceed with an overwrite it cannot undo
 *
 * @example
 * ```typescript
 * const backups = await backupKeyPair()
 * console.log(`Previous identity saved to ${backups[0]}`)
 * ```
 */
export async function backupKeyPair(): Promise<string[]> {

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const written: string[] = [];

    for (const source of [PRIVATE_KEY_PATH, PUBLIC_KEY_PATH, IDENTITY_METADATA_PATH]) {

        const [content, readErr] = await attempt(() => readFile(source, { encoding: 'utf8' }));

        if (readErr) {

            // A missing .pub or .json is survivable — both are derivable or
            // re-creatable. A missing private key is not, and is the file worth
            // aborting over.
            if (source === PRIVATE_KEY_PATH) {

                throw new Error(`Failed to read private key for backup: ${readErr.message}`);

            }

            continue;

        }

        const target = `${source}.bak-${stamp}`;

        const [, writeErr] = await attempt(() =>
            writeFile(target, content, { encoding: 'utf8', mode: PRIVATE_KEY_MODE }),
        );

        if (writeErr) {

            throw new Error(`Failed to write backup ${target}: ${writeErr.message}`);

        }

        await attempt(() => chmod(target, PRIVATE_KEY_MODE));

        written.push(target);

    }

    return written;

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
 * Returns the in-memory override if set, otherwise reads from disk.
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

    if (identityOverride) {

        return identityOverride;

    }

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
 * Returns the in-memory override if set, otherwise reads from disk.
 *
 * A missing file is "no identity yet" (null). A file that exists but does not
 * hold well-formed key material is a hard error, not a null: silently passing
 * corrupted bytes downstream lets `deriveStateKey` truncate them to a
 * degenerate input and encrypt state under a publicly computable key. A
 * partially-synced or truncated key file is otherwise undetectable, since
 * nothing verifies `identity.key` against the sibling `identity.pub`.
 *
 * @returns Private key as hex string, or null if not found
 *
 * @throws Error if the key file exists but is corrupted or has unsafe permissions
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

    if (keyOverride) {

        return keyOverride;

    }

    const [content, err] = await attempt(() => readFile(PRIVATE_KEY_PATH, { encoding: 'utf8' }));

    if (err) {

        // File doesn't exist = no identity yet
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {

            return null;

        }

        throw new Error(`Failed to read private key: ${err.message}`);

    }

    const permissionsOk = await validateKeyPermissions();

    if (!permissionsOk) {

        throw new Error(
            `Insecure permissions on private key file (${PRIVATE_KEY_PATH}). Fix with: chmod 600 ${PRIVATE_KEY_PATH}`,
        );

    }

    const privateKey = content.trim();

    if (!isValidKeyHex(privateKey)) {

        throw new Error(
            `Corrupted private key file (${PRIVATE_KEY_PATH}): contents are not hex-encoded X25519 key material. ` +
            'Restore it from your backup — state encrypted under a different key cannot be recovered by regenerating one.',
        );

    }

    return privateKey;

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
 * Validate that a private key file has secure permissions.
 *
 * Threat-model check, not strict equality: passes when no group/other
 * bits are set (mode & 0o077 === 0), so both 0600 and a stricter 0400
 * pass while 0644/0640/0660/0666 fail.
 *
 * Windows emulates POSIX modes and `stat` commonly reports 0666 there
 * regardless of actual ACLs, so this always returns true on win32 —
 * otherwise the check would hard-lock every Windows user out.
 *
 * @param path - Key file to check (defaults to the private key path)
 * @returns True if permissions are secure, or the platform is win32
 */
export async function validateKeyPermissions(path: string = PRIVATE_KEY_PATH): Promise<boolean> {

    if (process.platform === 'win32') {

        return true;

    }

    const [stats, err] = await attempt(() => stat(path));

    if (err) {

        return false;

    }

    // Check mode (mask off file type bits)
    const mode = stats.mode & 0o777;

    return (mode & 0o077) === 0;

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

// =============================================================================
// In-Memory Private Key Override (CI)
// =============================================================================

/**
 * In-memory private key override for CI environments.
 *
 * When set, loadPrivateKey() returns this value instead of reading
 * from ~/.noorm/identity.key. Used by the env-based identity bootstrap
 * so CI runners can provide credentials without disk files.
 */
let keyOverride: string | null = null;

/**
 * Set an in-memory private key override.
 *
 * Called once at process startup (in `cli/index.ts entry()`) when CI
 * env vars are detected. After this, `loadPrivateKey()` returns
 * the env key for the lifetime of the process.
 *
 * Validated for the same reason `loadPrivateKey()` validates the disk file:
 * whatever lands here flows straight into `deriveStateKey`, and malformed
 * key material silently derives a publicly computable encryption key. This
 * is a public export, so the env loader's own check is not sufficient.
 *
 * @throws Error if the key is not well-formed hex key material
 */
export function setKeyOverride(key: string): void {

    if (!isValidKeyHex(key)) {

        throw new Error(
            'Invalid private key override: expected a hex-encoded X25519 key ' +
            '(96 hex characters). Check NOORM_IDENTITY_PRIVATE_KEY.',
        );

    }

    keyOverride = key;

}

/**
 * Clear the in-memory private key override.
 */
export function clearKeyOverride(): void {

    keyOverride = null;

}

/**
 * Get the current private key override, if any.
 */
export function getKeyOverride(): string | null {

    return keyOverride;

}

// =============================================================================
// In-Memory Identity Metadata Override (CI)
// =============================================================================

/**
 * In-memory identity metadata override for CI environments.
 *
 * When set, loadIdentityMetadata() returns this value instead of reading
 * `~/.noorm/identity.json`. Symmetric to the private key override:
 * together they let env-based identities satisfy every code path that
 * looks up identity from disk.
 */
let identityOverride: CryptoIdentity | null = null;

/**
 * Set an in-memory identity metadata override.
 *
 * Called once at process startup (in `cli/index.ts entry()`) when CI
 * env vars are detected. After this, `loadIdentityMetadata()` returns
 * the env identity for the lifetime of the process.
 */
export function setIdentityOverride(identity: CryptoIdentity): void {

    identityOverride = identity;

}

/**
 * Clear the in-memory identity metadata override.
 */
export function clearIdentityOverride(): void {

    identityOverride = null;

}

/**
 * Get the current identity metadata override, if any.
 */
export function getIdentityOverride(): CryptoIdentity | null {

    return identityOverride;

}
