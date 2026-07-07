import { shouldSkipConfirmations } from '../environment.js';
import { MATRIX } from './matrix.js';
import type { Channel, Permission, PolicyCheck, PolicyTarget } from './types.js';

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
        confirmationPhrase: `yes-${target.name}`,
    };

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
