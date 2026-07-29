/**
 * The access a config gets when its author did not choose one.
 *
 * `Config.protected: boolean` was replaced by per-channel `access` roles
 * (see docs/spec/config-access-roles.md#migration). Every place that still
 * accepts the legacy boolean as input — zod schema parsing, state
 * persistence, and the v2 state migration — resolves it through this one
 * helper so the mapping exists exactly once.
 */
import type { ConfigAccess } from './types.js';

/**
 * Access for a config with no explicit role and no legacy `protected` flag.
 *
 * The agent channel is deliberately *not* admin here. A stock project never
 * writes `access`, so this is what an MCP client holds against essentially
 * every config in the wild — granting it admin made the rest of the matrix
 * decorative on that channel. `viewer` keeps the agent's real job (schema
 * exploration and read queries) working while write, DDL, destructive, and
 * credential permissions all require an explicit opt-in.
 *
 * Not `mcp: false`: invisibility reports the same error as an unknown
 * config, so an operator whose agent stopped working would have no way to
 * tell a restricted default from a typo.
 */
export const DEFAULT_ACCESS: ConfigAccess = { user: 'admin', mcp: 'viewer' };

/** Access a legacy `protected: true` boolean maps to. */
export const GUARDED_ACCESS: ConfigAccess = { user: 'operator', mcp: 'viewer' };

/**
 * Resolves the access a config should have from its raw inputs.
 *
 * Explicit `access` always wins. Otherwise, a legacy `protected: true`
 * maps to the guarded role pair; `false` or absent means the author asked
 * for no restriction, which is the default — not a grant of agent admin.
 *
 * @example
 * resolveLegacyAccess(undefined, true); // { user: 'operator', mcp: 'viewer' }
 * resolveLegacyAccess(undefined, undefined); // { user: 'admin', mcp: 'viewer' }
 */
export function resolveLegacyAccess(
    access: ConfigAccess | undefined,
    legacyProtected: boolean | undefined,
): ConfigAccess {

    return access ?? (legacyProtected === true ? GUARDED_ACCESS : DEFAULT_ACCESS);

}
