/**
 * Database-lifecycle policy gate.
 *
 * `core/db` (create/drop) and `core/teardown` (truncate/teardown) are the
 * destructive lifecycle seams. Both are reached directly by the TUI and
 * indirectly — via the SDK — by the CLI, so gating per surface leaves cells
 * that nobody fills: `db create` shipped with the TUI enforcing `db:create`
 * and the CLI enforcing nothing at all. Gating here means a new surface
 * inherits the check instead of having to remember it.
 *
 * Distinct from `assertPolicy`, which resolves only the allow/deny half of
 * the matrix. Destructive lifecycle commands also have to honour the
 * `confirm` half: a `confirm` cell the caller has not pre-confirmed blocks,
 * mirroring `db drop`'s `check.requiresConfirmation && !args.yes` gate.
 */
import { checkConfigPolicy } from '../policy/index.js';
import type { Channel, ConfigAccess, Permission } from '../policy/index.js';

/**
 * What the lifecycle gate needs to resolve a permission.
 *
 * Carries `yes` because the confirmation half of the matrix can only be
 * satisfied by the caller — core has no prompt of its own.
 */
export interface DbPolicyContext {

    /** Config the permission is scoped to. */
    configName: string;

    /** Per-channel roles from the config. Absent access denies (fail closed). */
    access?: ConfigAccess;

    /** Caller channel — `user` for CLI/TUI/SDK, `mcp` for the MCP server. */
    channel?: Channel;

    /** Caller pre-confirmed the operation (CLI `--yes`, SDK `options.yes`). */
    yes?: boolean;

}

/**
 * Gate a destructive lifecycle operation against the config's access policy.
 *
 * `policy` is optional so callers that already ran an equivalent gate (the
 * SDK, which raises a typed `ProtectedConfigError` its consumers catch) are
 * not double-checked. Every caller that owns no gate of its own must pass
 * it — that is the whole point of the seam.
 *
 * `preview` skips the confirmation half only: a dry run still has to be
 * allowed by the role, but there is nothing to confirm because nothing is
 * destroyed. Denial is never skipped.
 *
 * @throws Error carrying the policy's blockedReason when the role denies,
 * or a confirmation message when the role requires a confirmation the
 * caller did not supply.
 *
 * @example
 * assertDbPolicy({ configName: 'prod', access, yes: args.yes }, 'db:teardown', 'tear down');
 */
export function assertDbPolicy(
    policy: DbPolicyContext | undefined,
    permission: Permission,
    operation: string,
    preview = false,
): void {

    if (!policy) return;

    const check = checkConfigPolicy(policy.channel ?? 'user', { name: policy.configName, access: policy.access }, permission);

    if (!check.allowed) {

        throw new Error(check.blockedReason ?? `"${permission}" is not allowed on config "${policy.configName}".`);

    }

    if (preview) return;

    if (check.requiresConfirmation && !policy.yes) {

        throw new Error(
            `Cannot ${operation} on config "${policy.configName}": this is a destructive operation requiring `
            + `confirmation (${check.confirmationPhrase}). Pass --yes to confirm, or set NOORM_YES=1 for scripted use.`,
        );

    }

}
