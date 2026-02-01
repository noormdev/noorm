/**
 * MySQL transfer operations.
 *
 * Uses FOREIGN_KEY_CHECKS for FK bypass, explicit IDs work automatically,
 * and INSERT IGNORE / ON DUPLICATE KEY for conflict handling.
 */
import { sql } from 'kysely';

import type { Kysely } from 'kysely';
import type { NoormDatabase } from '../../shared/tables.js';
import type { TransferDialectOperations } from './types.js';
import type { ConflictStrategy } from '../types.js';

/**
 * Quote an identifier for MySQL using backticks.
 */
function quoteIdent(name: string): string {

    return `\`${name.replace(/`/g, '``')}\``;

}

/**
 * MySQL-specific transfer operations.
 */
export const mysqlTransferOperations: TransferDialectOperations = {

    getDisableFKSql(): string {

        return 'SET FOREIGN_KEY_CHECKS = 0';

    },

    getEnableFKSql(): string {

        return 'SET FOREIGN_KEY_CHECKS = 1';

    },

    getEnableIdentityInsertSql(_table: string): string | null {

        // MySQL allows inserting explicit IDs without special mode
        return null;

    },

    getDisableIdentityInsertSql(_table: string): string | null {

        return null;

    },

    getResetSequenceSql(table: string, _column: string, _schema?: string): string | null {

        // Reset AUTO_INCREMENT to 1, MySQL will adjust to MAX+1 automatically
        // on next insert if table has data
        return `ALTER TABLE ${quoteIdent(table)} AUTO_INCREMENT = 1`;

    },

    buildConflictInsert(
        table: string,
        columns: string[],
        primaryKey: string[],
        strategy: ConflictStrategy,
    ): string {

        const quotedCols = columns.map(quoteIdent).join(', ');
        const placeholders = columns.map(() => '?').join(', ');

        switch (strategy) {

        case 'fail':
            // Standard INSERT - will error on duplicate
            return `INSERT INTO ${quoteIdent(table)} (${quotedCols}) VALUES (${placeholders})`;

        case 'skip':
            // INSERT IGNORE skips rows that would cause duplicate key
            return `INSERT IGNORE INTO ${quoteIdent(table)} (${quotedCols}) VALUES (${placeholders})`;

        case 'update': {

            // ON DUPLICATE KEY UPDATE for non-PK columns
            const updateCols = columns.filter((c) => !primaryKey.includes(c));

            if (updateCols.length > 0) {

                const setClauses = updateCols
                    .map((c) => `${quoteIdent(c)} = VALUES(${quoteIdent(c)})`)
                    .join(', ');

                return `INSERT INTO ${quoteIdent(table)} (${quotedCols}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${setClauses}`;

            }

            // All columns are PK, use INSERT IGNORE
            return `INSERT IGNORE INTO ${quoteIdent(table)} (${quotedCols}) VALUES (${placeholders})`;

        }

        case 'replace':
            // REPLACE deletes existing row and inserts new one
            return `REPLACE INTO ${quoteIdent(table)} (${quotedCols}) VALUES (${placeholders})`;

        }

    },

    buildDirectTransfer(
        srcDb: string,
        srcTable: string,
        dstTable: string,
        columns: string[],
        _srcSchema?: string,
        _dstSchema?: string,
    ): string {

        const quotedCols = columns.map(quoteIdent).join(', ');

        // MySQL uses database.table notation for cross-database
        const srcFull = `${quoteIdent(srcDb)}.${quoteIdent(srcTable)}`;
        const dstFull = quoteIdent(dstTable);

        return `INSERT INTO ${dstFull} (${quotedCols}) SELECT ${quotedCols} FROM ${srcFull}`;

    },

    async executeDisableFK(db: Kysely<NoormDatabase>): Promise<void> {

        await sql.raw(this.getDisableFKSql()).execute(db);

    },

    async executeEnableFK(db: Kysely<NoormDatabase>): Promise<void> {

        await sql.raw(this.getEnableFKSql()).execute(db);

    },

};
