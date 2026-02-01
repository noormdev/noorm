/**
 * Transfer dialect operations interface.
 *
 * Each database dialect implements these methods to provide
 * dialect-specific SQL for transfer operations.
 */
import type { Kysely } from 'kysely';

import type { NoormDatabase } from '../../shared/tables.js';
import type { ConflictStrategy } from '../types.js';

/**
 * Dialect-specific transfer operations.
 *
 * Implementations handle the differences between PostgreSQL, MySQL,
 * and MSSQL for identity columns, FK constraints, and conflict handling.
 */
export interface TransferDialectOperations {

    /**
     * Get SQL to disable foreign key checks.
     *
     * Called before transfer to allow inserting in any order.
     */
    getDisableFKSql(): string;

    /**
     * Get SQL to re-enable foreign key checks.
     *
     * Called after transfer completes successfully.
     */
    getEnableFKSql(): string;

    /**
     * Get SQL to enable identity insert for a table.
     *
     * Returns null if dialect doesn't require explicit identity insert mode.
     *
     * @param table - Table name (may include schema prefix)
     */
    getEnableIdentityInsertSql(table: string): string | null;

    /**
     * Get SQL to disable identity insert for a table.
     *
     * Returns null if dialect doesn't require explicit identity insert mode.
     *
     * @param table - Table name (may include schema prefix)
     */
    getDisableIdentityInsertSql(table: string): string | null;

    /**
     * Get SQL to reset sequence/auto-increment after transfer.
     *
     * Returns null if no reset is needed.
     *
     * @param table - Table name
     * @param column - Identity column name
     * @param schema - Optional schema name
     */
    getResetSequenceSql(table: string, column: string, schema?: string): string | null;

    /**
     * Build INSERT statement with conflict handling.
     *
     * @param table - Destination table name
     * @param columns - Column names to insert
     * @param primaryKey - Primary key columns for conflict detection
     * @param strategy - How to handle conflicts
     * @returns SQL template with $1, $2... placeholders
     */
    buildConflictInsert(
        table: string,
        columns: string[],
        primaryKey: string[],
        strategy: ConflictStrategy,
    ): string;

    /**
     * Build direct transfer SQL for same-server transfers.
     *
     * @param srcDb - Source database name
     * @param srcTable - Source table name
     * @param dstTable - Destination table name
     * @param columns - Columns to transfer
     * @param srcSchema - Source schema (optional)
     * @param dstSchema - Destination schema (optional)
     */
    buildDirectTransfer(
        srcDb: string,
        srcTable: string,
        dstTable: string,
        columns: string[],
        srcSchema?: string,
        dstSchema?: string,
    ): string;

    /**
     * Execute FK disable SQL.
     *
     * Some dialects need per-table disable (MSSQL), others use session setting.
     *
     * @param db - Kysely instance
     * @param tables - Tables being transferred
     */
    executeDisableFK(db: Kysely<NoormDatabase>, tables: string[]): Promise<void>;

    /**
     * Execute FK enable SQL.
     *
     * @param db - Kysely instance
     * @param tables - Tables that were transferred
     */
    executeEnableFK(db: Kysely<NoormDatabase>, tables: string[]): Promise<void>;

}
