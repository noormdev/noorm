/**
 * Impersonation types.
 *
 * Defines the scoped interface returned by ctx.impersonate() and
 * the error class for unsupported dialects / invalid usernames.
 */
import type { Kysely } from 'kysely';

import type { RoutineCalls, TransactionScope } from '../types.js';

// ─────────────────────────────────────────────────────────────
// ImpersonatedScope
// ─────────────────────────────────────────────────────────────

/**
 * Scoped query interface bound to a dedicated impersonated connection.
 *
 * All queries route through a single pool connection running under
 * the impersonated principal. Mirrors Context's query surface without
 * lifecycle or noorm ops.
 */
export interface ImpersonatedScope<DB = unknown, Procs = object, Funcs = object, Tvfs = object>
    extends RoutineCalls<Procs, Funcs, Tvfs> {
    kysely: Kysely<DB>;
    transaction: <T>(fn: (trx: TransactionScope<DB, Procs, Funcs, Tvfs>) => Promise<T>) => Promise<T>;
    revert: () => Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// ImpersonationError
// ─────────────────────────────────────────────────────────────

/**
 * Thrown when impersonation fails.
 *
 * Covers unsupported dialects and invalid usernames.
 */
export class ImpersonationError extends Error {

    constructor(message: string) {

        super(message);
        this.name = 'ImpersonationError';

    }

}
