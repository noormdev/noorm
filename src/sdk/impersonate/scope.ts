/**
 * Impersonation scope builder.
 *
 * Constructs an ImpersonatedScope that wires proc/func/transaction
 * to a dedicated connection-bound Kysely instance. The revert
 * callback is provided by the caller (Context.impersonate).
 */
import { sql } from 'kysely';

import type { Kysely, Transaction } from 'kysely';
import type { Dialect } from '../../core/connection/types.js';

import { buildProcCall, buildFuncCall } from '../sql.js';
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
export function buildScope<DB = unknown, Procs = object, Funcs = object>(
    db: Kysely<DB>,
    revertFn: () => Promise<void>,
    dialect: Dialect,
): ImpersonatedScope<DB, Procs, Funcs> {

    // === Declaration block ===
    let reverted = false;

    // === Business logic block ===
    return {

        kysely: db,

        async proc(name, ...args) {

            const params = args[0] as Record<string, unknown> | unknown[] | undefined;
            const query = buildProcCall(dialect, name as string, params);
            const result = await query.execute(db);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic return type erasure
            return (result.rows ?? []) as any;

        },

        async func(name, ...args) {

            const hasParams = !(args.length === 1 && typeof args[0] === 'string');
            const params = hasParams ? args[0] as Record<string, unknown> | unknown[] : undefined;
            const column = (hasParams ? args[1] : args[0]) as string;

            const query = buildFuncCall(dialect, name as string, column, params);
            const result = await query.execute(db);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic return type erasure
            return (result.rows?.[0] ?? null) as any;

        },

        async transaction<T>(fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {

            return db.transaction().execute(fn);

        },

        async revert() {

            if (reverted) return;
            reverted = true;

            await revertFn();

        },

    };

}
