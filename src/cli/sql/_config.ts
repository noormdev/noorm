/**
 * Config resolution for the history-only `sql` subcommands.
 *
 * `sql history` and `sql clear` read and delete files under
 * `.noorm/state/history/<config>/`, so they need a config *name* but no
 * connection. They used to default to the literal string `'default'`, which
 * nothing in the product ever writes history under — the TUI SQL terminal
 * keys it by the active config — so both commands silently operated on a
 * file that did not exist, and `clear` reported success having erased
 * nothing.
 */
import { attempt } from '@logosdx/utils';

import { getEnvConfigName } from '../../core/environment.js';
import { initState, getStateManager } from '../../core/state/index.js';

/**
 * The config whose history a command should operate on.
 *
 * Precedence matches `resolveConfig`, so `sql history` and `sql query` always
 * agree on which config they are talking about: explicit flag, then
 * `NOORM_CONFIG`, then the active config. State is only decrypted for the
 * last of those — an explicit name needs no identity key, which keeps these
 * two connection-less commands usable without one.
 *
 * @returns The resolved name, or `null` when nothing is set (no active
 * config, or state could not be loaded).
 *
 * @example
 * const configName = await resolveHistoryConfigName(args.config, process.cwd());
 */
export async function resolveHistoryConfigName(explicit: string | undefined, projectRoot: string): Promise<string | null> {

    const named = explicit ?? getEnvConfigName();

    if (named) return named;

    const [, initErr] = await attempt(() => initState(projectRoot));

    if (initErr) return null;

    return getStateManager(projectRoot).getActiveConfigName();

}
