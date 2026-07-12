/**
 * Internal shared state between Context and NoormOps.
 *
 * Both classes reference the same mutable object. Context owns it
 * (creates in constructor, mutates in connect/disconnect). NoormOps
 * reads from it. This avoids duplicating fields or passing the full
 * Context instance to NoormOps.
 */
import type { ConnectionResult } from '../core/connection/index.js';
import type { Config } from '../core/config/types.js';
import type { Settings } from '../core/settings/index.js';
import type { Identity } from '../core/identity/index.js';
import type { ChangeManager } from '../core/change/index.js';

import { NotConnectedError } from './guards.js';
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
