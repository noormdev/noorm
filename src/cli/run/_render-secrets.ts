/**
 * Shared "resolve $.secrets for an offline render" helper for
 * `run preview` and `run inspect`.
 *
 * Both commands are documented as offline — they render a template
 * without executing it, and must keep working with no database
 * reachable. But the vault tier can only be read through a connection,
 * and a preview that shows different secrets than `run file`/`run build`
 * would actually apply is the same class of silent divergence CP6 exists
 * to remove.
 *
 * The probe below connects with retry/backoff disabled
 * (`ConnectionRetryOptions`, `src/core/connection/factory.ts`), so an
 * unreachable database degrades to the local tiers in well under a
 * second instead of the ~6-7s the default 3-attempt policy adds. When
 * the probe fails, `vaultProbeFailed` tells the caller to say so —
 * silently showing only local secrets recreates exactly the class of
 * bug this branch fixes.
 */
import { attempt } from '@logosdx/utils';

import { createContext } from '../../sdk/index.js';
import { resolveVaultKey, buildSecretsContext } from '../../core/vault/index.js';
import type { StateManager } from '../../core/state/index.js';
import type { NoormDatabase } from '../../core/shared/index.js';

/** One attempt, no wait — a best-effort probe must not inherit the
 *  connecting-command retry/backoff policy. */
const PROBE_RETRY_OPTIONS = { retries: 1, delay: 0 };

/** Shared wording so the text and `--json` shapes never drift apart. */
export const RENDER_SECRETS_NOTICE =
    'Vault-backed secrets were not resolved (no reachable database) — showing local-only secrets.';

export interface RenderSecretsResult {
    secrets: Record<string, string>;

    /**
     * True when a config was active but the vault tier could not be
     * reached (no connection, no vault access). False when there was no
     * config to probe against in the first place — nothing was skipped,
     * so there's nothing to disclose.
     */
    vaultProbeFailed: boolean;
}

/**
 * Resolve `$.secrets` through all three tiers for a preview/inspect
 * render, without blocking on an unreachable database.
 *
 * @example
 * ```typescript
 * const { secrets, vaultProbeFailed } = await resolveRenderSecrets(stateManager, 'prod');
 * ```
 */
export async function resolveRenderSecrets(
    stateManager: StateManager,
    configName: string | null | undefined,
): Promise<RenderSecretsResult> {

    if (!configName) return { secrets: {}, vaultProbeFailed: false };

    const [vault, connErr] = await attempt(() => createContext<NoormDatabase>({ config: configName }));

    if (connErr) {

        return { secrets: await buildSecretsContext(stateManager, configName), vaultProbeFailed: true };

    }

    const [, connectErr] = await attempt(() => vault.connect(PROBE_RETRY_OPTIONS));

    if (connectErr) {

        return { secrets: await buildSecretsContext(stateManager, configName), vaultProbeFailed: true };

    }

    const vaultKey = await resolveVaultKey(vault.kysely, vault.dialect);
    const secrets = await buildSecretsContext(stateManager, configName, vault.kysely, vaultKey, vault.dialect);

    await attempt(() => vault.disconnect());

    return { secrets, vaultProbeFailed: false };

}
