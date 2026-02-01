/**
 * PostgreSQL transfer operations.
 *
 * Uses session_replication_role for FK bypass, OVERRIDING SYSTEM VALUE
 * for identity columns, and ON CONFLICT for upsert handling.
 */
import { sql } from 'kysely';

import type { Kysely } from 'kysely';
import type { NoormDatabase } from '../../shared/tables.js';
import type { TransferDialectOperations } from './types.js';
import type { ConflictStrategy } from '../types.js';

/**
 * Quote an identifier for PostgreSQL.
 */
function quoteIdent(name: string): string {

    return `"${name.replace(/"/g, '""')}"`;

}

/**
 * PostgreSQL-specific transfer operations.
 */
export const postgresTransferOperations: TransferDialectOperations = {

    getDisableFKSql(): string {

        // Disables all trigger-based constraint checking (including FKs)
        return 'SET session_replication_role = replica';

    },

    getEnableFKSql(): string {

        return 'SET session_replication_role = DEFAULT';

    },

    getEnableIdentityInsertSql(_table: string): string | null {

        // PostgreSQL doesn't need explicit identity insert mode
        // We use OVERRIDING SYSTEM VALUE in the INSERT statement
        return null;

    },

    getDisableIdentityInsertSql(_table: string): string | null {

        return null;

    },

    getResetSequenceSql(table: string, column: string, schema?: string): string | null {

        const fullTable = schema ? `${quoteIdent(schema)}.${quoteIdent(table)}` : quoteIdent(table);

        // setval to MAX + 1 (or 1 if table is empty)
        return `
            SELECT setval(
                pg_get_serial_sequence('${schema ? schema + '.' : ''}${table}', '${column}'),
                COALESCE((SELECT MAX(${quoteIdent(column)}) FROM ${fullTable}), 0) + 1,
                false
            )
        `.trim();

    },

    buildConflictInsert(
        table: string,
        columns: string[],
        primaryKey: string[],
        strategy: ConflictStrategy,
    ): string {

        const quotedCols = columns.map(quoteIdent).join(', ');
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const pkCols = primaryKey.map(quoteIdent).join(', ');

        // Base INSERT with OVERRIDING SYSTEM VALUE for identity columns
        let insertSql = `INSERT INTO ${quoteIdent(table)} (${quotedCols}) OVERRIDING SYSTEM VALUE VALUES (${placeholders})`;

        switch (strategy) {

        case 'fail':
            // No conflict clause - will error on duplicate
            break;

        case 'skip':
            insertSql += ` ON CONFLICT (${pkCols}) DO NOTHING`;
            break;

        case 'update': {

            // Update all non-PK columns
            const updateCols = columns.filter((c) => !primaryKey.includes(c));

            if (updateCols.length > 0) {

                const setClauses = updateCols
                    .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
                    .join(', ');
                insertSql += ` ON CONFLICT (${pkCols}) DO UPDATE SET ${setClauses}`;

            }
            else {

                // All columns are PK, nothing to update
                insertSql += ` ON CONFLICT (${pkCols}) DO NOTHING`;

            }

            break;

        }

        case 'replace':
            // PostgreSQL doesn't have REPLACE, use upsert with all columns
            {

                const setClauses = columns
                    .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
                    .join(', ');
                insertSql += ` ON CONFLICT (${pkCols}) DO UPDATE SET ${setClauses}`;

            }
            break;

        }

        return insertSql;

    },

    buildDirectTransfer(
        srcDb: string,
        srcTable: string,
        dstTable: string,
        columns: string[],
        srcSchema = 'public',
        dstSchema = 'public',
    ): string {

        const quotedCols = columns.map(quoteIdent).join(', ');

        // PostgreSQL uses dblink or postgres_fdw for cross-database
        // For same-server, we use the database name in the connection
        // This assumes we're connected to the destination and source is accessible
        // In practice, Kysely doesn't support cross-database queries directly
        // So we use a simpler approach: assume same database, different schemas not applicable
        const srcFull = `${quoteIdent(srcSchema)}.${quoteIdent(srcTable)}`;
        const dstFull = `${quoteIdent(dstSchema)}.${quoteIdent(dstTable)}`;

        return `INSERT INTO ${dstFull} (${quotedCols}) OVERRIDING SYSTEM VALUE SELECT ${quotedCols} FROM ${srcFull}`;

    },

    async executeDisableFK(db: Kysely<NoormDatabase>): Promise<void> {

        await sql.raw(this.getDisableFKSql()).execute(db);

    },

    async executeEnableFK(db: Kysely<NoormDatabase>): Promise<void> {

        await sql.raw(this.getEnableFKSql()).execute(db);

    },

};
