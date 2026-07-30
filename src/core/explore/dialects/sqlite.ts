/**
 * SQLite schema exploration operations.
 *
 * Queries SQLite system tables (sqlite_master) and PRAGMAs
 * to retrieve database object metadata.
 */
import { attempt } from '@logosdx/utils';
import { sql } from 'kysely';

import type { Kysely } from 'kysely';
import type {
    DialectExploreOperations,
    TableSummary,
    ViewSummary,
    ProcedureSummary,
    FunctionSummary,
    TypeSummary,
    IndexSummary,
    ForeignKeySummary,
    TriggerSummary,
    LockSummary,
    ConnectionSummary,
    TableDetail,
    ViewDetail,
    ProcedureDetail,
    FunctionDetail,
    TypeDetail,
    TriggerDetail,
    ColumnDetail,
} from '../types.js';

/**
 * Quote an identifier for interpolation into SQLite statement text.
 *
 * PRAGMA arguments and `FROM <table>` cannot be bound as parameters, so the
 * name has to be concatenated. Doubling embedded `"` is what keeps it an
 * identifier rather than a fragment of SQL: a table named `we"ird` otherwise
 * aborts the statement, and with it every unrelated object in the same listing.
 *
 * @example
 * ```typescript
 * sql`PRAGMA table_info(${sql.raw(quoteIdent(name))})`
 * ```
 */
function quoteIdent(name: string): string {

    return `"${name.replaceAll('"', '""')}"`;

}

/**
 * Timing and event as written in a `CREATE TRIGGER` header.
 *
 * Everything from `BEGIN` onward is the trigger body; scanning it for keywords
 * reports the body's own statements as trigger events and lets a `BEFORE`
 * inside a string literal override the real timing.
 */
function parseTriggerHeader(definition: string): {
    timing: 'BEFORE' | 'AFTER' | 'INSTEAD OF';
    events: ('INSERT' | 'UPDATE' | 'DELETE')[];
} {

    const header = /\bTRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?\S+\s+(?:(BEFORE|AFTER|INSTEAD\s+OF)\s+)?(DELETE|INSERT|UPDATE)\b/i
        .exec(definition);

    if (!header) {

        return { timing: 'AFTER', events: ['INSERT'] };

    }

    const timing = header[1]
        ? header[1].toUpperCase().replace(/\s+/, ' ') as 'BEFORE' | 'AFTER' | 'INSTEAD OF'
        : 'AFTER';

    return {
        timing,
        events: [header[2]!.toUpperCase() as 'INSERT' | 'UPDATE' | 'DELETE'],
    };

}

/**
 * SQLite explore operations.
 *
 * Note: SQLite has limited metadata compared to other databases:
 * - No stored procedures or functions
 * - No custom types
 * - No schemas (single schema per database)
 */
export const sqliteExploreOperations: DialectExploreOperations = {

    async listTables(db: Kysely<unknown>): Promise<TableSummary[]> {

        const result = await sql<{ name: string }>`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
            ORDER BY name
        `.execute(db);

        const tables: TableSummary[] = [];

        for (const row of result.rows) {

            // Get column count
            const colsResult = await sql<{ cid: number }>`
                PRAGMA table_info(${sql.raw(quoteIdent(row.name))})
            `.execute(db);

            // Get row count estimate
            const countResult = await sql<{ count: number }>`
                SELECT COUNT(*) as count FROM ${sql.raw(quoteIdent(row.name))}
            `.execute(db);

            tables.push({
                name: row.name,
                columnCount: colsResult.rows.length,
                rowCountEstimate: countResult.rows[0]?.count,
            });

        }

        return tables;

    },

    async listViews(db: Kysely<unknown>): Promise<ViewSummary[]> {

        const result = await sql<{ name: string }>`
            SELECT name
            FROM sqlite_master
            WHERE type = 'view'
            ORDER BY name
        `.execute(db);

        const views: ViewSummary[] = [];

        for (const row of result.rows) {

            // A view whose base table was dropped makes PRAGMA table_info fail.
            // Report it with no columns rather than losing the whole listing.
            const [colsResult] = await attempt(() => sql<{ cid: number }>`
                PRAGMA table_info(${sql.raw(quoteIdent(row.name))})
            `.execute(db));

            views.push({
                name: row.name,
                columnCount: colsResult?.rows.length ?? 0,
                isUpdatable: false, // SQLite views are generally not updatable
            });

        }

        return views;

    },

    async listProcedures(_db: Kysely<unknown>): Promise<ProcedureSummary[]> {

        // SQLite doesn't support stored procedures
        return [];

    },

    async listFunctions(_db: Kysely<unknown>): Promise<FunctionSummary[]> {

        // SQLite doesn't support user-defined functions via SQL
        return [];

    },

    async listTypes(_db: Kysely<unknown>): Promise<TypeSummary[]> {

        // SQLite doesn't support custom types
        return [];

    },

    async listIndexes(db: Kysely<unknown>): Promise<IndexSummary[]> {

        const result = await sql<{
            name: string;
            tbl_name: string;
            sql: string | null;
        }>`
            SELECT name, tbl_name, sql
            FROM sqlite_master
            WHERE type = 'index'
            AND name NOT LIKE 'sqlite_%'
            ORDER BY tbl_name, name
        `.execute(db);

        const indexes: IndexSummary[] = [];

        for (const row of result.rows) {

            // Get index info
            const infoResult = await sql<{
                seqno: number;
                cid: number;
                name: string;
            }>`
                PRAGMA index_info(${sql.raw(quoteIdent(row.name))})
            `.execute(db);

            const columns = infoResult.rows.map((r) => r.name);
            const isUnique = row.sql?.toUpperCase().includes('UNIQUE') ?? false;
            const isPrimary = row.name.startsWith('sqlite_autoindex_');

            indexes.push({
                name: row.name,
                tableName: row.tbl_name,
                columns,
                isUnique: isUnique || isPrimary,
                isPrimary,
            });

        }

        return indexes;

    },

    async listForeignKeys(db: Kysely<unknown>): Promise<ForeignKeySummary[]> {

        const tablesResult = await sql<{ name: string }>`
            SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        `.execute(db);

        const foreignKeys: ForeignKeySummary[] = [];

        for (const table of tablesResult.rows) {

            const fksResult = await sql<{
                id: number;
                seq: number;
                table: string;
                from: string;
                to: string;
                on_update: string;
                on_delete: string;
            }>`
                PRAGMA foreign_key_list(${sql.raw(quoteIdent(table.name))})
            `.execute(db);

            // Group by FK id
            const fkMap = new Map<number, ForeignKeySummary>();

            for (const row of fksResult.rows) {

                if (!fkMap.has(row.id)) {

                    fkMap.set(row.id, {
                        name: `fk_${table.name}_${row.id}`,
                        tableName: table.name,
                        columns: [row.from],
                        referencedTable: row.table,
                        referencedColumns: [row.to],
                        onUpdate: row.on_update,
                        onDelete: row.on_delete,
                    });

                }
                else {

                    const fk = fkMap.get(row.id)!;
                    fk.columns.push(row.from);
                    fk.referencedColumns.push(row.to);

                }

            }

            foreignKeys.push(...fkMap.values());

        }

        return foreignKeys;

    },

    async getTableDetail(
        db: Kysely<unknown>,
        name: string,
        _schema?: string,
    ): Promise<TableDetail | null> {

        // Check if table exists
        const tableCheck = await sql<{ name: string }>`
            SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name}
        `.execute(db);

        if (tableCheck.rows.length === 0) {

            return null;

        }

        // Get columns
        const colsResult = await sql<{
            cid: number;
            name: string;
            type: string;
            notnull: number;
            dflt_value: string | null;
            pk: number;
        }>`
            PRAGMA table_info(${sql.raw(quoteIdent(name))})
        `.execute(db);

        const columns: ColumnDetail[] = colsResult.rows.map((row) => ({
            name: row.name,
            dataType: row.type || 'ANY',
            isNullable: row.notnull === 0,
            defaultValue: row.dflt_value ?? undefined,
            isPrimaryKey: row.pk > 0,
            ordinalPosition: row.cid + 1,
        }));

        // Get row count
        const countResult = await sql<{ count: number }>`
            SELECT COUNT(*) as count FROM ${sql.raw(quoteIdent(name))}
        `.execute(db);

        // Get indexes for this table
        const allIndexes = await this.listIndexes(db);
        const indexes = allIndexes.filter((idx) => idx.tableName === name);

        // Get foreign keys for this table
        const allFks = await this.listForeignKeys(db);
        const foreignKeys = allFks.filter((fk) => fk.tableName === name);

        return {
            name,
            columns,
            indexes,
            foreignKeys,
            rowCountEstimate: countResult.rows[0]?.count,
        };

    },

    async getViewDetail(
        db: Kysely<unknown>,
        name: string,
        _schema?: string,
    ): Promise<ViewDetail | null> {

        // Check if view exists and get definition
        const viewResult = await sql<{ sql: string | null }>`
            SELECT sql FROM sqlite_master WHERE type = 'view' AND name = ${name}
        `.execute(db);

        const viewRow = viewResult.rows[0];

        if (!viewRow) {

            return null;

        }

        // Get columns
        const colsResult = await sql<{
            cid: number;
            name: string;
            type: string;
            notnull: number;
            dflt_value: string | null;
        }>`
            PRAGMA table_info(${sql.raw(quoteIdent(name))})
        `.execute(db);

        const columns: ColumnDetail[] = colsResult.rows.map((row) => ({
            name: row.name,
            dataType: row.type || 'ANY',
            isNullable: row.notnull === 0,
            defaultValue: row.dflt_value ?? undefined,
            isPrimaryKey: false,
            ordinalPosition: row.cid + 1,
        }));

        return {
            name,
            columns,
            definition: viewRow.sql ?? undefined,
            isUpdatable: false,
        };

    },

    async getProcedureDetail(
        _db: Kysely<unknown>,
        _name: string,
        _schema?: string,
    ): Promise<ProcedureDetail | null> {

        // SQLite doesn't support stored procedures
        return null;

    },

    async getFunctionDetail(
        _db: Kysely<unknown>,
        _name: string,
        _schema?: string,
    ): Promise<FunctionDetail | null> {

        // SQLite doesn't support user-defined functions via SQL
        return null;

    },

    async getTypeDetail(
        _db: Kysely<unknown>,
        _name: string,
        _schema?: string,
    ): Promise<TypeDetail | null> {

        // SQLite doesn't support custom types
        return null;

    },

    async listTriggers(db: Kysely<unknown>): Promise<TriggerSummary[]> {

        const result = await sql<{
            name: string;
            tbl_name: string;
            sql: string;
        }>`
            SELECT name, tbl_name, sql
            FROM sqlite_master
            WHERE type = 'trigger'
            ORDER BY tbl_name, name
        `.execute(db);

        return result.rows.map((row) => {

            const { timing, events } = parseTriggerHeader(row.sql);

            return {
                name: row.name,
                tableName: row.tbl_name,
                timing,
                events,
            };

        });

    },

    async listLocks(_db: Kysely<unknown>): Promise<LockSummary[]> {

        // SQLite doesn't expose lock information via SQL
        return [];

    },

    async listConnections(_db: Kysely<unknown>): Promise<ConnectionSummary[]> {

        // SQLite doesn't have connection tracking (single-user database)
        return [];

    },

    async getTriggerDetail(
        db: Kysely<unknown>,
        name: string,
    ): Promise<TriggerDetail | null> {

        const result = await sql<{
            name: string;
            tbl_name: string;
            sql: string;
        }>`
            SELECT name, tbl_name, sql
            FROM sqlite_master
            WHERE type = 'trigger'
            AND name = ${name}
        `.execute(db);

        if (result.rows.length === 0) {

            return null;

        }

        const row = result.rows[0]!;
        const { timing, events } = parseTriggerHeader(row.sql);

        return {
            name: row.name,
            tableName: row.tbl_name,
            timing,
            events,
            definition: row.sql,
            isEnabled: true, // SQLite triggers are always enabled
        };

    },

};
