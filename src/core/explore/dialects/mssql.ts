/**
 * MSSQL schema exploration operations.
 *
 * Queries SQL Server system views (sys.*) to retrieve database object metadata.
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
    ParameterDetail,
} from '../types.js';

/**
 * Schemas to exclude from exploration (system schemas).
 */
const EXCLUDED_SCHEMAS = ['sys', 'INFORMATION_SCHEMA', 'guest'];

/**
 * MSSQL explore operations.
 */
export const mssqlExploreOperations: DialectExploreOperations = {

    async getOverview(db: Kysely<unknown>): Promise<ExploreOverview> {

        const [tables, views, procedures, functions, types, indexes, foreignKeys] =
            await Promise.all([
                sql<{ count: number }>`
                    SELECT COUNT(*) as count
                    FROM sys.tables t
                    JOIN sys.schemas s ON t.schema_id = s.schema_id
                    WHERE s.name NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
                `.execute(db),

                sql<{ count: number }>`
                    SELECT COUNT(*) as count
                    FROM sys.views v
                    JOIN sys.schemas s ON v.schema_id = s.schema_id
                    WHERE s.name NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
                `.execute(db),

                sql<{ count: number }>`
                    SELECT COUNT(*) as count
                    FROM sys.procedures p
                    JOIN sys.schemas s ON p.schema_id = s.schema_id
                    WHERE s.name NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
                `.execute(db),

                sql<{ count: number }>`
                    SELECT COUNT(*) as count
                    FROM sys.objects o
                    JOIN sys.schemas s ON o.schema_id = s.schema_id
                    WHERE o.type IN ('FN', 'IF', 'TF')
                    AND s.name NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
                `.execute(db),

                sql<{ count: number }>`
                    SELECT COUNT(*) as count
                    FROM sys.types t
                    JOIN sys.schemas s ON t.schema_id = s.schema_id
                    WHERE t.is_user_defined = 1
                    AND s.name NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
                `.execute(db),

                sql<{ count: number }>`
                    SELECT COUNT(*) as count
                    FROM sys.indexes i
                    JOIN sys.tables t ON i.object_id = t.object_id
                    JOIN sys.schemas s ON t.schema_id = s.schema_id
                    WHERE i.name IS NOT NULL
                    AND s.name NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
                `.execute(db),

                sql<{ count: number }>`
                    SELECT COUNT(*) as count
                    FROM sys.foreign_keys fk
                    JOIN sys.schemas s ON fk.schema_id = s.schema_id
                    WHERE s.name NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
                `.execute(db),
            ]);

        return {
            tables: tables.rows[0]?.count ?? 0,
            views: views.rows[0]?.count ?? 0,
            procedures: procedures.rows[0]?.count ?? 0,
            functions: functions.rows[0]?.count ?? 0,
            types: types.rows[0]?.count ?? 0,
            indexes: indexes.rows[0]?.count ?? 0,
            foreignKeys: foreignKeys.rows[0]?.count ?? 0,
            triggers: 0, // TODO: implement count
            locks: 0,    // TODO: implement count
            connections: 0, // TODO: implement count
        };

    },

    async listTables(db: Kysely<unknown>): Promise<TableSummary[]> {

        const result = await sql<{
            table_name: string;
            schema_name: string;
            column_count: number;
            row_count: number;
        }>`
            SELECT
                t.name as table_name,
                s.name as schema_name,
                (
                    SELECT COUNT(*)
                    FROM sys.columns c
                    WHERE c.object_id = t.object_id
                ) as column_count,
                ISNULL(p.rows, 0) as row_count
            FROM sys.tables t
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            LEFT JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
            WHERE s.name NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
            ORDER BY s.name, t.name
        `.execute(db);

        return result.rows.map((row) => ({
            name: row.table_name,
            schema: row.schema_name,
            columnCount: row.column_count,
            rowCountEstimate: row.row_count > 0 ? row.row_count : undefined,
        }));

    },

    async listViews(db: Kysely<unknown>): Promise<ViewSummary[]> {

        const result = await sql<{
            view_name: string;
            schema_name: string;
            column_count: number;
        }>`
            SELECT
                v.name as view_name,
                s.name as schema_name,
                (
                    SELECT COUNT(*)
                    FROM sys.columns c
                    WHERE c.object_id = v.object_id
                ) as column_count
            FROM sys.views v
            JOIN sys.schemas s ON v.schema_id = s.schema_id
            WHERE s.name NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
            ORDER BY s.name, v.name
        `.execute(db);

        return result.rows.map((row) => ({
            name: row.view_name,
            schema: row.schema_name,
            columnCount: row.column_count,
            isUpdatable: false, // Would need additional check
        }));

    },

    async listProcedures(db: Kysely<unknown>): Promise<ProcedureSummary[]> {

        const result = await sql<{
            proc_name: string;
            schema_name: string;
            param_count: number;
        }>`
            SELECT
                p.name as proc_name,
                s.name as schema_name,
                (
                    SELECT COUNT(*)
                    FROM sys.parameters pr
                    WHERE pr.object_id = p.object_id
                    AND pr.parameter_id > 0
                ) as param_count
            FROM sys.procedures p
            JOIN sys.schemas s ON p.schema_id = s.schema_id
            WHERE s.name NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
            ORDER BY s.name, p.name
        `.execute(db);

        return result.rows.map((row) => ({
            name: row.proc_name,
            schema: row.schema_name,
            parameterCount: row.param_count,
        }));

    },

    async listFunctions(db: Kysely<unknown>): Promise<FunctionSummary[]> {

        const result = await sql<{
            func_name: string;
            schema_name: string;
            param_count: number;
            return_type: string;
        }>`
            SELECT
                o.name as func_name,
                s.name as schema_name,
                (
                    SELECT COUNT(*)
                    FROM sys.parameters p
                    WHERE p.object_id = o.object_id
                    AND p.parameter_id > 0
                ) as param_count,
                CASE o.type
                    WHEN 'FN' THEN 'scalar'
                    WHEN 'IF' THEN 'inline table'
                    WHEN 'TF' THEN 'table'
                    ELSE 'unknown'
                END as return_type
            FROM sys.objects o
            JOIN sys.schemas s ON o.schema_id = s.schema_id
            WHERE o.type IN ('FN', 'IF', 'TF')
            AND s.name NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
            ORDER BY s.name, o.name
        `.execute(db);

        return result.rows.map((row) => ({
            name: row.func_name,
            schema: row.schema_name,
            parameterCount: row.param_count,
            returnType: row.return_type,
        }));

    },

    async listTypes(db: Kysely<unknown>): Promise<TypeSummary[]> {

        const result = await sql<{
            type_name: string;
            schema_name: string;
            is_table_type: boolean;
        }>`
            SELECT
                t.name as type_name,
                s.name as schema_name,
                t.is_table_type
            FROM sys.types t
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE t.is_user_defined = 1
            AND s.name NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
            ORDER BY s.name, t.name
        `.execute(db);

        return result.rows.map((row) => ({
            name: row.type_name,
            schema: row.schema_name,
            kind: row.is_table_type ? 'composite' : 'domain',
        }));

    },

    async listIndexes(db: Kysely<unknown>): Promise<IndexSummary[]> {

        const result = await sql<{
            index_name: string;
            schema_name: string;
            table_name: string;
            is_unique: boolean;
            is_primary_key: boolean;
            column_names: string;
        }>`
            SELECT
                i.name as index_name,
                s.name as schema_name,
                t.name as table_name,
                i.is_unique,
                i.is_primary_key,
                STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) as column_names
            FROM sys.indexes i
            JOIN sys.tables t ON i.object_id = t.object_id
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            WHERE i.name IS NOT NULL
            AND s.name NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
            GROUP BY i.name, s.name, t.name, i.is_unique, i.is_primary_key
            ORDER BY s.name, t.name, i.name
        `.execute(db);

        return result.rows.map((row) => ({
            name: row.index_name,
            schema: row.schema_name,
            tableName: row.table_name,
            tableSchema: row.schema_name,
            columns: row.column_names.split(', '),
            isUnique: row.is_unique,
            isPrimary: row.is_primary_key,
        }));

    },

    async listForeignKeys(db: Kysely<unknown>): Promise<ForeignKeySummary[]> {

        const result = await sql<{
            fk_name: string;
            schema_name: string;
            table_name: string;
            column_name: string;
            ref_schema: string;
            ref_table: string;
            ref_column: string;
            delete_action: string;
            update_action: string;
        }>`
            SELECT
                fk.name as fk_name,
                s.name as schema_name,
                t.name as table_name,
                c.name as column_name,
                rs.name as ref_schema,
                rt.name as ref_table,
                rc.name as ref_column,
                CASE fk.delete_referential_action
                    WHEN 0 THEN 'NO ACTION'
                    WHEN 1 THEN 'CASCADE'
                    WHEN 2 THEN 'SET NULL'
                    WHEN 3 THEN 'SET DEFAULT'
                END as delete_action,
                CASE fk.update_referential_action
                    WHEN 0 THEN 'NO ACTION'
                    WHEN 1 THEN 'CASCADE'
                    WHEN 2 THEN 'SET NULL'
                    WHEN 3 THEN 'SET DEFAULT'
                END as update_action
            FROM sys.foreign_keys fk
            JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
            JOIN sys.tables t ON fk.parent_object_id = t.object_id
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            JOIN sys.columns c ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
            JOIN sys.tables rt ON fk.referenced_object_id = rt.object_id
            JOIN sys.schemas rs ON rt.schema_id = rs.schema_id
            JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
            WHERE s.name NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
            ORDER BY s.name, t.name, fk.name, fkc.constraint_column_id
        `.execute(db);

        // Group by FK name
        const fkMap = new Map<string, ForeignKeySummary>();

        for (const row of result.rows) {

            const key = `${row.schema_name}.${row.fk_name}`;

            if (!fkMap.has(key)) {

                fkMap.set(key, {
                    name: row.fk_name,
                    schema: row.schema_name,
                    tableName: row.table_name,
                    tableSchema: row.schema_name,
                    columns: [row.column_name],
                    referencedTable: row.ref_table,
                    referencedSchema: row.ref_schema,
                    referencedColumns: [row.ref_column],
                    onDelete: row.delete_action,
                    onUpdate: row.update_action,
                });

            }
            else {

                const fk = fkMap.get(key)!;
                fk.columns.push(row.column_name);
                fk.referencedColumns.push(row.ref_column);

            }

        }

        return Array.from(fkMap.values());

    },

    async getTableDetail(
        db: Kysely<unknown>,
        name: string,
        schema = 'dbo',
    ): Promise<TableDetail | null> {

        // Get columns
        const columnsResult = await sql<{
            column_name: string;
            data_type: string;
            is_nullable: boolean;
            column_default: string | null;
            ordinal_position: number;
            is_identity: boolean;
        }>`
            SELECT
                c.name as column_name,
                TYPE_NAME(c.user_type_id) as data_type,
                c.is_nullable,
                OBJECT_DEFINITION(c.default_object_id) as column_default,
                c.column_id as ordinal_position,
                c.is_identity
            FROM sys.columns c
            JOIN sys.tables t ON c.object_id = t.object_id
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE t.name = ${name}
            AND s.name = ${schema}
            ORDER BY c.column_id
        `.execute(db);

        if (columnsResult.rows.length === 0) {

            return null;

        }

        // Get primary key columns
        const pkResult = await sql<{ column_name: string }>`
            SELECT c.name as column_name
            FROM sys.indexes i
            JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            JOIN sys.tables t ON i.object_id = t.object_id
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE i.is_primary_key = 1
            AND t.name = ${name}
            AND s.name = ${schema}
        `.execute(db);

        const pkColumns = new Set(pkResult.rows.map((r) => r.column_name));

        // Get row count
        const rowResult = await sql<{ row_count: number }>`
            SELECT SUM(p.rows) as row_count
            FROM sys.partitions p
            JOIN sys.tables t ON p.object_id = t.object_id
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE p.index_id IN (0, 1)
            AND t.name = ${name}
            AND s.name = ${schema}
        `.execute(db);

        const columns: ColumnDetail[] = columnsResult.rows.map((row) => ({
            name: row.column_name,
            dataType: row.data_type,
            isNullable: row.is_nullable,
            defaultValue: row.column_default ?? undefined,
            isPrimaryKey: pkColumns.has(row.column_name),
            ordinalPosition: row.ordinal_position,
        }));

        // Get indexes
        const allIndexes = await this.listIndexes(db);
        const indexes = allIndexes.filter(
            (idx) => idx.tableName === name && idx.tableSchema === schema,
        );

        // Get foreign keys
        const allFks = await this.listForeignKeys(db);
        const foreignKeys = allFks.filter(
            (fk) => fk.tableName === name && fk.tableSchema === schema,
        );

        return {
            name,
            schema,
            columns,
            indexes,
            foreignKeys,
            rowCountEstimate: rowResult.rows[0]?.row_count ?? undefined,
        };

    },

    async getViewDetail(
        db: Kysely<unknown>,
        name: string,
        schema = 'dbo',
    ): Promise<ViewDetail | null> {

        // Check if view exists
        const viewCheck = await sql<{ object_id: number }>`
            SELECT v.object_id
            FROM sys.views v
            JOIN sys.schemas s ON v.schema_id = s.schema_id
            WHERE v.name = ${name}
            AND s.name = ${schema}
        `.execute(db);

        if (viewCheck.rows.length === 0) {

            return null;

        }

        // Get columns
        const columnsResult = await sql<{
            column_name: string;
            data_type: string;
            is_nullable: boolean;
            ordinal_position: number;
        }>`
            SELECT
                c.name as column_name,
                TYPE_NAME(c.user_type_id) as data_type,
                c.is_nullable,
                c.column_id as ordinal_position
            FROM sys.columns c
            JOIN sys.views v ON c.object_id = v.object_id
            JOIN sys.schemas s ON v.schema_id = s.schema_id
            WHERE v.name = ${name}
            AND s.name = ${schema}
            ORDER BY c.column_id
        `.execute(db);

        // Get view definition
        const defResult = await sql<{ definition: string | null }>`
            SELECT OBJECT_DEFINITION(OBJECT_ID(${schema + '.' + name})) as definition
        `.execute(db);

        const columns: ColumnDetail[] = columnsResult.rows.map((row) => ({
            name: row.column_name,
            dataType: row.data_type,
            isNullable: row.is_nullable,
            isPrimaryKey: false,
            ordinalPosition: row.ordinal_position,
        }));

        return {
            name,
            schema,
            columns,
            definition: defResult.rows[0]?.definition ?? undefined,
            isUpdatable: false,
        };

    },

    async getProcedureDetail(
        db: Kysely<unknown>,
        name: string,
        schema = 'dbo',
    ): Promise<ProcedureDetail | null> {

        // Check if procedure exists and get definition
        const procResult = await sql<{ definition: string | null }>`
            SELECT OBJECT_DEFINITION(p.object_id) as definition
            FROM sys.procedures p
            JOIN sys.schemas s ON p.schema_id = s.schema_id
            WHERE p.name = ${name}
            AND s.name = ${schema}
        `.execute(db);

        const procRow = procResult.rows[0];

        if (!procRow) {

            return null;

        }

        // Get parameters
        const paramsResult = await sql<{
            parameter_name: string;
            data_type: string;
            is_output: boolean;
            ordinal_position: number;
            has_default: boolean;
        }>`
            SELECT
                pr.name as parameter_name,
                TYPE_NAME(pr.user_type_id) as data_type,
                pr.is_output,
                pr.parameter_id as ordinal_position,
                pr.has_default_value as has_default
            FROM sys.parameters pr
            JOIN sys.procedures p ON pr.object_id = p.object_id
            JOIN sys.schemas s ON p.schema_id = s.schema_id
            WHERE p.name = ${name}
            AND s.name = ${schema}
            AND pr.parameter_id > 0
            ORDER BY pr.parameter_id
        `.execute(db);

        const parameters: ParameterDetail[] = paramsResult.rows.map((row) => ({
            name: row.parameter_name.replace(/^@/, ''),
            dataType: row.data_type,
            mode: row.is_output ? 'OUT' : 'IN',
            ordinalPosition: row.ordinal_position,
        }));

        return {
            name,
            schema,
            parameters,
            definition: procRow.definition ?? undefined,
        };

    },

    async getFunctionDetail(
        db: Kysely<unknown>,
        name: string,
        schema = 'dbo',
    ): Promise<FunctionDetail | null> {

        // Check if function exists and get definition
        const funcResult = await sql<{
            definition: string | null;
            func_type: string;
        }>`
            SELECT
                OBJECT_DEFINITION(o.object_id) as definition,
                o.type as func_type
            FROM sys.objects o
            JOIN sys.schemas s ON o.schema_id = s.schema_id
            WHERE o.name = ${name}
            AND s.name = ${schema}
            AND o.type IN ('FN', 'IF', 'TF')
        `.execute(db);

        const funcRow = funcResult.rows[0];

        if (!funcRow) {

            return null;

        }

        // Get parameters
        const paramsResult = await sql<{
            parameter_name: string;
            data_type: string;
            ordinal_position: number;
        }>`
            SELECT
                pr.name as parameter_name,
                TYPE_NAME(pr.user_type_id) as data_type,
                pr.parameter_id as ordinal_position
            FROM sys.parameters pr
            JOIN sys.objects o ON pr.object_id = o.object_id
            JOIN sys.schemas s ON o.schema_id = s.schema_id
            WHERE o.name = ${name}
            AND s.name = ${schema}
            AND pr.parameter_id > 0
            ORDER BY pr.parameter_id
        `.execute(db);

        const parameters: ParameterDetail[] = paramsResult.rows.map((row) => ({
            name: row.parameter_name.replace(/^@/, ''),
            dataType: row.data_type,
            mode: 'IN',
            ordinalPosition: row.ordinal_position,
        }));

        const returnType = funcRow.func_type === 'FN'
            ? 'scalar'
            : funcRow.func_type === 'IF'
                ? 'inline table'
                : 'table';

        return {
            name,
            schema,
            parameters,
            returnType,
            definition: funcRow.definition ?? undefined,
        };

    },

    async getTypeDetail(
        db: Kysely<unknown>,
        name: string,
        schema = 'dbo',
    ): Promise<TypeDetail | null> {

        const result = await sql<{
            is_table_type: boolean;
            base_type: string | null;
        }>`
            SELECT
                t.is_table_type,
                TYPE_NAME(t.system_type_id) as base_type
            FROM sys.types t
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE t.name = ${name}
            AND s.name = ${schema}
            AND t.is_user_defined = 1
        `.execute(db);

        const row = result.rows[0];

        if (!row) {

            return null;

        }

        let attributes: ColumnDetail[] | undefined;

        if (row.is_table_type) {

            // Get table type columns
            const colsResult = await sql<{
                column_name: string;
                data_type: string;
                is_nullable: boolean;
                ordinal_position: number;
            }>`
                SELECT
                    c.name as column_name,
                    TYPE_NAME(c.user_type_id) as data_type,
                    c.is_nullable,
                    c.column_id as ordinal_position
                FROM sys.table_types tt
                JOIN sys.columns c ON tt.type_table_object_id = c.object_id
                JOIN sys.schemas s ON tt.schema_id = s.schema_id
                WHERE tt.name = ${name}
                AND s.name = ${schema}
                ORDER BY c.column_id
            `.execute(db);

            attributes = colsResult.rows.map((r) => ({
                name: r.column_name,
                dataType: r.data_type,
                isNullable: r.is_nullable,
                isPrimaryKey: false,
                ordinalPosition: r.ordinal_position,
            }));

        }

        return {
            name,
            schema,
            kind: row.is_table_type ? 'composite' : 'domain',
            attributes,
            baseType: row.base_type ?? undefined,
        };

    },

    async listTriggers(db: Kysely<unknown>): Promise<TriggerSummary[]> {

        const result = await sql<{
            trigger_name: string;
            schema_name: string;
            table_name: string;
            is_instead_of_trigger: boolean;
            is_disabled: boolean;
            type_desc: string;
        }>`
            SELECT
                t.name AS trigger_name,
                s.name AS schema_name,
                OBJECT_NAME(t.parent_id) AS table_name,
                t.is_instead_of_trigger,
                t.is_disabled,
                te.type_desc
            FROM sys.triggers t
            INNER JOIN sys.trigger_events te ON t.object_id = te.object_id
            INNER JOIN sys.tables tab ON t.parent_id = tab.object_id
            INNER JOIN sys.schemas s ON tab.schema_id = s.schema_id
            WHERE s.name NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
            ORDER BY s.name, table_name, t.name
        `.execute(db);

        // Group triggers by name
        const triggerMap = new Map<string, TriggerSummary>();

        for (const row of result.rows) {

            const key = `${row.schema_name}.${row.trigger_name}`;
            const event = row.type_desc as 'INSERT' | 'UPDATE' | 'DELETE';
            const existing = triggerMap.get(key);

            if (existing) {

                if (!existing.events.includes(event)) {

                    existing.events.push(event);

                }

            }
            else {

                triggerMap.set(key, {
                    name: row.trigger_name,
                    schema: row.schema_name,
                    tableName: row.table_name,
                    tableSchema: row.schema_name,
                    timing: row.is_instead_of_trigger ? 'INSTEAD OF' : 'AFTER',
                    events: [event],
                });

            }

        }

        return Array.from(triggerMap.values());

    },

    async listLocks(db: Kysely<unknown>): Promise<LockSummary[]> {

        const result = await sql<{
            request_session_id: number;
            resource_type: string;
            resource_description: string;
            request_mode: string;
            request_status: string;
        }>`
            SELECT
                request_session_id,
                resource_type,
                resource_description,
                request_mode,
                request_status
            FROM sys.dm_tran_locks
            WHERE resource_database_id = DB_ID()
            ORDER BY request_session_id
        `.execute(db);

        return result.rows.map((row) => ({
            pid: row.request_session_id,
            lockType: row.resource_type,
            objectName: row.resource_description || undefined,
            mode: row.request_mode,
            granted: row.request_status === 'GRANT',
        }));

    },

    async listConnections(db: Kysely<unknown>): Promise<ConnectionSummary[]> {

        const result = await sql<{
            session_id: number;
            login_name: string;
            host_name: string;
            program_name: string;
            status: string;
            login_time: Date;
        }>`
            SELECT
                s.session_id,
                s.login_name,
                s.host_name,
                s.program_name,
                s.status,
                s.login_time
            FROM sys.dm_exec_sessions s
            WHERE s.database_id = DB_ID()
            AND s.session_id != @@SPID
            ORDER BY s.login_time DESC
        `.execute(db);

        return result.rows.map((row) => ({
            pid: row.session_id,
            username: row.login_name,
            database: 'current',
            applicationName: row.program_name || undefined,
            clientAddress: row.host_name || undefined,
            backendStart: row.login_time,
            state: row.status,
        }));

    },

    async getTriggerDetail(
        db: Kysely<unknown>,
        name: string,
        schema = 'dbo',
    ): Promise<TriggerDetail | null> {

        const result = await sql<{
            trigger_name: string;
            table_name: string;
            is_instead_of_trigger: boolean;
            is_disabled: boolean;
            definition: string;
            type_desc: string;
        }>`
            SELECT
                t.name AS trigger_name,
                OBJECT_NAME(t.parent_id) AS table_name,
                t.is_instead_of_trigger,
                t.is_disabled,
                OBJECT_DEFINITION(t.object_id) AS definition,
                te.type_desc
            FROM sys.triggers t
            INNER JOIN sys.trigger_events te ON t.object_id = te.object_id
            INNER JOIN sys.tables tab ON t.parent_id = tab.object_id
            INNER JOIN sys.schemas s ON tab.schema_id = s.schema_id
            WHERE t.name = ${name}
            AND s.name = ${schema}
        `.execute(db);

        if (result.rows.length === 0) {

            return null;

        }

        const events = [...new Set(result.rows.map((r) => r.type_desc))];
        const row = result.rows[0]!;

        return {
            name: row.trigger_name,
            schema,
            tableName: row.table_name,
            tableSchema: schema,
            timing: row.is_instead_of_trigger ? 'INSTEAD OF' : 'AFTER',
            events,
            definition: row.definition,
            isEnabled: !row.is_disabled,
        };

    },

};
