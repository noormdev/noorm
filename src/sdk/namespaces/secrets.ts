/**
 * Secrets namespace — local config-scoped secrets.
 *
 * Mirrors [k] secrets in the TUI. Reads from local encrypted state,
 * not the database vault. No connection required.
 */
import { getStateManager } from '../../core/state/index.js';

import type { ContextState } from '../state.js';
import { checkProtectedConfig } from '../guards.js';
import type { Permission } from '../../core/policy/index.js';

// ─────────────────────────────────────────────────────────────
// SecretsNamespace
// ─────────────────────────────────────────────────────────────

export class SecretsNamespace {

    #state: ContextState;

    constructor(state: ContextState) {

        this.#state = state;

    }

    /**
     * Gate a secret operation on the config's access policy.
     *
     * Config-scoped secrets are as sensitive as vault secrets — they feed the
     * same `$.secrets` template namespace — so they sit behind the same
     * matrix rather than being readable by any role that can open a context.
     *
     * @throws ProtectedConfigError when the policy denies, or requires a
     * confirmation `options.yes` doesn't supply.
     */
    #gate(permission: Permission, operation: string): void {

        checkProtectedConfig(this.#state.config, this.#state.options, permission, operation);

    }

    /**
     * Get a config-scoped secret.
     *
     * @example
     * ```typescript
     * const apiKey = ctx.noorm.secrets.get('API_KEY')
     * ```
     */
    get(key: string): string | undefined {

        this.#gate('secret:read', 'secrets.get');

        const state = getStateManager(this.#state.projectRoot);
        const value = state.getSecret(this.#state.config.name, key);

        return value ?? undefined;

    }

    /**
     * List the config's secret key names.
     *
     * Values are never returned — use `get` for a specific key, so a caller
     * that only needs to know *which* secrets exist never handles them.
     *
     * @example
     * ```typescript
     * const keys = ctx.noorm.secrets.list()
     * ```
     */
    list(): string[] {

        this.#gate('secret:read', 'secrets.list');

        return getStateManager(this.#state.projectRoot).listSecrets(this.#state.config.name);

    }

    /**
     * Set a config-scoped secret.
     *
     * @example
     * ```typescript
     * await ctx.noorm.secrets.set('API_KEY', 'sk-live-...')
     * ```
     */
    async set(key: string, value: string): Promise<void> {

        this.#gate('secret:write', 'secrets.set');

        await getStateManager(this.#state.projectRoot).setSecret(this.#state.config.name, key, value);

    }

    /**
     * Delete a config-scoped secret.
     *
     * @example
     * ```typescript
     * await ctx.noorm.secrets.delete('OLD_KEY')
     * ```
     */
    async delete(key: string): Promise<void> {

        this.#gate('secret:write', 'secrets.delete');

        await getStateManager(this.#state.projectRoot).deleteSecret(this.#state.config.name, key);

    }

}
