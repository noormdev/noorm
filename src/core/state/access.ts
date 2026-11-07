/**
 * Resolve legacy config access at the untyped state boundary.
 *
 * Missing access is mapped from legacy `protected`; malformed explicit
 * access is an error. Substituting a built-in role is unsafe because project
 * settings can override that role's permissions.
 */
import { resolveLegacyAccess } from '../policy/index.js';
import type { ConfigAccess, Role } from '../policy/index.js';


function isRecord(value: unknown): value is Record<string, unknown> {

    return typeof value === 'object' && value !== null && !Array.isArray(value);

}

function isRole(value: unknown): value is Role {

    return typeof value === 'string' && value.trim().length > 0;

}

function isAgentAccess(value: unknown): value is Role | false {

    return value === false || isRole(value);

}

/**
 * Resolve access from untrusted state data, preserving custom role names.
 *
 * @throws Error when an explicitly stored access value is malformed.
 */
export function resolveStateConfigAccess(rawAccess: unknown, rawProtected: unknown): ConfigAccess {

    // Any truthy legacy value means the author asked for protection. Only
    // a strict `true` used to count, so `"true"` and `1` both resolved to
    // the unrestricted default — the opposite of what they say.
    const legacyProtected = Boolean(rawProtected);

    if (rawAccess === undefined) {

        return resolveLegacyAccess(undefined, legacyProtected);

    }

    if (!isRecord(rawAccess) || !isRole(rawAccess['user']) || !isAgentAccess(rawAccess['agent'])) {

        throw new Error('Invalid config access: user and agent must be nonempty role names (agent may be false)');

    }

    return { user: rawAccess['user'], agent: rawAccess['agent'] };

}
