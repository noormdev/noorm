import type { BuiltinRole, Permission, PolicyCell } from './types.js';

/** Roles that resolve even when `settings.yml` defines none. */
export const BUILTIN_ROLES = ['viewer', 'operator', 'admin'] as const;

export function isBuiltinRole(name: string): name is BuiltinRole {

    return BUILTIN_ROLES.some((builtin) => builtin === name);

}

const CELL_RANK: Record<PolicyCell, number> = { deny: 0, confirm: 1, allow: 2 };

/** Negative when `a` is stricter than `b`, zero when equal, positive when looser. */
export function compareCells(a: PolicyCell, b: PolicyCell): number {

    return CELL_RANK[a] - CELL_RANK[b];

}

/** Immutable built-in defaults and protected-stage ceilings. */
export const MATRIX: Record<Permission, Record<BuiltinRole, PolicyCell>> = {
    'explore': { viewer: 'allow', operator: 'allow', admin: 'allow' },

    'sql:read': { viewer: 'allow', operator: 'allow', admin: 'allow' },
    'sql:write': { viewer: 'deny', operator: 'allow', admin: 'allow' },
    'sql:ddl': { viewer: 'deny', operator: 'deny', admin: 'allow' },

    'change:run': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'change:ff': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'change:revert': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'change:rm': { viewer: 'deny', operator: 'confirm', admin: 'confirm' },

    'run:build': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'run:file': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'run:dir': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'pipeline:run': { viewer: 'deny', operator: 'confirm', admin: 'allow' },

    'db:create': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'db:reset': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'db:destroy': { viewer: 'deny', operator: 'deny', admin: 'confirm' },
    'db:truncate': { viewer: 'deny', operator: 'confirm', admin: 'confirm' },
    'db:teardown': { viewer: 'deny', operator: 'deny', admin: 'confirm' },

    'config:rm': { viewer: 'deny', operator: 'confirm', admin: 'confirm' },
    // Rewrites `access` itself, so it is an escalation vector: confirm even for admin.
    'config:write': { viewer: 'deny', operator: 'confirm', admin: 'confirm' },

    'vault:read': { viewer: 'deny', operator: 'allow', admin: 'allow' },
    'vault:write': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    // Grants the vault key to every enrolled identity — a fan-out no one can undo.
    'vault:propagate': { viewer: 'deny', operator: 'confirm', admin: 'confirm' },

    'secret:read': { viewer: 'deny', operator: 'allow', admin: 'allow' },
    'secret:write': { viewer: 'deny', operator: 'confirm', admin: 'allow' },

    // Dry-run planning still reads destination schema and row estimates.
    'transfer:plan': { viewer: 'deny', operator: 'allow', admin: 'allow' },

    'lock:force': { viewer: 'deny', operator: 'confirm', admin: 'confirm' },

    'debug:read': { viewer: 'allow', operator: 'allow', admin: 'allow' },
    // Deletes arbitrary rows from noorm.vault / noorm.identities.
    'debug:write': { viewer: 'deny', operator: 'deny', admin: 'confirm' },
};

/** Permissions an `isTest` config allows outright, even where admin's cell is `confirm`: `docs/spec/config-access-roles.md`. */
export const TEST_DB_LIFECYCLE: readonly Permission[] = ['db:create', 'db:reset', 'db:truncate', 'db:teardown', 'db:destroy'];

/** Reads the user channel always holds: the keyboard owner can loosen any role, so gating them adds friction only. */
export const USER_ALWAYS_ALLOWED: readonly Permission[] = ['explore', 'sql:read'];
