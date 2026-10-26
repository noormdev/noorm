/**
 * Impersonation scope builder.
 *
 * Constructs an ImpersonatedScope that wires proc/func/transaction
 * to a dedicated connection-bound Kysely instance. The revert
 * callback is provided by the caller (Context.impersonate).
 */
import { attempt } from '@logosdx/utils';

import type { Kysely } from 'kysely';
import type { Dialect } from '../../core/connection/types.js';

import { routineCalls, withRoutines } from '../routines.js';
import type { TransactionScope } from '../types.js';
import type { ImpersonatedScope } from './types.js';

// ─────────────────────────────────────────────────────────────
// buildScope
// ─────────────────────────────────────────────────────────────

/**
 * Build a scoped query interface bound to a dedicated connection.
 *
 * The scope mirrors Context's query surface (kysely, proc, func,
 * transaction) but all operations route through the provided
 * connection-bound Kysely instance instead of the shared pool.
 *
 * @param db - Connection-bound Kysely instance from .connection().execute()
 * @param revertFn - Callback that executes dialect revert SQL and releases the connection
 * @param dialect - Current dialect for proc/func SQL generation
 *
 * @example
 * ```typescript
 * const scope = buildScope(db, async () => {
 *     await sql.raw('REVERT').execute(db);
 *     resolveHolder();
 * }, 'mssql');
 * ```
 */
export function buildScope<DB = unknown, Procs = object, Funcs = object, Tvfs = object>(
    db: Kysely<DB>,
    revertFn: () => Promise<void>,
    dialect: Dialect,
): ImpersonatedScope<DB, Procs, Funcs, Tvfs> {

    // === Declaration block ===
    let reverted = false;

    // Shared across concurrent callers so `revertFn` runs once, and cleared on
    // failure so a retry genuinely re-attempts instead of returning early.
    let reverting: Promise<void> | null = null;

    // === Business logic block ===
    return {

        kysely: db,

        ...routineCalls<DB, Procs, Funcs, Tvfs>(() => db, dialect, null),

        async transaction<T>(fn: (trx: TransactionScope<DB, Procs, Funcs, Tvfs>) => Promise<T>): Promise<T> {

            return db.transaction().execute((trx) => fn(withRoutines(trx, dialect, null)));

        },

        /**
         * Revert the impersonation and release the held connection.
         *
         * Idempotent once it has SUCCEEDED. It deliberately is not idempotent
         * after a failure: `reverted` used to be set before `revertFn` was
         * awaited, so a failed revert still marked the scope done — the
         * caller's retry returned early, the revert SQL never ran, and the
         * pooled connection was never released, which also hung `disconnect()`.
         * A revert that throws leaves the scope revertible so the retry the
         * error invites can actually work.
         */
        async revert() {

            if (reverted) return;

            if (!reverting) {

                reverting = revertFn();

            }

            const [, err] = await attempt(() => reverting!);

            reverting = null;

            if (err) throw err;

            reverted = true;

        },

    };

}
