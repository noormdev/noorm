import type { ConfigAccess, Role } from './types.js';

/** Protected stages allow no more than operator access for users and viewer for agents. */
export const PROTECTED_STAGE_CEILING: ConfigAccess = { user: 'operator', agent: 'viewer' };

/** Invisible is stricter than viewer, operator, then admin. */
function roleRank(role: Role | false): number {

    if (role === false) return 0;
    if (role === 'viewer') return 1;
    if (role === 'operator') return 2;

    return 3;

}

/** Cap each channel's access without loosening an already stricter role. */
export function clampToCeiling(access: ConfigAccess, ceiling: ConfigAccess): ConfigAccess {

    return {
        user: roleRank(access.user) <= roleRank(ceiling.user) ? access.user : ceiling.user,
        agent: roleRank(access.agent) <= roleRank(ceiling.agent) ? access.agent : ceiling.agent,
    };

}
