/**
 * State Migration v1 - Initial state shape.
 *
 * Defines the baseline state structure. This migration ensures
 * all required fields exist with sensible defaults.
 *
 * For state schema documentation, see plan/datamodel.md#State
 */
import type { StateMigration } from '../../types.js';

/**
 * Migration v1: Initial state shape.
 *
 * Ensures state has all required fields:
 * - schemaVersion: number (state schema version, not package version)
 * - identity: CryptoIdentity | null
 * - knownUsers: Record<string, KnownUser>
 * - activeConfig: string | null
 * - configs: Record<string, Config>
 * - secrets: Record<string, Record<string, string>>
 * - globalSecrets: Record<string, string>
 */
export const v1: StateMigration = {
    version: 1,
    description: 'Initial state shape',

    up(state: Record<string, unknown>): Record<string, unknown> {

        return {
            schemaVersion: 1,
            identity: state['identity'] ?? null,
            knownUsers: state['knownUsers'] ?? {},
            activeConfig: state['activeConfig'] ?? null,
            configs: state['configs'] ?? {},
            secrets: state['secrets'] ?? {},
            globalSecrets: state['globalSecrets'] ?? {},
        };

    },

    down(state: Record<string, unknown>): Record<string, unknown> {

        // v1 is the baseline - can't downgrade further
        // Remove schemaVersion and return raw state
        const { schemaVersion: _schemaVersion, ...rest } = state;

        return rest;

    },
};
