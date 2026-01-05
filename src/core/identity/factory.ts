/**
 * Factory for creating cryptographic identities.
 *
 * Handles first-time identity setup including:
 * - Detecting defaults from system/git
 * - Generating keypairs
 * - Saving keys to disk
 * - Computing identity hash
 *
 * @example
 * ```typescript
 * // Detect defaults for form pre-fill
 * const defaults = await detectIdentityDefaults()
 *
 * // Create identity after user confirms/edits
 * const { identity, privateKey } = await createCryptoIdentity({
 *     name: 'Alice Smith',
 *     email: 'alice@example.com',
 * })
 * ```
 */
import { execSync } from 'child_process';
import { hostname, platform, release, userInfo } from 'os';
import { attemptSync } from '@logosdx/utils';

import type { CryptoIdentity, CryptoIdentityInput, KeyPair } from './types.js';
import { generateKeyPair } from './crypto.js';
import {
    saveKeyPair,
    saveIdentityMetadata,
    loadIdentityMetadata,
    loadPublicKey,
} from './storage.js';
import { computeIdentityHash } from './hash.js';
import { observer } from '../observer.js';

/**
 * Detected defaults for identity setup.
 */
export interface IdentityDefaults {
    /** Name from git or OS username */
    name: string;

    /** Email from git (empty if not found) */
    email: string;

    /** Machine hostname */
    machine: string;

    /** OS platform and version */
    os: string;
}

/**
 * Result of creating a crypto identity.
 */
export interface CreateIdentityResult {
    /** The created identity (store in state) */
    identity: CryptoIdentity;

    /** The keypair (privateKey should be stored securely) */
    keypair: KeyPair;
}

/**
 * Detect identity defaults from system and git.
 *
 * Used to pre-populate the identity setup form.
 * User can edit name, email, and machine; OS is auto-detected.
 *
 * @example
 * ```typescript
 * const defaults = await detectIdentityDefaults()
 * // defaults.name = 'Alice Smith' (from git)
 * // defaults.email = 'alice@example.com' (from git)
 * // defaults.machine = 'alice-macbook'
 * // defaults.os = 'darwin 24.5.0'
 * ```
 */
export function detectIdentityDefaults(): IdentityDefaults {

    // Try git config first (most reliable for name/email)
    const [gitName] = attemptSync(() =>
        execSync('git config user.name', {
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim(),
    );

    const [gitEmail] = attemptSync(() =>
        execSync('git config user.email', {
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim(),
    );

    return {
        name: gitName || userInfo().username,
        email: gitEmail || '',
        machine: hostname(),
        os: `${platform()} ${release()}`,
    };

}

/**
 * Create a new cryptographic identity.
 *
 * Generates keypair, computes identity hash, and saves keys to disk.
 * Returns the identity to be stored in state.
 *
 * @param input - User-provided identity details
 * @param saveKeys - Whether to save keys to ~/.noorm (default true)
 *
 * @example
 * ```typescript
 * const { identity, keypair } = await createCryptoIdentity({
 *     name: 'Alice Smith',
 *     email: 'alice@example.com',
 * })
 *
 * // Store identity in state
 * state.identity = identity
 * ```
 */
export async function createCryptoIdentity(
    input: CryptoIdentityInput,
    saveKeys: boolean = true,
): Promise<CreateIdentityResult> {

    // Validate required fields
    if (!input.name?.trim()) {

        throw new Error('Name is required for identity');

    }

    if (!input.email?.trim()) {

        throw new Error('Email is required for identity');

    }

    // Get machine and OS info
    const machine = input.machine?.trim() || hostname();
    const osInfo = `${platform()} ${release()}`;

    // Generate keypair
    const keypair = generateKeyPair();

    // Compute identity hash
    const identityHash = computeIdentityHash({
        email: input.email.trim(),
        name: input.name.trim(),
        machine,
        os: osInfo,
    });

    // Build identity object
    const identity: CryptoIdentity = {
        identityHash,
        name: input.name.trim(),
        email: input.email.trim(),
        publicKey: keypair.publicKey,
        machine,
        os: osInfo,
        createdAt: new Date().toISOString(),
    };

    // Save to disk only if requested (tests pass false to avoid polluting ~/.noorm)
    if (saveKeys) {

        await saveKeyPair(keypair);
        await saveIdentityMetadata(identity);

    }

    // Emit event
    observer.emit('identity:created', {
        identityHash,
        name: identity.name,
        email: identity.email,
        machine: identity.machine,
    });

    return { identity, keypair };

}

/**
 * Regenerate keypair for existing identity.
 *
 * Use when private key is compromised. Updates publicKey and saves new keys.
 * Identity hash remains the same (based on user details, not keys).
 *
 * @param existingIdentity - Current identity to update
 * @param saveKeys - Whether to save keys to ~/.noorm (default true)
 *
 * @example
 * ```typescript
 * const { identity, keypair } = await regenerateKeyPair(state.identity)
 * state.identity = identity
 * ```
 */
export async function regenerateKeyPair(
    existingIdentity: CryptoIdentity,
    saveKeys: boolean = true,
): Promise<CreateIdentityResult> {

    // Generate new keypair
    const keypair = generateKeyPair();

    // Update identity with new public key
    const identity: CryptoIdentity = {
        ...existingIdentity,
        publicKey: keypair.publicKey,
    };

    // Save keys to disk
    if (saveKeys) {

        await saveKeyPair(keypair);

    }

    return { identity, keypair };

}

/**
 * Create identity metadata for existing keys.
 *
 * Use when key files exist but metadata is missing.
 * Loads the existing public key and creates identity metadata.
 *
 * @param input - User-provided identity details
 *
 * @example
 * ```typescript
 * const identity = await createIdentityForExistingKeys({
 *     name: 'Alice Smith',
 *     email: 'alice@example.com',
 * })
 * if (identity) {
 *     await state.setIdentity(identity)
 * }
 * ```
 */
export async function createIdentityForExistingKeys(
    input: CryptoIdentityInput,
): Promise<CryptoIdentity | null> {

    // Validate required fields
    if (!input.name?.trim()) {

        throw new Error('Name is required for identity');

    }

    if (!input.email?.trim()) {

        throw new Error('Email is required for identity');

    }

    // Load existing public key
    const publicKey = await loadPublicKey();

    if (!publicKey) {

        return null;

    }

    // Get machine and OS info
    const machine = input.machine?.trim() || hostname();
    const osInfo = `${platform()} ${release()}`;

    // Compute identity hash
    const identityHash = computeIdentityHash({
        email: input.email.trim(),
        name: input.name.trim(),
        machine,
        os: osInfo,
    });

    // Build identity object
    const identity: CryptoIdentity = {
        identityHash,
        name: input.name.trim(),
        email: input.email.trim(),
        publicKey,
        machine,
        os: osInfo,
        createdAt: new Date().toISOString(),
    };

    // Save metadata
    await saveIdentityMetadata(identity);

    // Emit event
    observer.emit('identity:created', {
        identityHash,
        name: identity.name,
        email: identity.email,
        machine: identity.machine,
    });

    return identity;

}

/**
 * Load existing identity from disk.
 *
 * Loads both the identity metadata and public key from ~/.noorm/.
 * Used when initializing a new project with existing key files.
 *
 * @returns Identity or null if not found/incomplete
 *
 * @example
 * ```typescript
 * const identity = await loadExistingIdentity()
 * if (identity) {
 *     await state.setIdentity(identity)
 * }
 * ```
 */
export async function loadExistingIdentity(): Promise<CryptoIdentity | null> {

    // Load metadata
    const metadata = await loadIdentityMetadata();

    if (!metadata) {

        return null;

    }

    // Verify public key matches (in case files got out of sync)
    const publicKey = await loadPublicKey();

    if (!publicKey) {

        return null;

    }

    // Return identity with current public key
    return {
        ...metadata,
        publicKey,
    };

}
