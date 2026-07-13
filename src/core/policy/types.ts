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
export type Role = 'viewer' | 'operator' | 'admin';

/**
 * Who is asking — CLI/TUI/SDK callers are `user`, the MCP server is `mcp`.
 * Not an identity system; there are no user accounts.
 */
export type Channel = 'user' | 'mcp';

/**
 * Per-channel access for a config. `mcp: false` means the config is
 * invisible on the MCP channel — not a role, and never consulted by
 * `checkPolicy` (visibility is enforced upstream of policy).
 */
export interface ConfigAccess {
    user: Role;
    mcp: Role | false;
}

/**
 * Actions gated by the policy matrix. `sql:read`/`sql:write`/`sql:ddl` are
 * assigned to raw SQL after classification, not chosen by the caller.
 */
export type Permission =
    | 'explore'
    | 'sql:read' | 'sql:write' | 'sql:ddl'
    | 'change:run' | 'change:ff' | 'change:revert' | 'change:rm'
    | 'run:build' | 'run:file' | 'run:dir'
    | 'db:create' | 'db:reset' | 'db:destroy'
    | 'config:rm';

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
