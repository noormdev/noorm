/**
 * MSSQL transfer operations.
 *
 * Uses NOCHECK CONSTRAINT for FK bypass, SET IDENTITY_INSERT for
 * identity columns, and MERGE for conflict handling.
 */
import { sql } from 'kysely';

import type { Kysely } from 'kysely';
import type { NoormDatabase } from '../../shared/tables.js';
import type { TransferDialectOperations } from './types.js';
import type { ConflictStrategy } from '../types.js';

/**
 * Quote an identifier for MSSQL using brackets.
 */
function quoteIdent(name: string): string {

    return `[${name.replace(/\]/g, ']]')}]`;

}

/**
 * MSSQL-specific transfer operations.
 */
export const mssqlTransferOperations: TransferDialectOperations = {

    getDisableFKSql(): string {

        // MSSQL needs per-table disable, this is a placeholder
        // Actual disable happens in executeDisableFK
        return '-- FK disable per-table';

    },

    getEnableFKSql(): string {

        // Placeholder - actual enable happens in executeEnableFK
        return '-- FK enable per-table';

    },

    getEnableIdentityInsertSql(table: string): string | null {

        return `SET IDENTITY_INSERT ${quoteIdent(table)} ON`;

    },

    getDisableIdentityInsertSql(table: string): string | null {

        return `SET IDENTITY_INSERT ${quoteIdent(table)} OFF`;

    },

    getResetSequenceSql(table: string, _column: string, _schema?: string): string | null {

        // DBCC CHECKIDENT reseeds the identity to MAX+1
        return `DBCC CHECKIDENT ('${table}', RESEED)`;

    },

    buildConflictInsert(
        table: string,
        columns: string[],
        primaryKey: string[],
        strategy: ConflictStrategy,
    ): string {

        const quotedCols = columns.map(quoteIdent).join(', ');

        // MSSQL uses @p1, @p2, etc. for parameters (Kysely handles this)
        // For raw SQL, we use positional markers that Kysely will translate
        const placeholders = columns.map((_, i) => `@p${i}`).join(', ');

        switch (strategy) {

        case 'fail':
            // Standard INSERT - will error on duplicate
            return `INSERT INTO ${quoteIdent(table)} (${quotedCols}) VALUES (${placeholders})`;

        case 'skip':
        case 'update':
        case 'replace': {

            // MSSQL uses MERGE for all conflict scenarios
            const pkConditions = primaryKey
                .map((pk) => `target.${quoteIdent(pk)} = source.${quoteIdent(pk)}`)
                .join(' AND ');

            // Source is a VALUES clause wrapped as a derived table
            const sourceValues = columns.map((c, i) => `@p${i} AS ${quoteIdent(c)}`).join(', ');

            let mergeSql = `
                MERGE INTO ${quoteIdent(table)} AS target
                USING (SELECT ${sourceValues}) AS source
                ON (${pkConditions})
            `.trim();

            if (strategy === 'skip') {

                // Only insert when not matched
                mergeSql += `
                    WHEN NOT MATCHED THEN
                        INSERT (${quotedCols})
                        VALUES (${columns.map((c) => `source.${quoteIdent(c)}`).join(', ')})
                `;

            }
            else if (strategy === 'update') {

                // Update when matched, insert when not
                const updateCols = columns.filter((c) => !primaryKey.includes(c));

                if (updateCols.length > 0) {

                    const setClauses = updateCols
                        .map((c) => `target.${quoteIdent(c)} = source.${quoteIdent(c)}`)
                        .join(', ');

                    mergeSql += `
                        WHEN MATCHED THEN
                            UPDATE SET ${setClauses}
                    `;

                }

                mergeSql += `
                    WHEN NOT MATCHED THEN
                        INSERT (${quotedCols})
                        VALUES (${columns.map((c) => `source.${quoteIdent(c)}`).join(', ')})
                `;

            }
            else {

                // replace: update all columns when matched
                const setClauses = columns
                    .map((c) => `target.${quoteIdent(c)} = source.${quoteIdent(c)}`)
                    .join(', ');

                mergeSql += `
                    WHEN MATCHED THEN
                        UPDATE SET ${setClauses}
                    WHEN NOT MATCHED THEN
                        INSERT (${quotedCols})
                        VALUES (${columns.map((c) => `source.${quoteIdent(c)}`).join(', ')})
                `;

            }

            mergeSql += ';';

            return mergeSql.trim();

        }

        }

    },

    buildDirectTransfer(
        srcDb: string,
        srcTable: string,
        dstTable: string,
        columns: string[],
        srcSchema = 'dbo',
        dstSchema = 'dbo',
    ): string {

        const quotedCols = columns.map(quoteIdent).join(', ');

        // MSSQL uses four-part naming: [server].[database].[schema].[table]
        // For same-server, we can use [database].[schema].[table]
        const srcFull = `${quoteIdent(srcDb)}.${quoteIdent(srcSchema)}.${quoteIdent(srcTable)}`;
        const dstFull = `${quoteIdent(dstSchema)}.${quoteIdent(dstTable)}`;

        return `INSERT INTO ${dstFull} (${quotedCols}) SELECT ${quotedCols} FROM ${srcFull}`;

    },

    async executeDisableFK(db: Kysely<NoormDatabase>, tables: string[]): Promise<void> {

        // MSSQL requires per-table constraint disable
        for (const table of tables) {

            await sql.raw(`ALTER TABLE ${quoteIdent(table)} NOCHECK CONSTRAINT ALL`).execute(db);

        }

    },

    async executeEnableFK(db: Kysely<NoormDatabase>, tables: string[]): Promise<void> {

        // Re-enable with CHECK CHECK to validate existing data
        for (const table of tables) {

            await sql.raw(`ALTER TABLE ${quoteIdent(table)} WITH CHECK CHECK CONSTRAINT ALL`).execute(db);

        }

    },

};
