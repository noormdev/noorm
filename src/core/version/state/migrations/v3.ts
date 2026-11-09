/**
 * State Migration v3 - `access.mcp` renamed to `access.agent`.
 *
 * The channel stopped describing which binary was invoked and started
 * describing who is driving, so the stored field follows. Values carry over
 * verbatim: an explicit `mcp: 'operator'` becomes `agent: 'operator'`, and
 * `mcp: false` becomes `agent: false` — the rename does not change what any
 * config grants, only who the grant now also covers (an agent shelling out
 * to the CLI, which previously ran as the human).
 */
import { attemptSync } from '@logosdx/utils';

import { resolveStateConfigAccess } from '../../../state/access.js';
import type { StateMigration } from '../../types.js';

function isRecord(value: unknown): value is Record<string, unknown> {

    return typeof value === 'object' && value !== null;

}

/**
 * Migration v3: rename the agent channel's access key.
 *
 * The renamed value is preserved, including custom roles and `false`.
 * Explicit malformed values are preserved for config-specific recovery.
 */
export const v3: StateMigration = {
    version: 3,
    description: 'Rename per-config access.mcp to access.agent',

    up(state: Record<string, unknown>): Record<string, unknown> {

        return mapConfigAccess(state, (access) => {

            if (!isRecord(access)) return resolveStateConfigAccess(access, undefined);

            const { mcp, ...rest } = access;

            return resolveStateConfigAccess({ ...rest, agent: Object.hasOwn(rest, 'agent') ? rest['agent'] : mcp }, undefined);

        });

    },

    down(state: Record<string, unknown>): Record<string, unknown> {

        return mapConfigAccess(state, (access) => {

            if (!isRecord(access)) return access;

            const { agent, ...rest } = access;

            return { ...rest, mcp: agent };

        });

    },
};

/**
 * Applies `fn` to every config's `access`, leaving non-object configs and a
 * missing `configs` map alone. Extracted because `up` and `down` differ only
 * in the per-config transform.
 */
function mapConfigAccess(
    state: Record<string, unknown>,
    fn: (access: unknown) => unknown,
): Record<string, unknown> {

    const rawConfigs = state['configs'];
    const configs = isRecord(rawConfigs) ? rawConfigs : {};

    const mapped: Record<string, unknown> = {};

    for (const [name, rawConfig] of Object.entries(configs)) {

        if (!isRecord(rawConfig)) {

            mapped[name] = rawConfig;
            continue;

        }

        if (!Object.hasOwn(rawConfig, 'access')) {

            mapped[name] = rawConfig;
            continue;

        }

        const [mappedAccess, mapErr] = attemptSync(() => fn(rawConfig['access']));
        mapped[name] = mapErr ? rawConfig : { ...rawConfig, access: mappedAccess };

    }

    return {
        ...state,
        configs: mapped,
    };

}
