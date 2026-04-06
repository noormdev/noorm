/**
 * Table-Valued Parameter (TVP) support for MSSQL.
 *
 * TVPs allow passing structured table data to stored procedures.
 * Only supported on MSSQL — other dialects will throw at build time.
 *
 * Bypasses Kysely's parameter binding (which lacks TVP type detection)
 * by generating DECLARE/INSERT/EXEC batches where all user values
 * remain parameterized.
 *
 * @example
 * ```typescript
 * import { createContext, tvp } from '@noormdev/sdk';
 *
 * const items = [
 *     { Type: 1, ReferenceNo: 100, Qty: 5 },
 *     { Type: 2, ReferenceNo: 200, Qty: 3 },
 * ];
 *
 * await ctx.proc('Checkout_trx', {
 *     Party: 1,
 *     PaymentMethod: 2,
 *     Items: tvp('CheckoutItems', items),
 * });
 * ```
 */

/**
 * MSSQL maximum parameter count per batch.
 *
 * Used to validate TVP parameter counts before generating SQL,
 * giving a clear error instead of a cryptic driver failure.
 */
export const MSSQL_PARAM_LIMIT = 2100;

// ─────────────────────────────────────────────────────────────
// TVP Marker
// ─────────────────────────────────────────────────────────────

/**
 * A TVP marker that wraps row data with the required table type name.
 *
 * Use the `tvp()` helper to create instances. Column names are
 * inferred from the object keys of the first row.
 *
 * @example
 * ```typescript
 * interface MyProcs {
 *     'Checkout_trx': [{ Party: number; PaymentMethod: number; Items: TvpValue }, void];
 * }
 * ```
 */
export interface TvpValue {
    readonly __noorm_tvp: true;
    readonly typeName: string;
    readonly rows: ReadonlyArray<Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────

/**
 * Create a Table-Valued Parameter for MSSQL stored procedure calls.
 *
 * Wraps an array of row objects as a TVP with the specified SQL Server
 * table type name. Column names are inferred from the first row's keys.
 *
 * @param typeName - SQL Server table type (e.g., 'CheckoutItems' or 'dbo.CheckoutItems')
 * @param rows - Array of row objects with consistent keys
 *
 * @example
 * ```typescript
 * // Named params
 * await ctx.proc('Checkout_trx', {
 *     Party: 1,
 *     PaymentMethod: 2,
 *     Items: tvp('CheckoutItems', [
 *         { Type: 1, ReferenceNo: 100, Qty: 5 },
 *         { Type: 2, ReferenceNo: 200, Qty: 3 },
 *     ]),
 * });
 *
 * // Positional params
 * await ctx.proc('Checkout_trx', [1, 2, tvp('CheckoutItems', items)]);
 * ```
 */
export function tvp(typeName: string, rows: Record<string, unknown>[]): TvpValue {

    // === Validation block ===
    if (!typeName) {

        throw new Error('TVP type name is required.');

    }

    if (!Array.isArray(rows)) {

        throw new Error('TVP rows must be an array.');

    }

    if (rows.length > 1) {

        const expectedKeys = Object.keys(rows[0]!).sort().join(',');

        for (let i = 1; i < rows.length; i++) {

            const rowKeys = Object.keys(rows[i]!).sort().join(',');

            if (rowKeys !== expectedKeys) {

                throw new Error(
                    `TVP row ${i} has mismatched keys. ` +
                    `Expected [${Object.keys(rows[0]!).join(', ')}] ` +
                    `but got [${Object.keys(rows[i]!).join(', ')}].`,
                );

            }

        }

    }

    // === Commit block ===
    return {
        __noorm_tvp: true,
        typeName,
        rows,
    };

}

// ─────────────────────────────────────────────────────────────
// Type Guard
// ─────────────────────────────────────────────────────────────

/**
 * Check if a value is a TVP marker created by `tvp()`.
 *
 * Used internally by SQL builders to detect TVP parameters
 * and generate DECLARE/INSERT batches instead of scalar binding.
 */
export function isTvp(value: unknown): value is TvpValue {

    return (
        typeof value === 'object' &&
        value !== null &&
        '__noorm_tvp' in value &&
        (value as Record<string, unknown>)['__noorm_tvp'] === true
    );

}
