/**
 * NoormOps — thin shell with lazy namespace getters.
 *
 * Each domain lives in its own namespace class under src/sdk/namespaces/.
 * NoormOps instantiates them lazily and wires cross-namespace dependencies
 * (e.g., db.reset needs run.build).
 */
import type { Config } from '../core/config/types.js';
import type { Settings } from '../core/settings/index.js';
import type { Identity } from '../core/identity/index.js';

import type { ContextState } from './state.js';
import {
    ChangesNamespace,
    RunNamespace,
    DbNamespace,
    LockNamespace,
    VaultNamespace,
    SecretsNamespace,
    TemplatesNamespace,
    TransferNamespace,
    DtNamespace,
    UtilsNamespace,
} from './namespaces/index.js';

// ─────────────────────────────────────────────────────────────
// NoormOps Class
// ─────────────────────────────────────────────────────────────

/**
 * Noorm-specific operations accessed via ctx.noorm.
 *
 * Domain-aligned sub-namespaces mirror the TUI home screen:
 * changes, run, db, lock, vault, secrets, templates, transfer, dt, utils.
 *
 * @example
 * ```typescript
 * const ctx = await createContext({ config: 'dev' })
 * await ctx.connect()
 *
 * await ctx.noorm.run.build()
 * await ctx.noorm.changes.ff()
 * const tables = await ctx.noorm.db.listTables()
 * ```
 */
export class NoormOps {

    #state: ContextState;

    // Lazy namespace instances
    #changes: ChangesNamespace | null = null;
    #run: RunNamespace | null = null;
    #db: DbNamespace | null = null;
    #lock: LockNamespace | null = null;
    #vault: VaultNamespace | null = null;
    #secrets: SecretsNamespace | null = null;
    #templates: TemplatesNamespace | null = null;
    #transfer: TransferNamespace | null = null;
    #dt: DtNamespace | null = null;
    #utils: UtilsNamespace | null = null;

    constructor(state: ContextState) {

        this.#state = state;

    }

    // ─────────────────────────────────────────────────────
    // Read-only Properties
    // ─────────────────────────────────────────────────────

    get config(): Config {

        return this.#state.config;

    }

    get settings(): Settings {

        return this.#state.settings;

    }

    get identity(): Identity {

        return this.#state.identity;

    }

    // ─────────────────────────────────────────────────────
    // Namespace Getters (lazy)
    // ─────────────────────────────────────────────────────

    get changes(): ChangesNamespace {

        if (!this.#changes) this.#changes = new ChangesNamespace(this.#state);

        return this.#changes;

    }

    get run(): RunNamespace {

        if (!this.#run) this.#run = new RunNamespace(this.#state);

        return this.#run;

    }

    get db(): DbNamespace {

        if (!this.#db) {

            this.#db = new DbNamespace(this.#state, (opts) => this.run.build(opts));

        }

        return this.#db;

    }

    get lock(): LockNamespace {

        if (!this.#lock) this.#lock = new LockNamespace(this.#state);

        return this.#lock;

    }

    get vault(): VaultNamespace {

        if (!this.#vault) this.#vault = new VaultNamespace(this.#state);

        return this.#vault;

    }

    get secrets(): SecretsNamespace {

        if (!this.#secrets) this.#secrets = new SecretsNamespace(this.#state);

        return this.#secrets;

    }

    get templates(): TemplatesNamespace {

        if (!this.#templates) this.#templates = new TemplatesNamespace(this.#state);

        return this.#templates;

    }

    get transfer(): TransferNamespace {

        if (!this.#transfer) this.#transfer = new TransferNamespace(this.#state);

        return this.#transfer;

    }

    get dt(): DtNamespace {

        if (!this.#dt) this.#dt = new DtNamespace(this.#state);

        return this.#dt;

    }

    get utils(): UtilsNamespace {

        if (!this.#utils) this.#utils = new UtilsNamespace(this.#state);

        return this.#utils;

    }

}
