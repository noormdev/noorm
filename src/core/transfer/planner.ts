/**
 * Transfer planner.
 *
 * Analyzes source database schema and builds a transfer plan
 * with tables in dependency order (respecting foreign keys).
 */
import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';

import type { Kysely } from 'kysely';
import type { Dialect } from '../connection/types.js';
import type { DualConnectionContext } from '../db/dual.js';
import type { NoormDatabase } from '../shared/tables.js';
import type { TransferOptions, TransferPlan, TransferTablePlan } from './types.js';

import { observer } from '../observer.js';
import { isSameServer } from './same-server.js';
import { isTransferSupported } from './dialects/index.js';
import { buildDtSchema } from '../dt/schema.js';

/**
 * Table metadata for planning.
 */
interface TableMeta {

    name: string;
    schema?: string;
    rowCount: number;
    hasIdentity: boolean;
    identityColumn?: string;
    primaryKey: string[];
    columns: string[];

}

/**
 * FK relationship for dependency graph.
 */
interface FKRelation {

    fromTable: string;
    toTable: string;

}

/**
 * Build transfer plan from source and destination databases.
 *
 * Analyzes schemas, builds dependency graph, and returns ordered table list.
 *
 * @param ctx - Dual connection context
 * @param options - Transfer options
 * @returns Transfer plan or error
 */
export async function planTransfer(
    ctx: DualConnectionContext,
    options: TransferOptions = {},
): Promise<[TransferPlan | null, Error | null]> {

    observer.emit('transfer:planning', {
        source: ctx.source.config.name,
        destination: ctx.destination.config.name,
    });

    const { dialect } = ctx.source;

    // Validate dialect support
    if (!isTransferSupported(dialect)) {

        return [null, new Error(`Transfer not supported for dialect: ${dialect}`)];

    }

    const crossDialect = ctx.source.dialect !== ctx.destination.dialect;

    // Validate both dialects are supported
    if (!isTransferSupported(ctx.destination.dialect)) {

        return [null, new Error(`Transfer not supported for dialect: ${ctx.destination.dialect}`)];

    }

    const warnings: string[] = [];

    if (crossDialect) {

        warnings.push(`Cross-dialect transfer: ${ctx.source.dialect} → ${ctx.destination.dialect}. Type conversion will be applied.`);

    }

    // Get all user tables from source
    const [allTables, tablesErr] = await listUserTables(ctx.source.db, dialect, options);

    if (tablesErr) {

        return [null, tablesErr];

    }

    // Get FK relationships
    const [fkRelations, fkErr] = await getForeignKeyRelations(ctx.source.db, dialect);

    if (fkErr) {

        return [null, fkErr];

    }

    // Build dependency map
    const dependencyMap = buildDependencyMap(allTables, fkRelations);

    // Topological sort for insert order
    const [sortedNames, sortErr] = topologicalSort(allTables.map((t) => t.name), dependencyMap);

    if (sortErr) {

        // Circular dependency detected
        warnings.push(`Circular FK dependency detected: ${sortErr.message}. Using original order.`);

    }

    // Build table plans in sorted order
    const tablesByName: { [key: string]: TableMeta } = {};

    for (const t of allTables) {

        tablesByName[t.name] = t;

    }

    const orderedNames = sortErr ? allTables.map((t) => t.name) : sortedNames;
    const tablePlans: TransferTablePlan[] = [];

    for (const name of orderedNames) {

        const meta = tablesByName[name];

        if (!meta) continue;

        tablePlans.push({
            name: meta.name,
            schema: meta.schema,
            rowCount: meta.rowCount,
            hasIdentity: meta.hasIdentity,
            identityColumn: meta.identityColumn,
            primaryKey: meta.primaryKey,
            columns: meta.columns,
            dependsOn: dependencyMap.get(name) ?? [],
        });

    }

    // Check destination schema compatibility. Probing with the *source*
    // dialect aborted every cross-dialect transfer here — postgres catalog
    // SQL against MySQL and vice versa — so the whole crossDialect path was
    // unreachable.
    const [destTables, destErr] = await listUserTables(
        ctx.destination.db,
        ctx.destination.dialect,
        { tables: options.tables },
    );

    if (destErr) {

        return [null, new Error(`Failed to read destination schema: ${destErr.message}`)];

    }

    const destTableNames = new Set(destTables.map((t) => t.name));

    for (const plan of tablePlans) {

        if (!destTableNames.has(plan.name)) {

            warnings.push(`Table "${plan.name}" exists in source but not destination`);

        }

    }

    // For cross-dialect transfers, build column type info for each table
    if (crossDialect) {

        for (const tablePlan of tablePlans) {

            const [dtSchema] = await buildDtSchema({
                db: ctx.source.db,
                dialect: ctx.source.dialect,
                tableName: tablePlan.name,
                schema: tablePlan.schema,
            });

            if (dtSchema) {

                tablePlan.columnTypes = dtSchema.columns;

            }

        }

    }

    // Detect same-server (only meaningful for same-dialect)
    const sameServer = crossDialect
        ? false
        : isSameServer(ctx.source.config.connection, ctx.destination.config.connection);

    const estimatedRows = tablePlans.reduce((sum, t) => sum + t.rowCount, 0);

    const plan: TransferPlan = {
        tables: tablePlans,
        sameServer,
        estimatedRows,
        warnings,
        crossDialect,
        sourceDialect: ctx.source.dialect,
        destinationDialect: ctx.destination.dialect,
    };

    observer.emit('transfer:plan:ready', {
        sameServer,
        tableCount: tablePlans.length,
        estimatedRows,
        warnings,
    });

    return [plan, null];

}

/**
 * List user tables (excluding noorm internal tables).
 */
async function listUserTables(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    options: TransferOptions = {},
): Promise<[TableMeta[], Error | null]> {

    const [tables, err] = await attempt(() => queryTables(db, dialect));

    if (err) {

        return [[], err];

    }

    // Drop noorm's own tracking tables, both spellings. MySQL and SQLite keep
    // the `__noorm_` prefix in the default schema; on PostgreSQL and SQL Server
    // schema migration v2 moved them into a dedicated `noorm` schema under
    // clean names (`change`, `vault`, `identities`), where the prefix test
    // matches nothing. Missing the schema let a transfer copy the encrypted
    // vault and the identity table into the destination. Explore and teardown
    // already exclude the schema at the dialect layer.
    let filtered = tables.filter(
        (t) => !t.name.startsWith('__noorm_') && t.schema !== 'noorm',
    );

    if (options.tables && options.tables.length > 0) {

        const requested = new Set(options.tables);
        filtered = filtered.filter((t) => requested.has(t.name));

    }

    return [filtered, null];

}

/**
 * Query table metadata based on dialect.
 */
async function queryTables(db: Kysely<NoormDatabase>, dialect: Dialect): Promise<TableMeta[]> {

    switch (dialect) {

    case 'postgres':
        return queryPostgresTables(db);

    case 'mysql':
        return queryMysqlTables(db);

    case 'mssql':
        return queryMssqlTables(db);

    default:
        return [];

    }

}

/**
 * Query PostgreSQL table metadata.
 */
async function queryPostgresTables(db: Kysely<NoormDatabase>): Promise<TableMeta[]> {

    const result = await sql<{
        table_name: string;
        table_schema: string;
        row_estimate: string;
        column_names: string;
        identity_column: string | null;
        pk_columns: string | null;
    }>`
        SELECT
            t.table_name,
            t.table_schema,
            COALESCE(c.reltuples::bigint::text, '0') as row_estimate,
            (
                SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
                FROM information_schema.columns col
                WHERE col.table_schema = t.table_schema
                AND col.table_name = t.table_name
            ) as column_names,
            (
                SELECT column_name
                FROM information_schema.columns col
                WHERE col.table_schema = t.table_schema
                AND col.table_name = t.table_name
                AND (col.column_default LIKE 'nextval%' OR col.is_identity = 'YES')
                LIMIT 1
            ) as identity_column,
            (
                SELECT string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position)
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                    AND tc.table_schema = kcu.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY'
                AND tc.table_schema = t.table_schema
                AND tc.table_name = t.table_name
            ) as pk_columns
        FROM information_schema.tables t
        LEFT JOIN pg_class c ON c.relname = t.table_name
        LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
        WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_schema, t.table_name
    `.execute(db);

    return result.rows.map((row) => ({
        name: row.table_name,
        schema: row.table_schema,
        rowCount: Math.max(0, parseInt(row.row_estimate, 10)),
        hasIdentity: row.identity_column !== null,
        identityColumn: row.identity_column ?? undefined,
        primaryKey: row.pk_columns ? row.pk_columns.split(',') : [],
        columns: row.column_names ? row.column_names.split(',') : [],
    }));

}

/**
 * Query MySQL table metadata.
 */
async function queryMysqlTables(db: Kysely<NoormDatabase>): Promise<TableMeta[]> {

    const result = await sql<{
        table_name: string;
        row_estimate: string;
        column_names: string;
        identity_column: string | null;
        pk_columns: string | null;
    }>`
        SELECT
            t.TABLE_NAME as table_name,
            t.TABLE_ROWS as row_estimate,
            (
                SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION)
                FROM INFORMATION_SCHEMA.COLUMNS c
                WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA
                AND c.TABLE_NAME = t.TABLE_NAME
            ) as column_names,
            (
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS c
                WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA
                AND c.TABLE_NAME = t.TABLE_NAME
                AND c.EXTRA LIKE '%auto_increment%'
                LIMIT 1
            ) as identity_column,
            (
                SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION)
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                WHERE kcu.TABLE_SCHEMA = t.TABLE_SCHEMA
                AND kcu.TABLE_NAME = t.TABLE_NAME
                AND kcu.CONSTRAINT_NAME = 'PRIMARY'
            ) as pk_columns
        FROM INFORMATION_SCHEMA.TABLES t
        WHERE t.TABLE_SCHEMA = DATABASE()
        AND t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY t.TABLE_NAME
    `.execute(db);

    return result.rows.map((row) => ({
        name: row.table_name,
        rowCount: Math.max(0, parseInt(row.row_estimate ?? '0', 10)),
        hasIdentity: row.identity_column !== null,
        identityColumn: row.identity_column ?? undefined,
        primaryKey: row.pk_columns ? row.pk_columns.split(',') : [],
        columns: row.column_names ? row.column_names.split(',') : [],
    }));

}

/**
 * Query MSSQL table metadata.
 */
async function queryMssqlTables(db: Kysely<NoormDatabase>): Promise<TableMeta[]> {

    const result = await sql<{
        table_name: string;
        table_schema: string;
        row_estimate: string;
        column_names: string;
        identity_column: string | null;
        pk_columns: string | null;
    }>`
        SELECT
            t.name as table_name,
            s.name as table_schema,
            COALESCE(SUM(p.rows), 0) as row_estimate,
            (
                SELECT STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY c.column_id)
                FROM sys.columns c
                WHERE c.object_id = t.object_id
            ) as column_names,
            (
                SELECT c.name
                FROM sys.columns c
                WHERE c.object_id = t.object_id
                AND c.is_identity = 1
            ) as identity_column,
            (
                SELECT STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal)
                FROM sys.indexes i
                JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                WHERE i.object_id = t.object_id
                AND i.is_primary_key = 1
            ) as pk_columns
        FROM sys.tables t
        JOIN sys.schemas s ON t.schema_id = s.schema_id
        LEFT JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
        WHERE t.is_ms_shipped = 0
        GROUP BY t.object_id, t.name, s.name
        ORDER BY s.name, t.name
    `.execute(db);

    return result.rows.map((row) => ({
        name: row.table_name,
        schema: row.table_schema,
        rowCount: Math.max(0, parseInt(row.row_estimate ?? '0', 10)),
        hasIdentity: row.identity_column !== null,
        identityColumn: row.identity_column ?? undefined,
        primaryKey: row.pk_columns ? row.pk_columns.split(',') : [],
        columns: row.column_names ? row.column_names.split(',') : [],
    }));

}

/**
 * Get foreign key relationships from source database.
 */
async function getForeignKeyRelations(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
): Promise<[FKRelation[], Error | null]> {

    let queryFn: () => Promise<FKRelation[]>;

    switch (dialect) {

    case 'postgres':
        queryFn = () => queryPostgresFKs(db);
        break;

    case 'mysql':
        queryFn = () => queryMysqlFKs(db);
        break;

    case 'mssql':
        queryFn = () => queryMssqlFKs(db);
        break;

    default:
        return [[], null];

    }

    const [relations, err] = await attempt(queryFn);

    if (err) {

        return [[], err];

    }

    return [relations, null];

}

/**
 * Query PostgreSQL foreign keys.
 */
async function queryPostgresFKs(db: Kysely<NoormDatabase>): Promise<FKRelation[]> {

    const result = await sql<{
        from_table: string;
        to_table: string;
    }>`
        SELECT DISTINCT
            tc.table_name as from_table,
            ccu.table_name as to_table
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name
            AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    `.execute(db);

    return result.rows.map((r) => ({
        fromTable: r.from_table,
        toTable: r.to_table,
    }));

}

/**
 * Query MySQL foreign keys.
 */
async function queryMysqlFKs(db: Kysely<NoormDatabase>): Promise<FKRelation[]> {

    const result = await sql<{
        from_table: string;
        to_table: string;
    }>`
        SELECT DISTINCT
            TABLE_NAME as from_table,
            REFERENCED_TABLE_NAME as to_table
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `.execute(db);

    return result.rows.map((r) => ({
        fromTable: r.from_table,
        toTable: r.to_table,
    }));

}

/**
 * Query MSSQL foreign keys.
 */
async function queryMssqlFKs(db: Kysely<NoormDatabase>): Promise<FKRelation[]> {

    const result = await sql<{
        from_table: string;
        to_table: string;
    }>`
        SELECT DISTINCT
            OBJECT_NAME(fk.parent_object_id) as from_table,
            OBJECT_NAME(fk.referenced_object_id) as to_table
        FROM sys.foreign_keys fk
    `.execute(db);

    return result.rows.map((r) => ({
        fromTable: r.from_table,
        toTable: r.to_table,
    }));

}

/**
 * Build dependency map from FK relations.
 *
 * Map key = table name, value = tables it depends on (must be inserted first)
 */
function buildDependencyMap(
    tables: TableMeta[],
    relations: FKRelation[],
): Map<string, string[]> {

    const tableNames = new Set(tables.map((t) => t.name));
    const deps = new Map<string, string[]>();

    // Initialize empty deps for all tables
    for (const name of tableNames) {

        deps.set(name, []);

    }

    // Add FK dependencies
    for (const rel of relations) {

        // Only add if both tables are in our list
        if (tableNames.has(rel.fromTable) && tableNames.has(rel.toTable)) {

            // fromTable depends on toTable (toTable must be inserted first)
            const current = deps.get(rel.fromTable) ?? [];

            if (!current.includes(rel.toTable) && rel.fromTable !== rel.toTable) {

                current.push(rel.toTable);
                deps.set(rel.fromTable, current);

            }

        }

    }

    return deps;

}

/**
 * Topological sort of tables based on dependencies.
 *
 * Returns tables in order where dependencies come before dependents.
 */
function topologicalSort(
    nodes: string[],
    deps: Map<string, string[]>,
): [string[], Error | null] {

    const result: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    function visit(node: string): Error | null {

        if (visited.has(node)) return null;

        if (visiting.has(node)) {

            return new Error(`Circular dependency involving "${node}"`);

        }

        visiting.add(node);

        const nodeDeps = deps.get(node) ?? [];

        for (const dep of nodeDeps) {

            const err = visit(dep);

            if (err) return err;

        }

        visiting.delete(node);
        visited.add(node);
        result.push(node);

        return null;

    }

    for (const node of nodes) {

        const err = visit(node);

        if (err) return [[], err];

    }

    return [result, null];

}
