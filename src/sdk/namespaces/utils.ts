/**
 * Utils namespace — utilities that don't fit a specific domain.
 *
 * Checksum is offline. Test connection uses the config but
 * doesn't require an active connection.
 */
import path from 'node:path';

import { computeChecksum as coreComputeChecksum } from '../../core/runner/index.js';
import { testConnection as coreTestConnection } from '../../core/connection/index.js';

import type { ContextState } from '../state.js';

// ─────────────────────────────────────────────────────────────
// UtilsNamespace
// ─────────────────────────────────────────────────────────────

export class UtilsNamespace {

    #state: ContextState;

    constructor(state: ContextState) {

        this.#state = state;

    }

    /**
     * Compute SHA-256 checksum for a file.
     *
     * @example
     * ```typescript
     * const checksum = await ctx.noorm.utils.checksum('sql/001_users.sql')
     * ```
     */
    async checksum(filepath: string): Promise<string> {

        const absolutePath = path.isAbsolute(filepath)
            ? filepath
            : path.join(this.#state.projectRoot, filepath);

        return coreComputeChecksum(absolutePath);

    }

    /**
     * Tests if the connection can be established.
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.utils.testConnection()
     * ```
     */
    async testConnection(): Promise<{ ok: boolean; error?: string }> {

        return coreTestConnection(this.#state.config.connection);

    }

}
