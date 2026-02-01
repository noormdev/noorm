/**
 * Dialect factory for transfer operations.
 *
 * Returns the appropriate transfer operations implementation
 * based on the database dialect.
 */
import type { Dialect } from '../../connection/types.js';
import type { TransferDialectOperations } from './types.js';

import { postgresTransferOperations } from './postgres.js';
import { mysqlTransferOperations } from './mysql.js';
import { mssqlTransferOperations } from './mssql.js';

/**
 * Dialect-to-operations mapping.
 *
 * Note: SQLite is not supported for data transfer operations.
 */
const dialectOperations: Partial<Record<Dialect, TransferDialectOperations>> = {
    postgres: postgresTransferOperations,
    mysql: mysqlTransferOperations,
    mssql: mssqlTransferOperations,
};

/**
 * Dialects that support data transfer.
 */
export const TRANSFER_SUPPORTED_DIALECTS: Dialect[] = ['postgres', 'mysql', 'mssql'];

/**
 * Check if a dialect supports data transfer.
 *
 * @param dialect - Database dialect
 * @returns true if dialect is supported
 */
export function isTransferSupported(dialect: Dialect): boolean {

    return TRANSFER_SUPPORTED_DIALECTS.includes(dialect);

}

/**
 * Get transfer operations for a specific dialect.
 *
 * @param dialect - The database dialect
 * @returns Dialect-specific transfer operations or null if not supported
 *
 * @example
 * ```typescript
 * const ops = getTransferOperations('postgres');
 * if (ops) {
 *     const disableSql = ops.getDisableFKSql();
 * }
 * ```
 */
export function getTransferOperations(dialect: Dialect): TransferDialectOperations | null {

    return dialectOperations[dialect] ?? null;

}

export type { TransferDialectOperations };
export { postgresTransferOperations, mysqlTransferOperations, mssqlTransferOperations };
