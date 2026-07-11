/**
 * State Migration v2 - Per-config access roles.
 *
 * Replaces each config's boolean `protected` flag with channel-scoped
 * access roles. For state schema documentation, see
 * docs/spec/config-access-roles.md#migration.
 */
import { resolveLegacyAccess } from '../../../policy/index.js';
import type { StateMigration } from '../../types.js';

function isRecord(value: unknown): value is Record<string, unknown> {

    return typeof value === 'object' && value !== null;

}

/**
 * Migration v2: per-config access roles.
 *
 * - `protected: true` -> `{ user: 'operator', mcp: 'viewer' }`
 * - `protected: false` or absent -> `{ user: 'admin', mcp: 'admin' }`
 *
 * The stored `protected` field is dropped — `access` becomes the sole
 * source of truth for a config's roles.
 */
export const v2: StateMigration = {
    version: 2,
    description: 'Map per-config protected boolean to access roles',

    up(state: Record<string, unknown>): Record<string, unknown> {

        const rawConfigs = state['configs'];
        const configs = isRecord(rawConfigs) ? rawConfigs : {};

        const migratedConfigs: Record<string, unknown> = {};

        for (const [name, rawConfig] of Object.entries(configs)) {

            if (!isRecord(rawConfig)) {

                migratedConfigs[name] = rawConfig;
                continue;

            }

            const { protected: legacyProtected, access, ...rest } = rawConfig;

            migratedConfigs[name] = {
                ...rest,
                access: access ?? resolveLegacyAccess(undefined, legacyProtected === true),
            };

        }

        return {
            ...state,
            configs: migratedConfigs,
        };

    },

    down(state: Record<string, unknown>): Record<string, unknown> {

        const rawConfigs = state['configs'];
        const configs = isRecord(rawConfigs) ? rawConfigs : {};

        const revertedConfigs: Record<string, unknown> = {};

        for (const [name, rawConfig] of Object.entries(configs)) {

            if (!isRecord(rawConfig)) {

                revertedConfigs[name] = rawConfig;
                continue;

            }

            const { access, ...rest } = rawConfig;
            const user = isRecord(access) ? access['user'] : undefined;

            revertedConfigs[name] = {
                ...rest,
                protected: user !== undefined && user !== 'admin',
            };

        }

        return {
            ...state,
            configs: revertedConfigs,
        };

    },
};
