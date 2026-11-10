import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { shouldSkipConfirmations } from '../environment.js';
import { DEFAULT_ACCESS } from './legacy-access.js';
import { compareCells, isBuiltinRole, MATRIX, TEST_DB_LIFECYCLE, USER_ALWAYS_ALLOWED } from './matrix.js';
import type { Channel, ConfigAccess, Permission, PolicyCell, PolicyCheck, PolicyContext, PolicyTarget } from './types.js';

const POLICY_CONTEXT = Symbol('noorm.policyContext');
type ContextualAccess = ConfigAccess & { [POLICY_CONTEXT]?: PolicyContext };
type ConfigTarget = { name: string; access?: ConfigAccess };
const approvals = new AsyncLocalStorage<readonly { fingerprint: string; permissions: readonly Permission[] }[]>();

/** Attach project-specific policy without persisting it in config exports or state. */
export function attachPolicyContext(access: ConfigAccess, context: PolicyContext): void {

    Object.defineProperty(access, POLICY_CONTEXT, { value: context, configurable: true });

}

/** Read the policy bound during configuration resolution. */
export function getPolicyContext(access: ConfigAccess): PolicyContext | undefined {

    return (access as ContextualAccess)[POLICY_CONTEXT];

}

/** Bind approvals to a project and connection without exposing credentials. */
export function policyTargetIdentity(projectRoot: string, connection: unknown): string {

    return createHash('sha256').update(JSON.stringify([resolve(projectRoot), connection])).digest('hex');

}

function effectiveCell(role: string, permission: Permission, context: PolicyContext, seen = new Set<string>()): PolicyCell {

    if (seen.has(role)) return 'deny';
    seen.add(role);
    const definition = context.roles && Object.hasOwn(context.roles, role) ? context.roles[role] : undefined;
    const explicit = definition?.permissions?.[permission];
    if (explicit === 'allow' || explicit === 'confirm' || explicit === 'deny') return explicit;
    if (explicit !== undefined) return 'deny';
    if (isBuiltinRole(role)) return MATRIX[permission]?.[role] ?? 'deny';
    if (!definition) return 'deny';

    return definition.extends ? effectiveCell(definition.extends, permission, context, seen) : 'deny';

}

/** Effective cell with the protected-stage ceiling. On an isTest config a role reads at least admin's cell, past the ceiling. */
export function getConfigPermission(channel: Channel, config: ConfigTarget, permission: Permission): PolicyCell {

    if (channel === 'user' && USER_ALWAYS_ALLOWED.includes(permission)) return 'allow';

    const access = config.access as ContextualAccess | undefined;
    const role = access?.[channel];
    if (!access || !role || !Object.hasOwn(MATRIX, permission)) return 'deny';
    const context = access[POLICY_CONTEXT];
    if (!context) return 'deny';
    const roleResolves = isBuiltinRole(role) || (context.roles !== undefined && Object.hasOwn(context.roles, role));
    const cell = effectiveCell(role, permission, context);
    if (context.isTest === true && roleResolves) {

        if (TEST_DB_LIFECYCLE.includes(permission)) return 'allow';
        const admin = effectiveCell('admin', permission, context);

        return compareCells(cell, admin) >= 0 ? cell : admin;

    }
    if (!context.protectedStage) return cell;
    const ceiling = MATRIX[permission][channel === 'user' ? 'operator' : 'viewer'];

    return compareCells(cell, ceiling) <= 0 ? cell : ceiling;

}

/** Fingerprint the effective assignments and cells, not object insertion order. */
export function getPolicyFingerprint(config: ConfigTarget): string {

    const permissions = Object.keys(MATRIX).sort() as Permission[];
    const policy = permissions.map((permission) => [
        permission,
        getConfigPermission('user', config, permission),
        getConfigPermission('agent', config, permission),
    ]);

    return createHash('sha256').update(JSON.stringify([
        config.name, config.access?.user, config.access?.agent,
        (config.access as ContextualAccess | undefined)?.[POLICY_CONTEXT]?.protectedStage === true,
        (config.access as ContextualAccess | undefined)?.[POLICY_CONTEXT]?.targetIdentity,
        policy,
    ])).digest('hex');

}

/** Internal grant, intended only for callers that have independently validated consent. */
export function withPolicyConfirmation<T>(config: ConfigTarget, permissions: readonly Permission[], action: () => Promise<T>): Promise<T> {

    return approvals.run([...(approvals.getStore() ?? []), { fingerprint: getPolicyFingerprint(config), permissions: [...permissions] }], action);

}

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
 * The `user` channel always reads `USER_ALWAYS_ALLOWED` permissions as `allow`;
 * every other cell comes from the role, capped by the protected-stage ceiling.
 * `confirm` also differs per channel: the `user` channel prompts for
 * `yes-<config>` (skippable via `NOORM_YES`), while `agent` is denied unless an
 * independently validated human approval grants the exact permission.
 *
 * `agent: false` (invisible config) is never a role and is not expected to
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

    const cell = getConfigPermission(channel, target, permission);

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

    const approval = approvals.getStore();
    const fingerprint = approval ? getPolicyFingerprint(target) : null;
    if (approval?.some((grant) => grant.permissions.includes(permission) && grant.fingerprint === fingerprint)) {

        return { allowed: true, requiresConfirmation: false };

    }

    if (channel === 'agent') {

        return {
            allowed: false,
            requiresConfirmation: false,
            blockedReason: `"${permission}" on config "${target.name}" requires confirmation from a human.`,
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
 * const check = checkConfigPolicy('agent', ctx.noorm.config, 'sql:write');
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
 * Whether a config is visible on a channel — the agent-channel invisibility
 * rule.
 *
 * Fails closed: missing `access` is treated the same as `access.agent ===
 * false`. The `user` channel is always visible; only `agent` can be hidden.
 *
 * @example
 * isVisibleToChannel(config.access, 'agent'); // false when access.agent === false or access is missing
 */
export function isVisibleToChannel(access: ConfigAccess | undefined, channel: Channel): boolean {

    return !(channel === 'agent' && (!access || access.agent === false));

}

/**
 * Display-only shorthand for "this config isn't wide open" — used by TUI
 * styling, `config list`, and settings rule matching. Never an enforcement
 * input; `checkPolicy` is the only gate.
 *
 * @example
 * guarded({ name: 'prod', access: { user: 'operator', agent: 'viewer' } }); // true
 */
export function guarded(target: PolicyTarget): boolean {

    const context = getPolicyContext(target.access);
    if (target.access.user !== 'admin' || context?.protectedStage) return true;
    if (!context) return false;

    return (Object.keys(MATRIX) as Permission[]).some((permission) => {

        return compareCells(getConfigPermission('user', target, permission), MATRIX[permission].admin) < 0;

    });

}

/**
 * Formats access as `user:<role> agent:<role|off>` — the shared display
 * string for `noorm config list` and the TUI config list screen, so the
 * format can't drift between the two. Omitted entirely (`null`) only for
 * configs sitting on `DEFAULT_ACCESS`, so the tag means "someone changed
 * this" in either direction.
 *
 * Keyed to the default rather than `guarded()` because the default is no
 * longer the loosest setting: `agent: 'admin'` is now an opt-in escalation,
 * and `guarded()` (which only reads the user channel) would render the one
 * config an agent can write to as unremarkable.
 *
 * @example
 * formatAccessTag({ name: 'prod', access: { user: 'operator', agent: false } }); // 'user:operator agent:off'
 */
export function formatAccessTag(config: { name: string; access: ConfigAccess }): string | null {

    const { access } = config;

    if (access.user === DEFAULT_ACCESS.user && access.agent === DEFAULT_ACCESS.agent) return null;

    return `user:${access.user} agent:${access.agent === false ? 'off' : access.agent}`;

}
