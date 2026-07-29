import { shouldSkipConfirmations } from '../environment.js';
import { DEFAULT_ACCESS } from './legacy-access.js';
import { MATRIX } from './matrix.js';
import type { Channel, ConfigAccess, Permission, PolicyCheck, PolicyTarget } from './types.js';

/**
 * The type-to-confirm phrase for a config — the single source every
 * `confirm`-cell resolution and TUI confirmation dialog derives from, so the
 * format can't drift between `checkPolicy` and its callers.
 *
 * @example
 * confirmationPhraseFor('prod'); // 'yes-prod'
 */
export function confirmationPhraseFor(name: string): string {

    return `yes-${name}`;

}

/**
 * Resolve whether a channel may exercise a permission against a config.
 *
 * The matrix cell is channel-agnostic (`allow`/`confirm`/`deny`); only
 * `confirm` resolves differently per channel: the `user` channel prompts for
 * `yes-<config>` (skippable via `NOORM_YES`), while `mcp` collapses confirm
 * to deny — there's no human on the other end of stdio to type a phrase, and
 * an agent confirming its own destructive action is theater.
 *
 * `mcp: false` (invisible config) is never a role and is not expected to
 * reach this function — visibility is enforced upstream. If it does, this
 * fails closed rather than crashing.
 *
 * @example
 * const check = checkPolicy('user', config, 'db:destroy');
 * if (!check.allowed) throw new Error(check.blockedReason);
 * if (check.requiresConfirmation) await promptFor(check.confirmationPhrase);
 */
export function checkPolicy(channel: Channel, target: PolicyTarget, permission: Permission): PolicyCheck {

    const role = target.access[channel];

    if (role === false) {

        return {
            allowed: false,
            requiresConfirmation: false,
            blockedReason: `Config "${target.name}" is not accessible on the ${channel} channel.`,
        };

    }

    const cell = MATRIX[permission][role];

    if (cell === 'allow') {

        return { allowed: true, requiresConfirmation: false };

    }

    if (cell === 'deny') {

        return {
            allowed: false,
            requiresConfirmation: false,
            blockedReason: `"${permission}" is not allowed on config "${target.name}" (role: ${role}).`,
        };

    }

    if (channel === 'mcp') {

        return {
            allowed: false,
            requiresConfirmation: false,
            blockedReason: `"${permission}" on config "${target.name}" requires confirmation — use the CLI.`,
        };

    }

    if (shouldSkipConfirmations()) {

        return { allowed: true, requiresConfirmation: false };

    }

    return {
        allowed: true,
        requiresConfirmation: true,
        confirmationPhrase: confirmationPhraseFor(target.name),
    };

}

/**
 * Runs `checkPolicy` against a config that may not carry `access` — the
 * single fail-closed wrapper every caller reaches for when the value in
 * hand isn't a validated `Config` (e.g. raw JSON, a test double). `Config`
 * itself requires `access` (docs/spec/config-access-roles.md#data-model).
 * Absent access denies on both channels with the same message, rather than
 * each caller hand-rolling its own "no access configuration" branch. In
 * practice this never triggers for a real `Config`: every one reaching
 * enforcement came through `parseConfig`/state load, which always
 * populates `access`.
 *
 * @example
 * const check = checkConfigPolicy('mcp', ctx.noorm.config, 'sql:write');
 * if (!check.allowed) throw new RpcError(check.blockedReason ?? 'denied');
 */
export function checkConfigPolicy(
    channel: Channel,
    config: { name: string; access?: ConfigAccess },
    permission: Permission,
): PolicyCheck {

    if (!config.access) {

        return {
            allowed: false,
            requiresConfirmation: false,
            blockedReason: `Config "${config.name}" has no access configuration.`,
        };

    }

    return checkPolicy(channel, { name: config.name, access: config.access }, permission);

}

/**
 * Runs `checkConfigPolicy` and throws when denied — the single fail-closed
 * gate every command entrypoint (`runBuild`/`runFile`/`runDir`, `executeChange`/
 * `revertChange`, `executeRawSql`) reaches for instead of hand-rolling its own
 * check-then-throw with a duplicated fallback message. Callers that need a
 * tuple instead of a throw (e.g. `transferData`) wrap this in `attemptSync`.
 *
 * @throws Error carrying the policy's blockedReason when the channel's role
 * denies the permission.
 *
 * @example
 * assertPolicy(context.channel, { name: context.configName, access: context.access }, 'run:build');
 */
export function assertPolicy(
    channel: Channel,
    target: { name: string; access?: ConfigAccess },
    permission: Permission,
): void {

    const check = checkConfigPolicy(channel, target, permission);

    if (!check.allowed) {

        throw new Error(check.blockedReason ?? `"${permission}" is not allowed on config "${target.name}".`);

    }

}

/**
 * Whether a config is visible on a channel — the mcp-channel invisibility
 * rule, extracted so `list_configs` and `session.ts`'s `connect()` share one
 * fail-closed implementation instead of two independently drifting copies.
 *
 * Fails closed: missing `access` is treated the same as `access.mcp ===
 * false`. The `user` channel is always visible; only `mcp` can be hidden.
 *
 * @example
 * isVisibleToChannel(config.access, 'mcp'); // false when access.mcp === false or access is missing
 */
export function isVisibleToChannel(access: ConfigAccess | undefined, channel: Channel): boolean {

    return !(channel === 'mcp' && (!access || access.mcp === false));

}

/**
 * Display-only shorthand for "this config isn't wide open" — used by TUI
 * styling, `config list`, and settings rule matching. Never an enforcement
 * input; `checkPolicy` is the only gate.
 *
 * @example
 * guarded({ name: 'prod', access: { user: 'operator', mcp: 'viewer' } }); // true
 */
export function guarded(target: PolicyTarget): boolean {

    return target.access.user !== 'admin';

}

/**
 * Formats access as `user:<role> mcp:<role|off>` — the shared display
 * string for `noorm config list` and the TUI config list screen, so the
 * format can't drift between the two. Omitted entirely (`null`) only for
 * configs sitting on `DEFAULT_ACCESS`, so the tag means "someone changed
 * this" in either direction.
 *
 * Keyed to the default rather than `guarded()` because the default is no
 * longer the loosest setting: `mcp: 'admin'` is now an opt-in escalation,
 * and `guarded()` (which only reads the user channel) would render the one
 * config an agent can write to as unremarkable.
 *
 * @example
 * formatAccessTag({ name: 'prod', access: { user: 'operator', mcp: false } }); // 'user:operator mcp:off'
 */
export function formatAccessTag(config: { name: string; access: ConfigAccess }): string | null {

    const { access } = config;

    if (access.user === DEFAULT_ACCESS.user && access.mcp === DEFAULT_ACCESS.mcp) return null;

    return `user:${access.user} mcp:${access.mcp === false ? 'off' : access.mcp}`;

}
