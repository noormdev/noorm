/**
 * Legacy `protected` boolean -> access role mapping.
 *
 * `Config.protected: boolean` was replaced by per-channel `access` roles
 * (see docs/spec/config-access-roles.md#migration). Every place that still
 * accepts the legacy boolean as input — zod schema parsing, state
 * persistence, and the v2 state migration — resolves it through this one
 * helper so the mapping exists exactly once.
 */
import type { ConfigAccess } from './types.js';

/** Access for a config with no explicit role and no legacy `protected` flag. */
export const OPEN_ACCESS: ConfigAccess = { user: 'admin', mcp: 'admin' };

/** Access a legacy `protected: true` boolean maps to. */
export const GUARDED_ACCESS: ConfigAccess = { user: 'operator', mcp: 'viewer' };

/**
 * Resolves the access a config should have from its raw inputs.
 *
 * Explicit `access` always wins. Otherwise, a legacy `protected: true`
 * maps to the guarded role pair; `false` or absent maps to fully open.
 *
 * @example
 * resolveLegacyAccess(undefined, true); // { user: 'operator', mcp: 'viewer' }
 * resolveLegacyAccess(undefined, undefined); // { user: 'admin', mcp: 'admin' }
 */
export function resolveLegacyAccess(
    access: ConfigAccess | undefined,
    legacyProtected: boolean | undefined,
): ConfigAccess {

    return access ?? (legacyProtected === true ? GUARDED_ACCESS : OPEN_ACCESS);

}
