/**
 * Impersonation types.
 *
 * Defines the scoped interface returned by ctx.impersonate() and
 * the error class for unsupported dialects / invalid usernames.
 */
import type { Kysely, Transaction } from 'kysely';

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
export interface ImpersonatedScope<DB = unknown, Procs = object, Funcs = object> {
    kysely: Kysely<DB>;
    proc: <T = unknown, N extends keyof Procs & string = keyof Procs & string>(
        name: N,
        ...args: Procs[N] extends void ? [] : [params: Procs[N]]
    ) => Promise<T[]>;
    func: <T = unknown, N extends keyof Funcs & string = keyof Funcs & string>(
        name: N,
        ...args: Funcs[N] extends void ? [column: string] : [params: Funcs[N], column: string]
    ) => Promise<T>;
    transaction: <T>(fn: (trx: Transaction<DB>) => Promise<T>) => Promise<T>;
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
