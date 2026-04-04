/**
 * Impersonation types.
 *
 * Defines the scoped interface returned by ctx.impersonate() and
 * the error class for unsupported dialects / invalid usernames.
 */
import type { Kysely, Transaction } from 'kysely';

import type { ExtractArgs, ExtractReturn } from '../types.js';

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
export interface ImpersonatedScope<DB = unknown, Procs = object, Funcs = object, Tvfs = object> {
    kysely: Kysely<DB>;
    proc: <
        N extends keyof Procs & string = keyof Procs & string,
        T = ExtractReturn<Procs[N]>,
    >(
        name: N,
        ...args: ExtractArgs<Procs[N]> extends void ? [] : [params: ExtractArgs<Procs[N]>]
    ) => Promise<T[]>;
    func: <
        N extends keyof Funcs & string = keyof Funcs & string,
        T = ExtractReturn<Funcs[N]>,
    >(
        name: N,
        ...args: ExtractArgs<Funcs[N]> extends void ? [column: string] : [params: ExtractArgs<Funcs[N]>, column: string]
    ) => Promise<T>;
    tvf: <
        N extends keyof Tvfs & string = keyof Tvfs & string,
        T = ExtractReturn<Tvfs[N]>,
    >(
        name: N,
        ...args: ExtractArgs<Tvfs[N]> extends void ? [] : [params: ExtractArgs<Tvfs[N]>]
    ) => Promise<T[]>;
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
