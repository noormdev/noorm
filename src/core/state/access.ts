/**
 * Fail-closed repair of a config's access roles.
 *
 * Two places read `access` straight off untyped JSON — the v2 schema
 * migration and the load-time backfill in StateManager — and both used to
 * accept whatever they found. A truthy-but-invalid `access` such as `{}`
 * passed through verbatim and bricked the config (every later command
 * failed zod validation), while a truthy-but-non-boolean legacy
 * `protected` such as `"true"` fell through to the unrestricted default and
 * silently removed the protection it was asking for.
 *
 * The rule here is one-directional: an unrecognised shape may only make a
 * config more restrictive, never less.
 */
import { resolveLegacyAccess } from '../policy/index.js';
import type { ConfigAccess, Role } from '../policy/index.js';

const ROLES: readonly string[] = ['viewer', 'operator', 'admin'];

/** Least privilege for the user channel; the floor for an unreadable value. */
const MOST_RESTRICTIVE_ROLE: Role = 'viewer';

function isRecord(value: unknown): value is Record<string, unknown> {

    return typeof value === 'object' && value !== null;

}

function isRole(value: unknown): value is Role {

    return typeof value === 'string' && ROLES.includes(value);

}

/**
 * `agent: false` is not a role — it hides the config from agents entirely,
 * which is strictly more restrictive than any role. It must survive repair
 * untouched.
 */
function isAgentAccess(value: unknown): value is Role | false {

    return value === false || isRole(value);

}

/**
 * Resolve a config's access from raw, untrusted state data.
 *
 * @param rawAccess - the `access` value as found on disk, any shape
 * @param rawProtected - the legacy `protected` value, any shape
 *
 * @example
 * ```typescript
 * repairConfigAccess({ user: 'admin' }, undefined); // { user: 'admin', agent: 'viewer' }
 * repairConfigAccess(undefined, 'true');            // { user: 'operator', agent: 'viewer' }
 * ```
 */
export function repairConfigAccess(rawAccess: unknown, rawProtected: unknown): ConfigAccess {

    // Any truthy legacy value means the author asked for protection. Only
    // a strict `true` used to count, so `"true"` and `1` both resolved to
    // the unrestricted default — the opposite of what they say.
    const legacyProtected = Boolean(rawProtected);

    if (!isRecord(rawAccess)) {

        return resolveLegacyAccess(undefined, legacyProtected);

    }

    return {
        user: isRole(rawAccess['user']) ? rawAccess['user'] : MOST_RESTRICTIVE_ROLE,
        agent: isAgentAccess(rawAccess['agent']) ? rawAccess['agent'] : MOST_RESTRICTIVE_ROLE,
    };

}
