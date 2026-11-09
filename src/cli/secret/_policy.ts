/**
 * Config resolution and policy gating for the `secret` commands.
 *
 * Config-scoped secrets are written through `StateManager`, which takes no
 * config object and so cannot consult `access` itself. Until that seam
 * carries the gate, these commands resolve the config and check it here —
 * which is why the check lives in one helper rather than being re-typed in
 * three command files.
 */
import { checkConfigPolicy, resolveChannel } from '../../core/policy/index.js';
import type { Permission, PolicyCheck } from '../../core/policy/index.js';
import type { StateManager } from '../../core/state/index.js';
import { attempt, attemptSync } from '@logosdx/utils';
import { getSettingsManager } from '../../core/settings/index.js';
import { SettingsProvider, withConfigPolicy } from '../../core/config/resolver.js';

/**
 * Outcome of resolving the target config and checking it against a permission.
 */
export type SecretPolicyResolution =
    | { ok: true; configName: string; check: PolicyCheck }
    | { ok: false; error: string };

/**
 * Resolve the config a secret command targets, then gate it.
 *
 * Rejects an unknown config name rather than treating it as an empty secret
 * set: a typo used to return "no secrets" and exit 0, which reads as "this
 * config has none" instead of "there is no such config".
 *
 * @example
 * const resolved = resolveSecretPolicy(stateManager, args.config, 'secret:write');
 * if (!resolved.ok) { outputError(args, resolved.error); process.exit(1); }
 */
export async function resolveSecretPolicy(
    stateManager: StateManager,
    configName: string | undefined,
    permission: Permission,
    projectRoot: string,
): Promise<SecretPolicyResolution> {

    const name = configName ?? stateManager.getActiveConfigName();

    if (!name) {

        return {
            ok: false,
            error: 'No config specified and no active config set. Use --config or run "noorm config use <name>".',
        };

    }

    const config = stateManager.getConfig(name);

    if (!config) {

        return { ok: false, error: `Config "${name}" not found.` };

    }

    const settingsManager = getSettingsManager(projectRoot);
    const [, settingsErr] = await attempt(() => settingsManager.load());
    if (settingsErr) return { ok: false, error: `Failed to load settings: ${settingsErr.message}` };

    const [policyConfig, policyErr] = attemptSync(() =>
        withConfigPolicy(config, new SettingsProvider(settingsManager)),
    );
    if (policyErr) return { ok: false, error: policyErr.message };

    const check = checkConfigPolicy(resolveChannel(), policyConfig, permission);

    if (!check.allowed) {

        return {
            ok: false,
            error: check.blockedReason ?? `"${permission}" is not allowed on config "${name}".`,
        };

    }

    return { ok: true, configName: name, check };

}
