import type { Permission, PolicyCell, Role } from './types.js';

/**
 * The hard-coded permission × role matrix. Not user-extensible — see
 * `docs/spec/config-access-roles.md` for the source of truth this mirrors.
 */
export const MATRIX: Record<Permission, Record<Role, PolicyCell>> = {
    'explore': { viewer: 'allow', operator: 'allow', admin: 'allow' },

    'sql:read': { viewer: 'allow', operator: 'allow', admin: 'allow' },
    'sql:write': { viewer: 'deny', operator: 'allow', admin: 'allow' },
    'sql:ddl': { viewer: 'deny', operator: 'deny', admin: 'allow' },

    'change:run': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'change:ff': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'change:revert': { viewer: 'deny', operator: 'confirm', admin: 'allow' },

    'run:build': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'run:file': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'run:dir': { viewer: 'deny', operator: 'confirm', admin: 'allow' },

    'db:create': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'db:reset': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'db:destroy': { viewer: 'deny', operator: 'deny', admin: 'confirm' },

    'config:rm': { viewer: 'deny', operator: 'confirm', admin: 'confirm' },
};
