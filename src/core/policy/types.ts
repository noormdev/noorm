import type { BUILTIN_ROLES } from './matrix.js';

/**
 * Access policy data model.
 *
 * Roles live on the config, not the actor — the actor is a channel (who is
 * asking), and each config declares what each channel is allowed to do.
 */

/**
 * A config-scoped access level. Ordered loosest to strictest in practice:
 * `viewer` reads only, `operator` writes and confirms destructive ops,
 * `admin` is frictionless.
 */
export type BuiltinRole = (typeof BUILTIN_ROLES)[number];
export type Role = string;

export interface RoleDefinition {
    extends?: string;
    permissions?: Partial<Record<Permission, PolicyCell>>;
}

export interface PolicyContext {
    roles?: Record<string, RoleDefinition>;
    protectedStage?: boolean;
    /** Trusted `isTest` (see `docs/spec/config-access-roles.md`); relaxes `db:*` lifecycle cells. */
    isTest?: boolean;
    /** Credential-free project and connection target the bound `isTest` was granted for. */
    testTargetIdentity?: string;
    /** Hashed project and resolved connection identity, never credentials in plaintext. */
    targetIdentity?: string;
}

/**
 * Who is *driving* — a human at the keyboard is `user`, an AI agent is
 * `agent`, whichever binary it reached for. Deliberately not "which
 * transport was used": an agent that shells out to the CLI after an MCP
 * refusal is still an agent. Resolved from provenance by `resolveChannel`.
 * Not an identity system; there are no user accounts.
 */
export type Channel = 'user' | 'agent';

/**
 * Per-channel access for a config. `agent: false` means the config is
 * invisible to agents on *both* transports — not a role, and never consulted
 * by `checkPolicy` (visibility is enforced upstream of policy).
 */
export interface ConfigAccess {
    user: Role;
    agent: Role | false;
}

/**
 * Actions gated by the policy matrix. `sql:read`/`sql:write`/`sql:ddl` are
 * assigned to raw SQL after classification, not chosen by the caller.
 */
export type Permission =
    | 'explore'
    | 'sql:read' | 'sql:write' | 'sql:ddl'
    | 'change:run' | 'change:ff' | 'change:revert' | 'change:rm'
    | 'run:build' | 'run:file' | 'run:dir' | 'pipeline:run'
    | 'db:create' | 'db:reset' | 'db:destroy' | 'db:truncate' | 'db:teardown'
    | 'config:rm' | 'config:write'
    | 'vault:read' | 'vault:write' | 'vault:propagate'
    | 'secret:read' | 'secret:write'
    | 'transfer:plan'
    | 'lock:force'
    | 'debug:read' | 'debug:write';

/**
 * The minimum shape `checkPolicy` and `guarded` need from a config.
 * `Config` satisfies this structurally once it gains `access`.
 */
export interface PolicyTarget {
    name: string;
    access: ConfigAccess;
}

/**
 * Raw matrix cell before channel resolution: `allow` always allows,
 * `deny` always blocks, `confirm` resolves per-channel in `checkPolicy`.
 */
export type PolicyCell = 'allow' | 'confirm' | 'deny';

/**
 * Result of a policy check. Same shape as the old `ProtectionCheck` so
 * confirm-dialog plumbing (SmartConfirm/ProtectedConfirm) carries over.
 */
export interface PolicyCheck {
    /** Whether the action is allowed to proceed. */
    allowed: boolean;

    /** Whether the user must confirm before proceeding. */
    requiresConfirmation: boolean;

    /** The phrase the user must type to confirm (e.g. "yes-production"). */
    confirmationPhrase?: string;

    /** Reason the action is blocked, when `allowed` is false. */
    blockedReason?: string;
}
