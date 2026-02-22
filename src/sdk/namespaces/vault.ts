/**
 * Vault namespace — encrypted team secrets stored in the database.
 *
 * All operations require a connection. Operations that decrypt secrets
 * require the user's privateKey parameter.
 */
import type { Kysely } from 'kysely';

import type { NoormDatabase } from '../../core/shared/index.js';
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
import { formatIdentity } from '../../core/identity/index.js';

import type { ContextState } from '../state.js';

// ─────────────────────────────────────────────────────────────
// VaultNamespace
// ─────────────────────────────────────────────────────────────

export class VaultNamespace {

    #state: ContextState;

    constructor(state: ContextState) {

        this.#state = state;

    }

    // ─────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────

    /**
     * Initialize the vault for this database.
     *
     * @example
     * ```typescript
     * const [vaultKey, err] = await ctx.noorm.vault.init()
     * ```
     */
    async init(): Promise<[Buffer | null, Error | null]> {

        return initializeVault(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#identityHash,
            this.#publicKey,
        );

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

        return getVaultStatus(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#identityHash,
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
    ): Promise<[void, Error | null]> {

        const vaultKey = await this.#getVaultKey(privateKey);

        if (!vaultKey) return [undefined, new Error('No vault access')];

        return setVaultSecret(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            vaultKey,
            key,
            value,
            formatIdentity(this.#state.identity),
        );

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
    async delete(key: string): Promise<[boolean, Error | null]> {

        return deleteVaultSecret(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            key,
        );

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
    ): Promise<[VaultCopyResult | null, Error | null]> {

        return copyVaultSecrets(
            this.#state.config,
            destConfig,
            keys,
            this.#identityHash,
            privateKey,
            this.#publicKey,
            options,
        );

    }

    // ─────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────

    get #kysely(): Kysely<unknown> {

        if (!this.#state.connection) {

            throw new Error('Not connected. Call connect() first.');

        }

        return this.#state.connection.db;

    }

    get #identityHash(): string {

        const identity = this.#state.identity as unknown as Record<string, unknown>;

        return (identity['identityHash'] as string) ?? '';

    }

    get #publicKey(): string {

        const identity = this.#state.identity as unknown as Record<string, unknown>;

        return (identity['publicKey'] as string) ?? '';

    }

    async #getVaultKey(privateKey: string): Promise<Buffer | null> {

        return getVaultKey(
            this.#kysely as unknown as Kysely<NoormDatabase>,
            this.#identityHash,
            privateKey,
        );

    }

}
