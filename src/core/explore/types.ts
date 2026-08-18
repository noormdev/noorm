/**
 * Database schema exploration types.
 *
 * Defines metadata structures for browsing database objects
 * across PostgreSQL, MySQL, MSSQL, and SQLite dialects.
 */
import type { Kysely } from 'kysely';

/**
 * Database object categories that can be explored.
 */
export type ExploreCategory =
    | 'tables'
    | 'views'
    | 'procedures'
    | 'functions'
    | 'types'
    | 'indexes'
    | 'foreignKeys'
    | 'triggers'
    | 'locks'
    | 'connections';

/**
 * Overview counts for all categories.
 */
export interface ExploreOverview {

    tables: number;
    views: number;
    procedures: number;
    functions: number;
    types: number;
    indexes: number;
    foreignKeys: number;
    triggers: number;
    locks: number;
    connections: number;

}

// -----------------------------------------------------------------------------
// Summary types (for list views with brief info)
// -----------------------------------------------------------------------------

/**
 * Table summary for list display.
 */
export interface TableSummary {

    name: string;
    schema?: string;
    columnCount: number;
    rowCountEstimate?: number;

}

/**
 * View summary for list display.
 */
export interface ViewSummary {

    name: string;
    schema?: string;
    columnCount: number;
    isUpdatable: boolean;

}

/**
 * Stored procedure summary for list display.
 */
export interface ProcedureSummary {

    name: string;
    schema?: string;
    parameterCount: number;

}

/**
 * Function summary for list display.
 */
export interface FunctionSummary {

    name: string;
    schema?: string;
    parameterCount: number;
    returnType: string;

}

/**
 * Type/Enum summary for list display.
 */
export interface TypeSummary {

    name: string;
    schema?: string;
    kind: 'enum' | 'composite' | 'domain' | 'other';
    valueCount?: number;

}

/**
 * Index summary for list display.
 */
export interface IndexSummary {

    name: string;
    schema?: string;
    tableName: string;
    tableSchema?: string;
    columns: string[];
    isUnique: boolean;
    isPrimary: boolean;

}

/**
 * Foreign key summary for list display.
 */
export interface ForeignKeySummary {

    name: string;
    schema?: string;
    tableName: string;
    tableSchema?: string;
    columns: string[];
    referencedTable: string;
    referencedSchema?: string;
    referencedColumns: string[];
    onDelete?: string;
    onUpdate?: string;

}

/**
 * Trigger summary for list display.
 */
export interface TriggerSummary {

    name: string;
    schema?: string;
    tableName: string;
    tableSchema?: string;
    timing: 'BEFORE' | 'AFTER' | 'INSTEAD OF';
    events: ('INSERT' | 'UPDATE' | 'DELETE')[];

}

/**
 * Active lock summary for list display.
 */
export interface LockSummary {

    pid: number;
    lockType: string;
    objectName?: string;
    mode: string;
    granted: boolean;

}

/**
 * Active connection/session summary for list display.
 */
export interface ConnectionSummary {

    pid: number;
    username: string;
    database: string;
    applicationName?: string;
    clientAddress?: string;
    backendStart?: Date;
    state: string;

}

// -----------------------------------------------------------------------------
// Detail types (for full object views)
// -----------------------------------------------------------------------------

/**
 * Column detail for tables/views.
 */
export interface ColumnDetail {

    name: string;
    dataType: string;
    isNullable: boolean;
    defaultValue?: string;
    isPrimaryKey: boolean;
    ordinalPosition: number;

}

/**
 * Parameter detail for procedures/functions.
 */
export interface ParameterDetail {

    name: string;
    dataType: string;
    mode: 'IN' | 'OUT' | 'INOUT';
    defaultValue?: string;
    ordinalPosition: number;

}

/**
 * Full table detail.
 */
export interface TableDetail {

    name: string;
    schema?: string;
    columns: ColumnDetail[];
    indexes: IndexSummary[];
    foreignKeys: ForeignKeySummary[];
    rowCountEstimate?: number;

}

/**
 * Full view detail.
 */
export interface ViewDetail {

    name: string;
    schema?: string;
    columns: ColumnDetail[];
    definition?: string;
    isUpdatable: boolean;

}

/**
 * Full procedure detail.
 */
export interface ProcedureDetail {

    name: string;
    schema?: string;
    parameters: ParameterDetail[];
    definition?: string;

}

/**
 * Full function detail.
 */
export interface FunctionDetail {

    name: string;
    schema?: string;
    parameters: ParameterDetail[];
    returnType: string;
    definition?: string;
    language?: string;

}

/**
 * Full type detail.
 */
export interface TypeDetail {

    name: string;
    schema?: string;
    kind: 'enum' | 'composite' | 'domain' | 'other';
    values?: string[];
    attributes?: ColumnDetail[];
    baseType?: string;
    definition?: string;

}

/**
 * Full trigger detail.
 */
export interface TriggerDetail {

    name: string;
    schema?: string;
    tableName: string;
    tableSchema?: string;
    timing: string;
    events: string[];
    definition?: string;
    isEnabled: boolean;

}

// -----------------------------------------------------------------------------
// Row peek
// -----------------------------------------------------------------------------

/**
 * One page of a table's rows, as `readPeekRows` is asked for it.
 *
 * The key columns arrive already resolved rather than being looked up here:
 * `fetchDetail` has already reported which columns are the primary key, and a
 * second catalog query per peek would be paying twice for the same answer.
 *
 * Not part of `DialectExploreOperations`: the statement is the same on every
 * dialect and only its row cap differs, so it lives in one builder with one
 * branch rather than four near-identical methods.
 */
export interface RowPeekQuery {

    /** Table to read from, unquoted, exactly as the catalog reported it. */
    table: string;

    /** Schema qualifying `table`, where the dialect has one. */
    schema?: string;

    /**
     * Primary-key columns, in the order they should be sorted by. Empty reads
     * in whatever order the storage engine hands rows back, which is the only
     * thing a table without a primary key can offer.
     */
    keyColumns: string[];

    /** `desc` reads the tail; the caller re-reverses it for display. */
    direction: 'asc' | 'desc';

    /** Rows to read. Clamped by the dialect before it reaches the SQL. */
    limit: number;

}

// -----------------------------------------------------------------------------
// Dialect operations interface
// -----------------------------------------------------------------------------

/**
 * Dialect-specific explore operations.
 *
 * Each database dialect implements these methods to query
 * its system catalogs for schema metadata.
 */
export interface DialectExploreOperations {

    // List methods (return summaries for list views).
    //
    // `schema` narrows the query to one schema; omitted, the dialect's own
    // system-schema exclusions apply. It must reach the generated SQL rather
    // than being filtered afterwards — on MySQL a "schema" is a whole other
    // database, so post-filtering a `DATABASE()`-pinned result can only ever
    // return nothing.

    listTables(db: Kysely<unknown>, schema?: string): Promise<TableSummary[]>;
    listViews(db: Kysely<unknown>, schema?: string): Promise<ViewSummary[]>;
    listProcedures(db: Kysely<unknown>, schema?: string): Promise<ProcedureSummary[]>;
    listFunctions(db: Kysely<unknown>, schema?: string): Promise<FunctionSummary[]>;
    listTypes(db: Kysely<unknown>, schema?: string): Promise<TypeSummary[]>;
    listIndexes(db: Kysely<unknown>, schema?: string): Promise<IndexSummary[]>;
    listForeignKeys(db: Kysely<unknown>, schema?: string): Promise<ForeignKeySummary[]>;
    listTriggers(db: Kysely<unknown>, schema?: string): Promise<TriggerSummary[]>;
    listLocks(db: Kysely<unknown>): Promise<LockSummary[]>;
    listConnections(db: Kysely<unknown>): Promise<ConnectionSummary[]>;

    // Detail methods (return full object info)

    getTableDetail(
        db: Kysely<unknown>,
        name: string,
        schema?: string,
    ): Promise<TableDetail | null>;

    getViewDetail(
        db: Kysely<unknown>,
        name: string,
        schema?: string,
    ): Promise<ViewDetail | null>;

    getProcedureDetail(
        db: Kysely<unknown>,
        name: string,
        schema?: string,
    ): Promise<ProcedureDetail | null>;

    getFunctionDetail(
        db: Kysely<unknown>,
        name: string,
        schema?: string,
    ): Promise<FunctionDetail | null>;

    getTypeDetail(
        db: Kysely<unknown>,
        name: string,
        schema?: string,
    ): Promise<TypeDetail | null>;

    getTriggerDetail(
        db: Kysely<unknown>,
        name: string,
        schema?: string,
    ): Promise<TriggerDetail | null>;

}

// -----------------------------------------------------------------------------
// Union types for generic handling
// -----------------------------------------------------------------------------

/**
 * Any summary type.
 */
export type ExploreSummary =
    | TableSummary
    | ViewSummary
    | ProcedureSummary
    | FunctionSummary
    | TypeSummary
    | IndexSummary
    | ForeignKeySummary
    | TriggerSummary
    | LockSummary
    | ConnectionSummary;

/**
 * Any detail type.
 */
export type ExploreDetail =
    | TableDetail
    | ViewDetail
    | ProcedureDetail
    | FunctionDetail
    | TypeDetail
    | TriggerDetail;
