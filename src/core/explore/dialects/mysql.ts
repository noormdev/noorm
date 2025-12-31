/**
 * MySQL schema exploration operations.
 *
 * Queries MySQL information_schema to retrieve database object metadata.
 */
import { sql } from 'kysely';

import type { Kysely } from 'kysely';
import type {
    DialectExploreOperations,
    ExploreOverview,
    TableSummary,
    ViewSummary,
    ProcedureSummary,
    FunctionSummary,
    TypeSummary,
    IndexSummary,
    ForeignKeySummary,
    TableDetail,
    ViewDetail,
    ProcedureDetail,
    FunctionDetail,
    TypeDetail,
    ColumnDetail,
    ParameterDetail,
} from '../types.js';

/**
 * Schemas to exclude from exploration (system schemas).
 */
const EXCLUDED_SCHEMAS = ['information_schema', 'mysql', 'performance_schema', 'sys'];

/**
 * MySQL explore operations.
 */
export const mysqlExploreOperations: DialectExploreOperations = {

    async getOverview(db: Kysely<unknown>): Promise<ExploreOverview> {

        // Get current database name
        const dbNameResult = await sql<{ db: string }>`SELECT DATABASE() as db`.execute(db);
        const dbName = dbNameResult.rows[0]?.db;

        if (!dbName) {

            return {
                tables: 0,
                views: 0,
                procedures: 0,
                functions: 0,
                types: 0,
                indexes: 0,
                foreignKeys: 0,
            };

        }

        const [tables, views, procedures, functions, indexes, foreignKeys] =
            await Promise.all([
                sql<{ count: string }>`
                    SELECT COUNT(*) as count
                    FROM information_schema.tables
                    WHERE table_schema = ${dbName}
                    AND table_type = 'BASE TABLE'
                `.execute(db),

                sql<{ count: string }>`
                    SELECT COUNT(*) as count
                    FROM information_schema.views
                    WHERE table_schema = ${dbName}
                `.execute(db),

                sql<{ count: string }>`
                    SELECT COUNT(*) as count
                    FROM information_schema.routines
                    WHERE routine_schema = ${dbName}
                    AND routine_type = 'PROCEDURE'
                `.execute(db),

                sql<{ count: string }>`
                    SELECT COUNT(*) as count
                    FROM information_schema.routines
                    WHERE routine_schema = ${dbName}
                    AND routine_type = 'FUNCTION'
                `.execute(db),

                sql<{ count: string }>`
                    SELECT COUNT(DISTINCT index_name) as count
                    FROM information_schema.statistics
                    WHERE table_schema = ${dbName}
                `.execute(db),

                sql<{ count: string }>`
                    SELECT COUNT(*) as count
                    FROM information_schema.table_constraints
                    WHERE constraint_schema = ${dbName}
                    AND constraint_type = 'FOREIGN KEY'
                `.execute(db),
            ]);

        return {
            tables: parseInt(String(tables.rows[0]?.count ?? '0'), 10),
            views: parseInt(String(views.rows[0]?.count ?? '0'), 10),
            procedures: parseInt(String(procedures.rows[0]?.count ?? '0'), 10),
            functions: parseInt(String(functions.rows[0]?.count ?? '0'), 10),
            types: 0, // MySQL doesn't have custom types like PostgreSQL
            indexes: parseInt(String(indexes.rows[0]?.count ?? '0'), 10),
            foreignKeys: parseInt(String(foreignKeys.rows[0]?.count ?? '0'), 10),
        };

    },

    async listTables(db: Kysely<unknown>): Promise<TableSummary[]> {

        const dbNameResult = await sql<{ db: string }>`SELECT DATABASE() as db`.execute(db);
        const dbName = dbNameResult.rows[0]?.db;

        if (!dbName) return [];

        const result = await sql<{
            table_name: string;
            table_schema: string;
            column_count: string;
            table_rows: string | null;
        }>`
            SELECT
                t.table_name,
                t.table_schema,
                (
                    SELECT COUNT(*)
                    FROM information_schema.columns c
                    WHERE c.table_schema = t.table_schema
                    AND c.table_name = t.table_name
                ) as column_count,
                t.table_rows
            FROM information_schema.tables t
            WHERE t.table_schema = ${dbName}
            AND t.table_type = 'BASE TABLE'
            ORDER BY t.table_name
        `.execute(db);

        return result.rows.map((row) => ({
            name: row.table_name,
            schema: row.table_schema,
            columnCount: parseInt(String(row.column_count), 10),
            rowCountEstimate: row.table_rows
                ? parseInt(String(row.table_rows), 10)
                : undefined,
        }));

    },

    async listViews(db: Kysely<unknown>): Promise<ViewSummary[]> {

        const dbNameResult = await sql<{ db: string }>`SELECT DATABASE() as db`.execute(db);
        const dbName = dbNameResult.rows[0]?.db;

        if (!dbName) return [];

        const result = await sql<{
            table_name: string;
            table_schema: string;
            column_count: string;
            is_updatable: string;
        }>`
            SELECT
                v.table_name,
                v.table_schema,
                (
                    SELECT COUNT(*)
                    FROM information_schema.columns c
                    WHERE c.table_schema = v.table_schema
                    AND c.table_name = v.table_name
                ) as column_count,
                v.is_updatable
            FROM information_schema.views v
            WHERE v.table_schema = ${dbName}
            ORDER BY v.table_name
        `.execute(db);

        return result.rows.map((row) => ({
            name: row.table_name,
            schema: row.table_schema,
            columnCount: parseInt(String(row.column_count), 10),
            isUpdatable: row.is_updatable === 'YES',
        }));

    },

    async listProcedures(db: Kysely<unknown>): Promise<ProcedureSummary[]> {

        const dbNameResult = await sql<{ db: string }>`SELECT DATABASE() as db`.execute(db);
        const dbName = dbNameResult.rows[0]?.db;

        if (!dbName) return [];

        const result = await sql<{
            routine_name: string;
            routine_schema: string;
            param_count: string;
        }>`
            SELECT
                r.routine_name,
                r.routine_schema,
                (
                    SELECT COUNT(*)
                    FROM information_schema.parameters p
                    WHERE p.specific_schema = r.routine_schema
                    AND p.specific_name = r.specific_name
                    AND p.ordinal_position > 0
                ) as param_count
            FROM information_schema.routines r
            WHERE r.routine_schema = ${dbName}
            AND r.routine_type = 'PROCEDURE'
            ORDER BY r.routine_name
        `.execute(db);

        return result.rows.map((row) => ({
            name: row.routine_name,
            schema: row.routine_schema,
            parameterCount: parseInt(String(row.param_count), 10),
        }));

    },

    async listFunctions(db: Kysely<unknown>): Promise<FunctionSummary[]> {

        const dbNameResult = await sql<{ db: string }>`SELECT DATABASE() as db`.execute(db);
        const dbName = dbNameResult.rows[0]?.db;

        if (!dbName) return [];

        const result = await sql<{
            routine_name: string;
            routine_schema: string;
            param_count: string;
            data_type: string;
        }>`
            SELECT
                r.routine_name,
                r.routine_schema,
                (
                    SELECT COUNT(*)
                    FROM information_schema.parameters p
                    WHERE p.specific_schema = r.routine_schema
                    AND p.specific_name = r.specific_name
                    AND p.ordinal_position > 0
                ) as param_count,
                COALESCE(r.data_type, 'unknown') as data_type
            FROM information_schema.routines r
            WHERE r.routine_schema = ${dbName}
            AND r.routine_type = 'FUNCTION'
            ORDER BY r.routine_name
        `.execute(db);

        return result.rows.map((row) => ({
            name: row.routine_name,
            schema: row.routine_schema,
            parameterCount: parseInt(String(row.param_count), 10),
            returnType: row.data_type,
        }));

    },

    async listTypes(_db: Kysely<unknown>): Promise<TypeSummary[]> {

        // MySQL doesn't have custom types like PostgreSQL
        return [];

    },

    async listIndexes(db: Kysely<unknown>): Promise<IndexSummary[]> {

        const dbNameResult = await sql<{ db: string }>`SELECT DATABASE() as db`.execute(db);
        const dbName = dbNameResult.rows[0]?.db;

        if (!dbName) return [];

        const result = await sql<{
            index_name: string;
            table_name: string;
            column_name: string;
            non_unique: number;
            seq_in_index: number;
        }>`
            SELECT
                index_name,
                table_name,
                column_name,
                non_unique,
                seq_in_index
            FROM information_schema.statistics
            WHERE table_schema = ${dbName}
            ORDER BY table_name, index_name, seq_in_index
        `.execute(db);

        // Group by index name
        const indexMap = new Map<string, IndexSummary>();

        for (const row of result.rows) {

            const key = `${row.table_name}.${row.index_name}`;

            if (!indexMap.has(key)) {

                indexMap.set(key, {
                    name: row.index_name,
                    schema: dbName,
                    tableName: row.table_name,
                    tableSchema: dbName,
                    columns: [row.column_name],
                    isUnique: row.non_unique === 0,
                    isPrimary: row.index_name === 'PRIMARY',
                });

            }
            else {

                indexMap.get(key)!.columns.push(row.column_name);

            }

        }

        return Array.from(indexMap.values());

    },

    async listForeignKeys(db: Kysely<unknown>): Promise<ForeignKeySummary[]> {

        const dbNameResult = await sql<{ db: string }>`SELECT DATABASE() as db`.execute(db);
        const dbName = dbNameResult.rows[0]?.db;

        if (!dbName) return [];

        const result = await sql<{
            constraint_name: string;
            table_name: string;
            column_name: string;
            referenced_table_name: string;
            referenced_column_name: string;
            update_rule: string;
            delete_rule: string;
        }>`
            SELECT
                kcu.constraint_name,
                kcu.table_name,
                kcu.column_name,
                kcu.referenced_table_name,
                kcu.referenced_column_name,
                rc.update_rule,
                rc.delete_rule
            FROM information_schema.key_column_usage kcu
            JOIN information_schema.referential_constraints rc
                ON kcu.constraint_name = rc.constraint_name
                AND kcu.constraint_schema = rc.constraint_schema
            WHERE kcu.constraint_schema = ${dbName}
            AND kcu.referenced_table_name IS NOT NULL
            ORDER BY kcu.table_name, kcu.constraint_name, kcu.ordinal_position
        `.execute(db);

        // Group by constraint name
        const fkMap = new Map<string, ForeignKeySummary>();

        for (const row of result.rows) {

            const key = `${row.table_name}.${row.constraint_name}`;

            if (!fkMap.has(key)) {

                fkMap.set(key, {
                    name: row.constraint_name,
                    schema: dbName,
                    tableName: row.table_name,
                    tableSchema: dbName,
                    columns: [row.column_name],
                    referencedTable: row.referenced_table_name,
                    referencedSchema: dbName,
                    referencedColumns: [row.referenced_column_name],
                    onUpdate: row.update_rule,
                    onDelete: row.delete_rule,
                });

            }
            else {

                const fk = fkMap.get(key)!;
                fk.columns.push(row.column_name);
                fk.referencedColumns.push(row.referenced_column_name);

            }

        }

        return Array.from(fkMap.values());

    },

    async getTableDetail(
        db: Kysely<unknown>,
        name: string,
        schema?: string,
    ): Promise<TableDetail | null> {

        const dbNameResult = await sql<{ db: string }>`SELECT DATABASE() as db`.execute(db);
        const dbName = schema ?? dbNameResult.rows[0]?.db;

        if (!dbName) return null;

        // Get columns
        const columnsResult = await sql<{
            column_name: string;
            data_type: string;
            is_nullable: string;
            column_default: string | null;
            ordinal_position: number;
            column_key: string;
        }>`
            SELECT
                column_name,
                data_type,
                is_nullable,
                column_default,
                ordinal_position,
                column_key
            FROM information_schema.columns
            WHERE table_schema = ${dbName}
            AND table_name = ${name}
            ORDER BY ordinal_position
        `.execute(db);

        if (columnsResult.rows.length === 0) {

            return null;

        }

        const columns: ColumnDetail[] = columnsResult.rows.map((row) => ({
            name: row.column_name,
            dataType: row.data_type,
            isNullable: row.is_nullable === 'YES',
            defaultValue: row.column_default ?? undefined,
            isPrimaryKey: row.column_key === 'PRI',
            ordinalPosition: row.ordinal_position,
        }));

        // Get row estimate
        const rowResult = await sql<{ table_rows: string | null }>`
            SELECT table_rows
            FROM information_schema.tables
            WHERE table_schema = ${dbName}
            AND table_name = ${name}
        `.execute(db);

        const rowEstimate = rowResult.rows[0]?.table_rows
            ? parseInt(String(rowResult.rows[0].table_rows), 10)
            : undefined;

        // Get indexes
        const allIndexes = await this.listIndexes(db);
        const indexes = allIndexes.filter((idx) => idx.tableName === name);

        // Get foreign keys
        const allFks = await this.listForeignKeys(db);
        const foreignKeys = allFks.filter((fk) => fk.tableName === name);

        return {
            name,
            schema: dbName,
            columns,
            indexes,
            foreignKeys,
            rowCountEstimate: rowEstimate,
        };

    },

    async getViewDetail(
        db: Kysely<unknown>,
        name: string,
        schema?: string,
    ): Promise<ViewDetail | null> {

        const dbNameResult = await sql<{ db: string }>`SELECT DATABASE() as db`.execute(db);
        const dbName = schema ?? dbNameResult.rows[0]?.db;

        if (!dbName) return null;

        // Get view info
        const viewResult = await sql<{
            is_updatable: string;
            view_definition: string | null;
        }>`
            SELECT is_updatable, view_definition
            FROM information_schema.views
            WHERE table_schema = ${dbName}
            AND table_name = ${name}
        `.execute(db);

        if (viewResult.rows.length === 0) {

            return null;

        }

        // Get columns
        const columnsResult = await sql<{
            column_name: string;
            data_type: string;
            is_nullable: string;
            column_default: string | null;
            ordinal_position: number;
        }>`
            SELECT
                column_name,
                data_type,
                is_nullable,
                column_default,
                ordinal_position
            FROM information_schema.columns
            WHERE table_schema = ${dbName}
            AND table_name = ${name}
            ORDER BY ordinal_position
        `.execute(db);

        const columns: ColumnDetail[] = columnsResult.rows.map((row) => ({
            name: row.column_name,
            dataType: row.data_type,
            isNullable: row.is_nullable === 'YES',
            defaultValue: row.column_default ?? undefined,
            isPrimaryKey: false,
            ordinalPosition: row.ordinal_position,
        }));

        const viewRow = viewResult.rows[0];

        return {
            name,
            schema: dbName,
            columns,
            definition: viewRow?.view_definition ?? undefined,
            isUpdatable: viewRow?.is_updatable === 'YES',
        };

    },

    async getProcedureDetail(
        db: Kysely<unknown>,
        name: string,
        schema?: string,
    ): Promise<ProcedureDetail | null> {

        const dbNameResult = await sql<{ db: string }>`SELECT DATABASE() as db`.execute(db);
        const dbName = schema ?? dbNameResult.rows[0]?.db;

        if (!dbName) return null;

        const result = await sql<{
            routine_definition: string | null;
            specific_name: string;
        }>`
            SELECT routine_definition, specific_name
            FROM information_schema.routines
            WHERE routine_schema = ${dbName}
            AND routine_name = ${name}
            AND routine_type = 'PROCEDURE'
        `.execute(db);

        const procRow = result.rows[0];

        if (!procRow) {

            return null;

        }

        // Get parameters
        const paramsResult = await sql<{
            parameter_name: string | null;
            data_type: string;
            parameter_mode: string | null;
            ordinal_position: number;
        }>`
            SELECT
                parameter_name,
                data_type,
                parameter_mode,
                ordinal_position
            FROM information_schema.parameters
            WHERE specific_schema = ${dbName}
            AND specific_name = ${procRow.specific_name}
            AND ordinal_position > 0
            ORDER BY ordinal_position
        `.execute(db);

        const parameters: ParameterDetail[] = paramsResult.rows.map((row) => ({
            name: row.parameter_name ?? `param${row.ordinal_position}`,
            dataType: row.data_type,
            mode: (row.parameter_mode ?? 'IN') as 'IN' | 'OUT' | 'INOUT',
            ordinalPosition: row.ordinal_position,
        }));

        return {
            name,
            schema: dbName,
            parameters,
            definition: procRow.routine_definition ?? undefined,
        };

    },

    async getFunctionDetail(
        db: Kysely<unknown>,
        name: string,
        schema?: string,
    ): Promise<FunctionDetail | null> {

        const dbNameResult = await sql<{ db: string }>`SELECT DATABASE() as db`.execute(db);
        const dbName = schema ?? dbNameResult.rows[0]?.db;

        if (!dbName) return null;

        const result = await sql<{
            routine_definition: string | null;
            specific_name: string;
            data_type: string;
        }>`
            SELECT routine_definition, specific_name, data_type
            FROM information_schema.routines
            WHERE routine_schema = ${dbName}
            AND routine_name = ${name}
            AND routine_type = 'FUNCTION'
        `.execute(db);

        const funcRow = result.rows[0];

        if (!funcRow) {

            return null;

        }

        // Get parameters
        const paramsResult = await sql<{
            parameter_name: string | null;
            data_type: string;
            parameter_mode: string | null;
            ordinal_position: number;
        }>`
            SELECT
                parameter_name,
                data_type,
                parameter_mode,
                ordinal_position
            FROM information_schema.parameters
            WHERE specific_schema = ${dbName}
            AND specific_name = ${funcRow.specific_name}
            AND ordinal_position > 0
            ORDER BY ordinal_position
        `.execute(db);

        const parameters: ParameterDetail[] = paramsResult.rows.map((row) => ({
            name: row.parameter_name ?? `param${row.ordinal_position}`,
            dataType: row.data_type,
            mode: (row.parameter_mode ?? 'IN') as 'IN' | 'OUT' | 'INOUT',
            ordinalPosition: row.ordinal_position,
        }));

        return {
            name,
            schema: dbName,
            parameters,
            returnType: funcRow.data_type,
            definition: funcRow.routine_definition ?? undefined,
        };

    },

    async getTypeDetail(
        _db: Kysely<unknown>,
        _name: string,
        _schema?: string,
    ): Promise<TypeDetail | null> {

        // MySQL doesn't have custom types
        return null;

    },

};
