/**
 * Secrets namespace — local config-scoped secrets.
 *
 * Mirrors [k] secrets in the TUI. Reads from local encrypted state,
 * not the database vault. No connection required.
 */
import { getStateManager } from '../../core/state/index.js';

import type { ContextState } from '../state.js';

// ─────────────────────────────────────────────────────────────
// SecretsNamespace
// ─────────────────────────────────────────────────────────────

export class SecretsNamespace {

    #state: ContextState;

    constructor(state: ContextState) {

        this.#state = state;

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

        const state = getStateManager(this.#state.projectRoot);
        const value = state.getSecret(this.#state.config.name, key);

        return value ?? undefined;

    }

}
