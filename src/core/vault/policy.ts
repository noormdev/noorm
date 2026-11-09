/**
 * Vault policy gate.
 *
 * The vault stores the team's shared secrets, so every operation against it
 * is a config-scoped action and belongs behind the same `access` matrix that
 * gates runs, changes and raw SQL. Gating here — in core — rather than in
 * each CLI command means the SDK, TUI and any future surface inherit the
 * check by calling the `*Checked` entrypoints instead of re-deriving it.
 */
import { checkConfigPolicy } from '../policy/index.js';
import type { Channel, ConfigAccess, Permission, PolicyCheck } from '../policy/index.js';

/**
 * Policy inputs a vault operation is checked against.
 *
 * Mirrors `SqlPolicyGate`: the config the operation targets plus the channel
 * asking. `access` is optional only so a caller holding raw/partial config
 * JSON can pass what it has — `checkConfigPolicy` fails closed when it's
 * missing, so an absent `access` denies rather than waves through.
 */
export interface VaultPolicyGate {
    /** Name of the config the vault belongs to, for the denial message. */
    configName: string;

    /** The config's access declaration. Absent denies. */
    access?: ConfigAccess;

    /** Who is asking — CLI/TUI/SDK are `user`, an AI agent is `agent` (MCP or CLI). */
    channel: Channel;
}

/**
 * Resolve a vault permission against a gate without throwing.
 *
 * Callers that must distinguish "denied" from "allowed but needs the user to
 * confirm" (every CLI command, since `vault:write` and `vault:propagate` are
 * `confirm` cells for `operator`) use this; callers that only need the
 * fail-closed throw use `assertVaultPolicy`.
 *
 * @example
 * const check = checkVaultPolicy(gate, 'vault:write');
 * if (!check.allowed) return { success: false, error: check.blockedReason };
 * if (check.requiresConfirmation && !isYesMode(args)) return needsConfirm();
 */
export function checkVaultPolicy(gate: VaultPolicyGate, permission: Permission): PolicyCheck {

    return checkConfigPolicy(gate.channel, { name: gate.configName, access: gate.access }, permission);

}

/**
 * Throw unless the gate permits the vault permission.
 *
 * Refuse both denial and unconfirmed access. Callers that collect consent
 * must supply it via a scoped policy confirmation before entering core.
 *
 * @throws Error when the permission is denied or confirmation is missing.
 *
 * @example
 * assertVaultPolicy({ configName: 'prod', access: config.access, channel: 'user' }, 'vault:write');
 */
export function assertVaultPolicy(gate: VaultPolicyGate, permission: Permission): void {

    const check = checkVaultPolicy(gate, permission);
    if (!check.allowed) {

        throw new Error(check.blockedReason ?? `"${permission}" is not allowed on config "${gate.configName}".`);

    }
    if (check.requiresConfirmation) {

        throw new Error(`"${permission}" on config "${gate.configName}" requires confirmation (${check.confirmationPhrase}).`);

    }

}
