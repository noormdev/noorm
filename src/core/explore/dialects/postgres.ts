/**
 * PostgreSQL schema exploration operations.
 *
 * Queries PostgreSQL system catalogs (pg_catalog, information_schema)
 * to retrieve database object metadata.
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
const EXCLUDED_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_toast'];

/**
 * PostgreSQL explore operations.
 */
export const postgresExploreOperations: DialectExploreOperations = {

    async getOverview(db: Kysely<unknown>): Promise<ExploreOverview> {

        // All counts exclude extension objects (pg_depend with deptype='e')
        const [tables, views, procedures, functions, types, indexes, foreignKeys] =
            await Promise.all([
                sql<{ count: string }>`
                    SELECT COUNT(*)::text as count
                    FROM information_schema.tables
                    WHERE table_schema NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
                    AND table_type = 'BASE TABLE'
                `.execute(db),

                sql<{ count: string }>`
                    SELECT COUNT(*)::text as count
                    FROM information_schema.views
                    WHERE table_schema NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
                `.execute(db),

                sql<{ count: string }>`
                    SELECT COUNT(*)::text as count
                    FROM pg_proc p
                    JOIN pg_namespace n ON p.pronamespace = n.oid
                    WHERE n.nspname NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
                    AND p.prokind = 'p'
                    AND NOT EXISTS (
                        SELECT 1 FROM pg_depend d
                        WHERE d.objid = p.oid
                        AND d.deptype = 'e'
                    )
                `.execute(db),

                sql<{ count: string }>`
                    SELECT COUNT(*)::text as count
                    FROM pg_proc p
                    JOIN pg_namespace n ON p.pronamespace = n.oid
                    WHERE n.nspname NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
                    AND p.prokind = 'f'
                    AND NOT EXISTS (
                        SELECT 1 FROM pg_depend d
                        WHERE d.objid = p.oid
                        AND d.deptype = 'e'
                    )
                `.execute(db),

                sql<{ count: string }>`
                    SELECT COUNT(*)::text as count
                    FROM pg_type t
                    JOIN pg_namespace n ON t.typnamespace = n.oid
                    WHERE n.nspname NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
                    AND t.typtype IN ('e', 'c', 'd')
                    AND NOT EXISTS (
                        SELECT 1 FROM pg_depend d
                        WHERE d.objid = t.oid
                        AND d.deptype = 'e'
                    )
                    AND NOT EXISTS (
                        SELECT 1 FROM pg_class c
                        WHERE c.reltype = t.oid
                        AND c.relkind IN ('r', 'v', 'm', 'p')
                    )
                `.execute(db),

                sql<{ count: string }>`
                    SELECT COUNT(*)::text as count
                    FROM pg_indexes
                    WHERE schemaname NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
                `.execute(db),

                sql<{ count: string }>`
                    SELECT COUNT(*)::text as count
                    FROM information_schema.table_constraints
                    WHERE constraint_type = 'FOREIGN KEY'
                    AND table_schema NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
                `.execute(db),
            ]);

        return {
            tables: parseInt(tables.rows[0]?.count ?? '0', 10),
            views: parseInt(views.rows[0]?.count ?? '0', 10),
            procedures: parseInt(procedures.rows[0]?.count ?? '0', 10),
            functions: parseInt(functions.rows[0]?.count ?? '0', 10),
            types: parseInt(types.rows[0]?.count ?? '0', 10),
            indexes: parseInt(indexes.rows[0]?.count ?? '0', 10),
            foreignKeys: parseInt(foreignKeys.rows[0]?.count ?? '0', 10),
            triggers: 0, // TODO: implement count
            locks: 0,    // TODO: implement count
            connections: 0, // TODO: implement count
        };

    },

    async listTables(db: Kysely<unknown>): Promise<TableSummary[]> {

        const result = await sql<{
            table_name: string;
            table_schema: string;
            column_count: string;
            row_estimate: string;
        }>`
            SELECT
                t.table_name,
                t.table_schema,
                (
                    SELECT COUNT(*)::text
                    FROM information_schema.columns c
                    WHERE c.table_schema = t.table_schema
                    AND c.table_name = t.table_name
                ) as column_count,
                COALESCE(
                    (
                        SELECT reltuples::bigint::text
                        FROM pg_class pc
                        JOIN pg_namespace pn ON pc.relnamespace = pn.oid
                        WHERE pc.relname = t.table_name
                        AND pn.nspname = t.table_schema
                    ),
                    '0'
                ) as row_estimate
            FROM information_schema.tables t
            WHERE t.table_schema NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
            AND t.table_type = 'BASE TABLE'
            ORDER BY t.table_schema, t.table_name
        `.execute(db);

        return result.rows.map((row) => ({
            name: row.table_name,
            schema: row.table_schema,
            columnCount: parseInt(row.column_count, 10),
            rowCountEstimate: parseInt(row.row_estimate, 10) > 0
                ? parseInt(row.row_estimate, 10)
                : undefined,
        }));

    },

    async listViews(db: Kysely<unknown>): Promise<ViewSummary[]> {

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
                    SELECT COUNT(*)::text
                    FROM information_schema.columns c
                    WHERE c.table_schema = v.table_schema
                    AND c.table_name = v.table_name
                ) as column_count,
                v.is_updatable
            FROM information_schema.views v
            WHERE v.table_schema NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
            ORDER BY v.table_schema, v.table_name
        `.execute(db);

        return result.rows.map((row) => ({
            name: row.table_name,
            schema: row.table_schema,
            columnCount: parseInt(row.column_count, 10),
            isUpdatable: row.is_updatable === 'YES',
        }));

    },

    async listProcedures(db: Kysely<unknown>): Promise<ProcedureSummary[]> {

        // Exclude procedures that belong to extensions (pg_depend with deptype='e')
        const result = await sql<{
            proname: string;
            nspname: string;
            param_count: string;
        }>`
            SELECT
                p.proname,
                n.nspname,
                p.pronargs::text as param_count
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
            AND p.prokind = 'p'
            AND NOT EXISTS (
                SELECT 1 FROM pg_depend d
                WHERE d.objid = p.oid
                AND d.deptype = 'e'
            )
            ORDER BY n.nspname, p.proname
        `.execute(db);

        return result.rows.map((row) => ({
            name: row.proname,
            schema: row.nspname,
            parameterCount: parseInt(row.param_count, 10),
        }));

    },

    async listFunctions(db: Kysely<unknown>): Promise<FunctionSummary[]> {

        // Exclude functions that belong to extensions (pg_depend with deptype='e')
        const result = await sql<{
            proname: string;
            nspname: string;
            param_count: string;
            return_type: string;
        }>`
            SELECT
                p.proname,
                n.nspname,
                p.pronargs::text as param_count,
                pg_get_function_result(p.oid) as return_type
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
            AND p.prokind = 'f'
            AND NOT EXISTS (
                SELECT 1 FROM pg_depend d
                WHERE d.objid = p.oid
                AND d.deptype = 'e'
            )
            ORDER BY n.nspname, p.proname
        `.execute(db);

        return result.rows.map((row) => ({
            name: row.proname,
            schema: row.nspname,
            parameterCount: parseInt(row.param_count, 10),
            returnType: row.return_type,
        }));

    },

    async listTypes(db: Kysely<unknown>): Promise<TypeSummary[]> {

        // Exclude:
        // - Types that belong to extensions (pg_depend with deptype='e')
        // - Auto-generated row types for tables/views (pg_class.reltype)
        const result = await sql<{
            typname: string;
            nspname: string;
            typtype: string;
            value_count: string | null;
        }>`
            SELECT
                t.typname,
                n.nspname,
                t.typtype,
                CASE
                    WHEN t.typtype = 'e' THEN (
                        SELECT COUNT(*)::text
                        FROM pg_enum e
                        WHERE e.enumtypid = t.oid
                    )
                    ELSE NULL
                END as value_count
            FROM pg_type t
            JOIN pg_namespace n ON t.typnamespace = n.oid
            WHERE n.nspname NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
            AND t.typtype IN ('e', 'c', 'd')
            AND NOT EXISTS (
                SELECT 1 FROM pg_depend d
                WHERE d.objid = t.oid
                AND d.deptype = 'e'
            )
            AND NOT EXISTS (
                SELECT 1 FROM pg_class c
                WHERE c.reltype = t.oid
                AND c.relkind IN ('r', 'v', 'm', 'p')
            )
            ORDER BY n.nspname, t.typname
        `.execute(db);

        return result.rows.map((row) => ({
            name: row.typname,
            schema: row.nspname,
            kind: row.typtype === 'e'
                ? 'enum'
                : row.typtype === 'c'
                    ? 'composite'
                    : row.typtype === 'd'
                        ? 'domain'
                        : 'other',
            valueCount: row.value_count ? parseInt(row.value_count, 10) : undefined,
        }));

    },

    async listIndexes(db: Kysely<unknown>): Promise<IndexSummary[]> {

        const result = await sql<{
            indexname: string;
            schemaname: string;
            tablename: string;
            indexdef: string;
        }>`
            SELECT
                indexname,
                schemaname,
                tablename,
                indexdef
            FROM pg_indexes
            WHERE schemaname NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
            ORDER BY schemaname, tablename, indexname
        `.execute(db);

        return result.rows.map((row) => {

            const isPrimary = row.indexdef.includes('PRIMARY KEY');
            const isUnique = row.indexdef.includes('UNIQUE') || isPrimary;

            // Extract columns from index definition
            const columnsMatch = row.indexdef.match(/\(([^)]+)\)/);
            const columns = columnsMatch?.[1]
                ? columnsMatch[1].split(',').map((c) => c.trim())
                : [];

            return {
                name: row.indexname,
                schema: row.schemaname,
                tableName: row.tablename,
                tableSchema: row.schemaname,
                columns,
                isUnique,
                isPrimary,
            };

        });

    },

    async listForeignKeys(db: Kysely<unknown>): Promise<ForeignKeySummary[]> {

        const result = await sql<{
            constraint_name: string;
            table_schema: string;
            table_name: string;
            column_name: string;
            foreign_table_schema: string;
            foreign_table_name: string;
            foreign_column_name: string;
            update_rule: string;
            delete_rule: string;
        }>`
            SELECT
                tc.constraint_name,
                tc.table_schema,
                tc.table_name,
                kcu.column_name,
                ccu.table_schema AS foreign_table_schema,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name,
                rc.update_rule,
                rc.delete_rule
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
                ON tc.constraint_name = ccu.constraint_name
                AND tc.table_schema = ccu.table_schema
            JOIN information_schema.referential_constraints rc
                ON tc.constraint_name = rc.constraint_name
                AND tc.table_schema = rc.constraint_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
            ORDER BY tc.table_schema, tc.table_name, tc.constraint_name
        `.execute(db);

        // Group by constraint name (multi-column FKs)
        const fkMap = new Map<string, ForeignKeySummary>();

        for (const row of result.rows) {

            const key = `${row.table_schema}.${row.constraint_name}`;

            if (!fkMap.has(key)) {

                fkMap.set(key, {
                    name: row.constraint_name,
                    schema: row.table_schema,
                    tableName: row.table_name,
                    tableSchema: row.table_schema,
                    columns: [row.column_name],
                    referencedTable: row.foreign_table_name,
                    referencedSchema: row.foreign_table_schema,
                    referencedColumns: [row.foreign_column_name],
                    onUpdate: row.update_rule,
                    onDelete: row.delete_rule,
                });

            }
            else {

                const fk = fkMap.get(key)!;
                fk.columns.push(row.column_name);
                fk.referencedColumns.push(row.foreign_column_name);

            }

        }

        return Array.from(fkMap.values());

    },

    async getTableDetail(
        db: Kysely<unknown>,
        name: string,
        schema = 'public',
    ): Promise<TableDetail | null> {

        // Get columns
        const columnsResult = await sql<{
            column_name: string;
            data_type: string;
            is_nullable: string;
            column_default: string | null;
            ordinal_position: string;
        }>`
            SELECT
                column_name,
                data_type,
                is_nullable,
                column_default,
                ordinal_position::text
            FROM information_schema.columns
            WHERE table_schema = ${schema}
            AND table_name = ${name}
            ORDER BY ordinal_position
        `.execute(db);

        if (columnsResult.rows.length === 0) {

            return null;

        }

        // Get primary key columns
        const pkResult = await sql<{ column_name: string }>`
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = ${schema}
            AND tc.table_name = ${name}
        `.execute(db);

        const pkColumns = new Set(pkResult.rows.map((r) => r.column_name));

        // Get row estimate
        const rowEstimateResult = await sql<{ reltuples: string }>`
            SELECT reltuples::bigint::text
            FROM pg_class pc
            JOIN pg_namespace pn ON pc.relnamespace = pn.oid
            WHERE pc.relname = ${name}
            AND pn.nspname = ${schema}
        `.execute(db);

        const rowEstimate = parseInt(rowEstimateResult.rows[0]?.reltuples ?? '0', 10);

        const columns: ColumnDetail[] = columnsResult.rows.map((row) => ({
            name: row.column_name,
            dataType: row.data_type,
            isNullable: row.is_nullable === 'YES',
            defaultValue: row.column_default ?? undefined,
            isPrimaryKey: pkColumns.has(row.column_name),
            ordinalPosition: parseInt(row.ordinal_position, 10),
        }));

        // Get indexes for this table
        const allIndexes = await this.listIndexes(db);
        const indexes = allIndexes.filter(
            (idx) => idx.tableName === name && idx.tableSchema === schema,
        );

        // Get foreign keys for this table
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
            rowCountEstimate: rowEstimate > 0 ? rowEstimate : undefined,
        };

    },

    async getViewDetail(
        db: Kysely<unknown>,
        name: string,
        schema = 'public',
    ): Promise<ViewDetail | null> {

        // Get view info
        const viewResult = await sql<{
            is_updatable: string;
            view_definition: string | null;
        }>`
            SELECT is_updatable, view_definition
            FROM information_schema.views
            WHERE table_schema = ${schema}
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
            ordinal_position: string;
        }>`
            SELECT
                column_name,
                data_type,
                is_nullable,
                column_default,
                ordinal_position::text
            FROM information_schema.columns
            WHERE table_schema = ${schema}
            AND table_name = ${name}
            ORDER BY ordinal_position
        `.execute(db);

        const columns: ColumnDetail[] = columnsResult.rows.map((row) => ({
            name: row.column_name,
            dataType: row.data_type,
            isNullable: row.is_nullable === 'YES',
            defaultValue: row.column_default ?? undefined,
            isPrimaryKey: false,
            ordinalPosition: parseInt(row.ordinal_position, 10),
        }));

        const viewRow = viewResult.rows[0];

        return {
            name,
            schema,
            columns,
            definition: viewRow?.view_definition ?? undefined,
            isUpdatable: viewRow?.is_updatable === 'YES',
        };

    },

    async getProcedureDetail(
        db: Kysely<unknown>,
        name: string,
        schema = 'public',
    ): Promise<ProcedureDetail | null> {

        const result = await sql<{
            oid: string;
            prosrc: string;
        }>`
            SELECT p.oid::text, p.prosrc
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = ${schema}
            AND p.proname = ${name}
            AND p.prokind = 'p'
        `.execute(db);

        const procRow = result.rows[0];

        if (!procRow) {

            return null;

        }

        const oid = procRow.oid;

        // Get parameters
        const paramsResult = await sql<{
            parameter_name: string | null;
            data_type: string;
            parameter_mode: string;
            ordinal_position: string;
            parameter_default: string | null;
        }>`
            SELECT
                parameter_name,
                data_type,
                parameter_mode,
                ordinal_position::text,
                parameter_default
            FROM information_schema.parameters
            WHERE specific_schema = ${schema}
            AND specific_name = ${name || sql.raw(`'_' || ${oid}`)}
            ORDER BY ordinal_position
        `.execute(db);

        const parameters: ParameterDetail[] = paramsResult.rows.map((row) => ({
            name: row.parameter_name ?? `$${row.ordinal_position}`,
            dataType: row.data_type,
            mode: row.parameter_mode as 'IN' | 'OUT' | 'INOUT',
            defaultValue: row.parameter_default ?? undefined,
            ordinalPosition: parseInt(row.ordinal_position, 10),
        }));

        return {
            name,
            schema,
            parameters,
            definition: procRow.prosrc,
        };

    },

    async getFunctionDetail(
        db: Kysely<unknown>,
        name: string,
        schema = 'public',
    ): Promise<FunctionDetail | null> {

        const result = await sql<{
            oid: string;
            prosrc: string;
            return_type: string;
        }>`
            SELECT
                p.oid::text,
                p.prosrc,
                pg_get_function_result(p.oid) as return_type
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = ${schema}
            AND p.proname = ${name}
            AND p.prokind = 'f'
        `.execute(db);

        const funcRow = result.rows[0];

        if (!funcRow) {

            return null;

        }

        const oid = funcRow.oid;

        // Get parameters
        const paramsResult = await sql<{
            parameter_name: string | null;
            data_type: string;
            parameter_mode: string;
            ordinal_position: string;
            parameter_default: string | null;
        }>`
            SELECT
                parameter_name,
                data_type,
                parameter_mode,
                ordinal_position::text,
                parameter_default
            FROM information_schema.parameters
            WHERE specific_schema = ${schema}
            AND specific_name = ${name || sql.raw(`'_' || ${oid}`)}
            AND parameter_mode IN ('IN', 'INOUT')
            ORDER BY ordinal_position
        `.execute(db);

        const parameters: ParameterDetail[] = paramsResult.rows.map((row) => ({
            name: row.parameter_name ?? `$${row.ordinal_position}`,
            dataType: row.data_type,
            mode: row.parameter_mode as 'IN' | 'OUT' | 'INOUT',
            defaultValue: row.parameter_default ?? undefined,
            ordinalPosition: parseInt(row.ordinal_position, 10),
        }));

        return {
            name,
            schema,
            parameters,
            returnType: funcRow.return_type,
            definition: funcRow.prosrc,
        };

    },

    async getTypeDetail(
        db: Kysely<unknown>,
        name: string,
        schema = 'public',
    ): Promise<TypeDetail | null> {

        const result = await sql<{
            oid: string;
            typtype: string;
            basetype: string | null;
        }>`
            SELECT
                t.oid::text,
                t.typtype,
                CASE
                    WHEN t.typtype = 'd' THEN pg_catalog.format_type(t.typbasetype, t.typtypmod)
                    ELSE NULL
                END as basetype
            FROM pg_type t
            JOIN pg_namespace n ON t.typnamespace = n.oid
            WHERE n.nspname = ${schema}
            AND t.typname = ${name}
            AND t.typtype IN ('e', 'c', 'd')
        `.execute(db);

        const typeRow = result.rows[0];

        if (!typeRow) {

            return null;

        }

        const kind = typeRow.typtype === 'e'
            ? 'enum'
            : typeRow.typtype === 'c'
                ? 'composite'
                : typeRow.typtype === 'd'
                    ? 'domain'
                    : 'other';

        let values: string[] | undefined;
        let attributes: ColumnDetail[] | undefined;

        if (kind === 'enum') {

            const enumResult = await sql<{ enumlabel: string }>`
                SELECT enumlabel
                FROM pg_enum
                WHERE enumtypid = ${typeRow.oid}::oid
                ORDER BY enumsortorder
            `.execute(db);

            values = enumResult.rows.map((r) => r.enumlabel);

        }
        else if (kind === 'composite') {

            const attrResult = await sql<{
                attname: string;
                typname: string;
                attnotnull: boolean;
                attnum: string;
            }>`
                SELECT
                    a.attname,
                    t.typname,
                    a.attnotnull,
                    a.attnum::text
                FROM pg_attribute a
                JOIN pg_type t ON a.atttypid = t.oid
                WHERE a.attrelid = ${typeRow.oid}::oid::regclass
                AND a.attnum > 0
                ORDER BY a.attnum
            `.execute(db);

            attributes = attrResult.rows.map((r) => ({
                name: r.attname,
                dataType: r.typname,
                isNullable: !r.attnotnull,
                isPrimaryKey: false,
                ordinalPosition: parseInt(r.attnum, 10),
            }));

        }

        return {
            name,
            schema,
            kind,
            values,
            attributes,
            baseType: typeRow.basetype ?? undefined,
        };

    },

    async listTriggers(db: Kysely<unknown>): Promise<TriggerSummary[]> {

        const result = await sql<{
            trigger_name: string;
            trigger_schema: string;
            event_object_table: string;
            event_object_schema: string;
            action_timing: string;
            event_manipulation: string;
        }>`
            SELECT DISTINCT
                trigger_name,
                trigger_schema,
                event_object_table,
                event_object_schema,
                action_timing,
                event_manipulation
            FROM information_schema.triggers
            WHERE trigger_schema NOT IN (${sql.join(EXCLUDED_SCHEMAS)})
            ORDER BY trigger_schema, event_object_table, trigger_name
        `.execute(db);

        // Group by trigger name to combine events
        const triggerMap = new Map<string, TriggerSummary>();

        for (const row of result.rows) {

            const key = `${row.trigger_schema}.${row.trigger_name}`;
            const existing = triggerMap.get(key);

            if (existing) {

                existing.events.push(row.event_manipulation as 'INSERT' | 'UPDATE' | 'DELETE');

            }
            else {

                triggerMap.set(key, {
                    name: row.trigger_name,
                    schema: row.trigger_schema,
                    tableName: row.event_object_table,
                    tableSchema: row.event_object_schema,
                    timing: row.action_timing as 'BEFORE' | 'AFTER' | 'INSTEAD OF',
                    events: [row.event_manipulation as 'INSERT' | 'UPDATE' | 'DELETE'],
                });

            }

        }

        return Array.from(triggerMap.values());

    },

    async listLocks(db: Kysely<unknown>): Promise<LockSummary[]> {

        const result = await sql<{
            pid: number;
            locktype: string;
            relation: string | null;
            mode: string;
            granted: boolean;
        }>`
            SELECT
                l.pid,
                l.locktype,
                l.relation::regclass::text as relation,
                l.mode,
                l.granted
            FROM pg_locks l
            WHERE l.locktype != 'virtualxid'
            ORDER BY l.pid, l.locktype
        `.execute(db);

        return result.rows.map((row) => ({
            pid: row.pid,
            lockType: row.locktype,
            objectName: row.relation ?? undefined,
            mode: row.mode,
            granted: row.granted,
        }));

    },

    async listConnections(db: Kysely<unknown>): Promise<ConnectionSummary[]> {

        const result = await sql<{
            pid: number;
            usename: string;
            datname: string;
            application_name: string;
            client_addr: string | null;
            backend_start: Date;
            state: string;
        }>`
            SELECT
                pid,
                usename,
                datname,
                application_name,
                client_addr::text,
                backend_start,
                COALESCE(state, 'unknown') as state
            FROM pg_stat_activity
            WHERE datname = current_database()
            AND pid != pg_backend_pid()
            ORDER BY backend_start DESC
        `.execute(db);

        return result.rows.map((row) => ({
            pid: row.pid,
            username: row.usename,
            database: row.datname,
            applicationName: row.application_name || undefined,
            clientAddress: row.client_addr ?? undefined,
            backendStart: row.backend_start,
            state: row.state,
        }));

    },

    async getTriggerDetail(
        db: Kysely<unknown>,
        name: string,
        schema = 'public',
    ): Promise<TriggerDetail | null> {

        const result = await sql<{
            trigger_name: string;
            event_object_table: string;
            action_timing: string;
            event_manipulation: string;
            action_statement: string;
        }>`
            SELECT
                trigger_name,
                event_object_table,
                action_timing,
                event_manipulation,
                action_statement
            FROM information_schema.triggers
            WHERE trigger_name = ${name}
            AND trigger_schema = ${schema}
        `.execute(db);

        if (result.rows.length === 0) {

            return null;

        }

        const events = result.rows.map((r) => r.event_manipulation);
        const row = result.rows[0]!;

        return {
            name: row.trigger_name,
            schema,
            tableName: row.event_object_table,
            tableSchema: schema,
            timing: row.action_timing,
            events,
            definition: row.action_statement,
            isEnabled: true, // PostgreSQL triggers are always enabled when they exist
        };

    },

};
