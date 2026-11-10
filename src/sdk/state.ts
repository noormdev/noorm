/**
 * Internal shared state between Context and NoormOps.
 *
 * Both classes reference the same mutable object. Context owns it
 * (creates in constructor, mutates in connect/disconnect). NoormOps
 * reads from it. This avoids duplicating fields or passing the full
 * Context instance to NoormOps.
 */
import path from 'node:path';

import type { Kysely } from 'kysely';

import type { ConnectionResult } from '../core/connection/index.js';
import type { NoormDatabase } from '../core/shared/index.js';
import { prepareTrackingSchema } from '../core/version/index.js';
import type { Config } from '../core/config/types.js';
import type { Settings } from '../core/settings/index.js';
import { DEFAULT_SQL_PATH } from '../core/settings/defaults.js';
import type { Identity } from '../core/identity/index.js';
import type { ChangeManager } from '../core/change/index.js';
import type { StateManager } from '../core/state/index.js';
import type { ExploreGate } from '../core/explore/index.js';

import { NotConnectedError, checkProtectedConfig } from './guards.js';
import type { CreateContextOptions } from './types.js';

// ─────────────────────────────────────────────────────────────
// ContextState
// ─────────────────────────────────────────────────────────────

export interface ContextState {
    connection: ConnectionResult | null;
    config: Config;
    settings: Settings;
    identity: Identity;
    options: CreateContextOptions;
    projectRoot: string;
    stateManager: StateManager;
    changeManager: ChangeManager | null;
}

// ─────────────────────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────────────────────

/**
 * Require a live connection, collapsing the 8 duplicated
 * `if (!state.connection) throw ...` sites across the namespaces into one
 * helper. Covers both call shapes: namespaces that only need `.db`, and
 * `ChangesNamespace#createChangeContext`, which also needs `.dialect`.
 *
 * @throws NotConnectedError if state.connection is null
 */
export function requireConnection(state: ContextState): ConnectionResult {

    if (!state.connection) {

        throw new NotConnectedError();

    }

    return state.connection;

}

/**
 * Create or upgrade noorm's tracking tables before an operation that records to them.
 *
 * A build creates a database from nothing, which includes a database noorm has never
 * touched. Dry runs and previews leave the database as they found it, and so does a
 * role that cannot record: for those the tables are only checked.
 *
 * @example
 * await ensureTracking(this.#state, options);
 */
export async function ensureTracking(state: ContextState, options?: { dryRun?: boolean; preview?: boolean }): Promise<void> {

    const connection = requireConnection(state);

    // createConnection types its handle as Kysely<unknown>; the tracking tables are noorm's own schema.
    await prepareTrackingSchema(connection.db as Kysely<NoormDatabase>, connection.dialect, {
        channel: state.options.channel ?? 'user',
        config: state.config,
        dryRun: options?.dryRun || options?.preview,
    });

}

/**
 * The directory a build reads; `run.build()` and the check `db.reset()` makes before teardown share it.
 *
 * @example
 * const files = await discoverFiles(schemaPath(this.#state));
 */
export function schemaPath(state: ContextState): string {

    return path.join(state.projectRoot, state.settings.paths?.sql ?? DEFAULT_SQL_PATH);

}

/**
 * Runs a core explore read behind the `explore` check, throwing `ProtectedConfigError`.
 *
 * @example
 * ```typescript
 * const tables = await runGatedExplore(state, 'explore tables', (gate) => fetchList(db, dialect, 'tables', { gate }))
 * ```
 */
export async function runGatedExplore<T>(
    state: ContextState,
    operation: string,
    run: (gate: ExploreGate) => Promise<T>,
): Promise<T> {

    const { config, options } = state;
    const gate: ExploreGate = { configName: config.name, access: config.access, channel: options.channel ?? 'user' };

    checkProtectedConfig(config, options, 'explore', operation);

    return run(gate);

}
