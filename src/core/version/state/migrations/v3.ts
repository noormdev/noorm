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
import { repairConfigAccess } from '../../../state/access.js';
import type { StateMigration } from '../../types.js';

function isRecord(value: unknown): value is Record<string, unknown> {

    return typeof value === 'object' && value !== null;

}

/**
 * Migration v3: rename the agent channel's access key.
 *
 * Only the key moves — `repairConfigAccess` then decides whether the value
 * is a shape it recognises, and downgrades to `viewer` if not. That keeps
 * the one-directional rule v2 established: an unreadable stored access may
 * only make a config more restrictive, never less.
 *
 * v2 already emits the post-rename shape (it shares `repairConfigAccess`),
 * so on a v1-or-older state this migration finds no `mcp` key and is a
 * no-op. It matters for state already sitting at v2.
 */
export const v3: StateMigration = {
    version: 3,
    description: 'Rename per-config access.mcp to access.agent',

    up(state: Record<string, unknown>): Record<string, unknown> {

        return mapConfigAccess(state, (access) => {

            if (!isRecord(access)) return repairConfigAccess(access, undefined);

            const { mcp, ...rest } = access;

            return repairConfigAccess({ ...rest, agent: rest['agent'] ?? mcp }, undefined);

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

        mapped[name] = { ...rawConfig, access: fn(rawConfig['access']) };

    }

    return {
        ...state,
        configs: mapped,
    };

}
