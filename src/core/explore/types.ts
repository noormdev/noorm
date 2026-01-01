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
// Dialect operations interface
// -----------------------------------------------------------------------------

/**
 * Dialect-specific explore operations.
 *
 * Each database dialect implements these methods to query
 * its system catalogs for schema metadata.
 */
export interface DialectExploreOperations {

    /**
     * Get counts of all object types.
     */
    getOverview(db: Kysely<unknown>): Promise<ExploreOverview>;

    // List methods (return summaries for list views)

    listTables(db: Kysely<unknown>): Promise<TableSummary[]>;
    listViews(db: Kysely<unknown>): Promise<ViewSummary[]>;
    listProcedures(db: Kysely<unknown>): Promise<ProcedureSummary[]>;
    listFunctions(db: Kysely<unknown>): Promise<FunctionSummary[]>;
    listTypes(db: Kysely<unknown>): Promise<TypeSummary[]>;
    listIndexes(db: Kysely<unknown>): Promise<IndexSummary[]>;
    listForeignKeys(db: Kysely<unknown>): Promise<ForeignKeySummary[]>;
    listTriggers(db: Kysely<unknown>): Promise<TriggerSummary[]>;
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
