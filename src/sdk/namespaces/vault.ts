/**
 * Vault namespace — encrypted team secrets stored in the database.
 *
 * All operations require a connection. Operations that decrypt secrets
 * require the user's privateKey parameter.
 */
import type { Kysely } from 'kysely';

import type { NoormDatabase } from '../../core/shared/index.js';
import type { Dialect } from '../../core/connection/types.js';
import type { Config } from '../../core/config/types.js';
import type {
    VaultSecret,
    VaultStatus,
    VaultCopyResult,
    VaultPropagationResult,
} from '../../core/vault/index.js';
import {
    initializeVault,
    getVaultKey,
    getVaultStatus,
    setVaultSecret,
    getVaultSecret,
    getAllVaultSecrets,
    listVaultSecretKeys,
    deleteVaultSecret,
    vaultSecretExists,
} from '../../core/vault/index.js';
import { propagateVaultKey } from '../../core/vault/propagate.js';
import { copyVaultSecrets, type VaultCopyOptions } from '../../core/vault/copy.js';
import { formatIdentity, loadIdentityMetadata } from '../../core/identity/index.js';
import type { CryptoIdentity } from '../../core/identity/types.js';

import type { ContextState } from '../state.js';
import { requireConnection } from '../state.js';

// ─────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────

/**
 * Error thrown by `VaultNamespace.set()` when the supplied `privateKey`
 * yields no usable vault key — either the vault was never propagated to
 * this identity, or the key doesn't match. The two causes are
 * indistinguishable by design (see the vault absence-vs-failure rule).
 *
 * @example
 * ```typescript
 * await ctx.noorm.vault.set('API_KEY', 'value', privateKey)  // Throws VaultAccessError
 * ```
 */
export class VaultAccessError extends Error {

    override readonly name = 'VaultAccessError' as const;

    constructor(public readonly configName: string) {

        super(
            `No vault access for config "${configName}". Run vault.init() or have a team `
            + 'member vault.propagate() access to you.',
        );

    }

}

// ─────────────────────────────────────────────────────────────
// VaultNamespace
// ─────────────────────────────────────────────────────────────

export class VaultNamespace {

    #state: ContextState;
    #cryptoIdentity: CryptoIdentity | null = null;

    constructor(state: ContextState) {

        this.#state = state;

    }

    /**
     * Load the cryptographic identity (with publicKey + identityHash) on
     * demand. The Context's state.identity is the audit identity (name +
     * email only); the crypto fields needed for vault encryption live in
     * `~/.noorm/identity.json` (or a NOORM_IDENTITY_* env override).
     *
     * Cached after the first call so repeated vault ops don't re-read disk.
     */
    async #getCryptoIdentity(): Promise<CryptoIdentity> {

        if (this.#cryptoIdentity) return this.#cryptoIdentity;

        const loaded = await loadIdentityMetadata();

        if (!loaded) {

            throw new Error(
                'Vault operations require a cryptographic identity at ~/.noorm/identity.json. '
                + 'Run `noorm identity init` or set NOORM_IDENTITY_* env vars in CI.',
            );

        }

        this.#cryptoIdentity = loaded;

        return loaded;

    }

    // ─────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────

    /**
     * Initialize the vault for this database.
     *
     * Idempotent. Returns the vault key on first init; returns null on
     * subsequent calls when the vault already exists — that is NOT an error
     * case. Throws the underlying Error only on real failures (DB errors,
     * encryption errors).
     *
     * The `vault:initialized` observer event fires only on first init, never
     * on repeat calls.
     *
     * @example
     * ```typescript
     * const [vaultKey, err] = await ctx.noorm.vault.init();
     * if (err) throw err;
     * if (vaultKey) {
     *     // first-time init — set initial secrets, etc.
     * }
     * else {
     *     // already initialized — vault.get / vault.set with private key
     * }
     * ```
     */
    async init(): Promise<Buffer | null> {

        const crypto = await this.#getCryptoIdentity();

        const [vaultKey, err] = await initializeVault(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            crypto.identityHash,
            crypto.publicKey,
            this.#dialect,
        );

        if (err) throw err;

        return vaultKey;

    }

    /**
     * Get vault status.
     *
     * @example
     * ```typescript
     * const status = await ctx.noorm.vault.status()
     * ```
     */
    async status(): Promise<VaultStatus> {

        const crypto = await this.#getCryptoIdentity();

        return getVaultStatus(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            crypto.identityHash,
            this.#dialect,
        );

    }

    // ─────────────────────────────────────────────────────
    // CRUD
    // ─────────────────────────────────────────────────────

    /**
     * Set a vault secret.
     *
     * @example
     * ```typescript
     * const [, err] = await ctx.noorm.vault.set('API_KEY', 'sk-live-...', privateKey)
     * ```
     */
    async set(
        key: string,
        value: string,
        privateKey: string,
    ): Promise<void> {

        const vaultKey = await this.#getVaultKey(privateKey);

        if (!vaultKey) throw new VaultAccessError(this.#state.config.name);

        const [, err] = await setVaultSecret(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            vaultKey,
            key,
            value,
            formatIdentity(this.#state.identity),
            this.#dialect,
        );

        if (err) throw err;

    }

    /**
     * Get a vault secret by key.
     *
     * @example
     * ```typescript
     * const value = await ctx.noorm.vault.get('API_KEY', privateKey)
     * ```
     */
    async get(key: string, privateKey: string): Promise<string | null> {

        const vaultKey = await this.#getVaultKey(privateKey);

        if (!vaultKey) return null;

        return getVaultSecret(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            vaultKey,
            key,
            this.#dialect,
        );

    }

    /**
     * Get all vault secrets.
     *
     * @example
     * ```typescript
     * const all = await ctx.noorm.vault.getAll(privateKey)
     * ```
     */
    async getAll(privateKey: string): Promise<Record<string, VaultSecret>> {

        const vaultKey = await this.#getVaultKey(privateKey);

        if (!vaultKey) return {};

        return getAllVaultSecrets(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            vaultKey,
            this.#dialect,
        );

    }

    /**
     * List all vault secret keys (without decrypting values).
     *
     * @example
     * ```typescript
     * const keys = await ctx.noorm.vault.list()
     * ```
     */
    async list(): Promise<string[]> {

        return listVaultSecretKeys(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#dialect,
        );

    }

    /**
     * Delete a vault secret.
     *
     * @example
     * ```typescript
     * const [deleted, err] = await ctx.noorm.vault.delete('OLD_KEY')
     * ```
     */
    async delete(key: string): Promise<boolean> {

        const [deleted, err] = await deleteVaultSecret(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            key,
            this.#dialect,
        );

        if (err) throw err;

        return deleted;

    }

    /**
     * Check if a vault secret exists.
     *
     * @example
     * ```typescript
     * const exists = await ctx.noorm.vault.exists('API_KEY')
     * ```
     */
    async exists(key: string): Promise<boolean> {

        return vaultSecretExists(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            key,
            this.#dialect,
        );

    }

    // ─────────────────────────────────────────────────────
    // Team
    // ─────────────────────────────────────────────────────

    /**
     * Propagate vault key to all users without access.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.vault.propagate(privateKey)
     * ```
     */
    async propagate(privateKey: string): Promise<VaultPropagationResult> {

        const vaultKey = await this.#getVaultKey(privateKey);

        if (!vaultKey) {

            return { propagatedTo: [], alreadyHadAccess: 0 };

        }

        return propagateVaultKey(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            vaultKey,
            this.#dialect,
        );

    }

    /**
     * Copy vault secrets to another config's database.
     *
     * @example
     * ```typescript
     * const [result, err] = await ctx.noorm.vault.copy(destConfig, ['API_KEY'], privateKey)
     * ```
     */
    async copy(
        destConfig: Config,
        keys: string[] | 'all',
        privateKey: string,
        options?: VaultCopyOptions,
    ): Promise<VaultCopyResult> {

        const crypto = await this.#getCryptoIdentity();

        const [result, err] = await copyVaultSecrets(
            this.#state.config,
            destConfig,
            keys,
            crypto.identityHash,
            privateKey,
            crypto.publicKey,
            options,
        );

        if (err) throw err;

        // copyVaultSecrets only leaves result null when err is set (checked above),
        // so this narrows without a cast.
        if (!result) throw new Error('copyVaultSecrets returned no result and no error');

        return result;

    }

    // ─────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────

    get #kysely(): Kysely<unknown> {

        return requireConnection(this.#state).db;

    }

    get #dialect(): Dialect {

        return this.#state.config.connection.dialect;

    }

    async #getVaultKey(privateKey: string): Promise<Buffer | null> {

        const crypto = await this.#getCryptoIdentity();

        return getVaultKey(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            crypto.identityHash,
            privateKey,
            this.#dialect,
        );

    }

}
