/**
 * Database schema exploration operations.
 *
 * High-level API for exploring database schema metadata.
 * Delegates to dialect-specific implementations.
 */
import { attempt } from '@logosdx/utils';

import type { Kysely } from 'kysely';
import type { Dialect } from '../connection/types.js';
import type {
    ExploreCategory,
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
} from './types.js';
import { getExploreOperations } from './dialects/index.js';
import { observer } from '../observer.js';

/**
 * Options for explore operations.
 */
export interface ExploreOptions {

    /** Include noorm internal tables (__noorm_*). Default: false */
    includeNoormTables?: boolean;

}

/**
 * Check if a name is a noorm internal table.
 */
function isNoormTable(name: string | undefined | null): boolean {

    return name?.startsWith('__noorm_') ?? false;

}

/**
 * Fetch overview counts for all object categories.
 *
 * @param db - Kysely database instance
 * @param dialect - Database dialect
 * @param options - Explore options
 * @returns Overview with counts for each category
 *
 * @example
 * ```typescript
 * const overview = await fetchOverview(db, 'postgres')
 * console.log(`Tables: ${overview.tables}`)
 * ```
 */
export async function fetchOverview(
    db: Kysely<unknown>,
    dialect: Dialect,
    options: ExploreOptions = {},
): Promise<ExploreOverview> {

    const ops = getExploreOperations(dialect);

    // If excluding noorm tables, we need to fetch lists and count manually
    if (!options.includeNoormTables) {

        const [tables, views, procedures, functions, types, indexes, foreignKeys, triggers, locks, connections] =
            await Promise.all([
                ops.listTables(db),
                ops.listViews(db),
                ops.listProcedures(db),
                ops.listFunctions(db),
                ops.listTypes(db),
                ops.listIndexes(db),
                ops.listForeignKeys(db),
                ops.listTriggers(db),
                ops.listLocks(db),
                ops.listConnections(db),
            ]);

        return {
            tables: tables.filter((t) => !isNoormTable(t.name)).length,
            views: views.length,
            procedures: procedures.length,
            functions: functions.length,
            types: types.length,
            indexes: indexes.filter((i) => !isNoormTable(i.tableName)).length,
            foreignKeys: foreignKeys.filter((fk) => !isNoormTable(fk.tableName)).length,
            triggers: triggers.filter((t) => !isNoormTable(t.tableName)).length,
            locks: locks.length,
            connections: connections.length,
        };

    }

    const [result, err] = await attempt(() => ops.getOverview(db));

    if (err) {

        observer.emit('error', { source: 'explore', error: err });
        throw err;

    }

    return result;

}

/**
 * Category to list method mapping.
 */
type ListMethodMap = {
    tables: TableSummary[];
    views: ViewSummary[];
    procedures: ProcedureSummary[];
    functions: FunctionSummary[];
    types: TypeSummary[];
    indexes: IndexSummary[];
    foreignKeys: ForeignKeySummary[];
    triggers: TriggerSummary[];
    locks: LockSummary[];
    connections: ConnectionSummary[];
};

/**
 * Fetch list of items for a category.
 *
 * @param db - Kysely database instance
 * @param dialect - Database dialect
 * @param category - Object category to list
 * @param options - Explore options
 * @returns Array of summary items
 *
 * @example
 * ```typescript
 * const tables = await fetchList(db, 'postgres', 'tables')
 * for (const table of tables) {
 *     console.log(`${table.name}: ${table.columnCount} columns`)
 * }
 * ```
 */
export async function fetchList<C extends ExploreCategory>(
    db: Kysely<unknown>,
    dialect: Dialect,
    category: C,
    options: ExploreOptions = {},
): Promise<ListMethodMap[C]> {

    const ops = getExploreOperations(dialect);

    const methodMap: Record<ExploreCategory, () => Promise<unknown>> = {
        tables: () => ops.listTables(db),
        views: () => ops.listViews(db),
        procedures: () => ops.listProcedures(db),
        functions: () => ops.listFunctions(db),
        types: () => ops.listTypes(db),
        indexes: () => ops.listIndexes(db),
        foreignKeys: () => ops.listForeignKeys(db),
        triggers: () => ops.listTriggers(db),
        locks: () => ops.listLocks(db),
        connections: () => ops.listConnections(db),
    };

    const [result, err] = await attempt(() => methodMap[category]());

    if (err) {

        observer.emit('error', { source: 'explore', error: err });
        throw err;

    }

    // Filter out noorm tables unless explicitly included
    if (!options.includeNoormTables) {

        if (category === 'tables') {

            return (result as TableSummary[]).filter(
                (t) => !isNoormTable(t.name),
            ) as ListMethodMap[C];

        }

        if (category === 'indexes') {

            return (result as IndexSummary[]).filter(
                (i) => !isNoormTable(i.tableName),
            ) as ListMethodMap[C];

        }

        if (category === 'foreignKeys') {

            return (result as ForeignKeySummary[]).filter(
                (fk) => !isNoormTable(fk.tableName),
            ) as ListMethodMap[C];

        }

        if (category === 'triggers') {

            return (result as TriggerSummary[]).filter(
                (t) => !isNoormTable(t.tableName),
            ) as ListMethodMap[C];

        }

    }

    return result as ListMethodMap[C];

}

/**
 * Category to detail type mapping.
 */
type DetailTypeMap = {
    tables: TableDetail;
    views: ViewDetail;
    procedures: ProcedureDetail;
    functions: FunctionDetail;
    types: TypeDetail;
    triggers: TriggerDetail;
};

/**
 * Categories that support detail views.
 */
export type DetailCategory = keyof DetailTypeMap;

/**
 * Fetch full detail for a specific object.
 *
 * @param db - Kysely database instance
 * @param dialect - Database dialect
 * @param category - Object category
 * @param name - Object name
 * @param schema - Optional schema name
 * @returns Full detail or null if not found
 *
 * @example
 * ```typescript
 * const table = await fetchDetail(db, 'postgres', 'tables', 'users', 'public')
 * if (table) {
 *     for (const col of table.columns) {
 *         console.log(`${col.name}: ${col.dataType}`)
 *     }
 * }
 * ```
 */
export async function fetchDetail<C extends DetailCategory>(
    db: Kysely<unknown>,
    dialect: Dialect,
    category: C,
    name: string,
    schema?: string,
): Promise<DetailTypeMap[C] | null> {

    const ops = getExploreOperations(dialect);

    const methodMap: Record<DetailCategory, () => Promise<unknown>> = {
        tables: () => ops.getTableDetail(db, name, schema),
        views: () => ops.getViewDetail(db, name, schema),
        procedures: () => ops.getProcedureDetail(db, name, schema),
        functions: () => ops.getFunctionDetail(db, name, schema),
        types: () => ops.getTypeDetail(db, name, schema),
        triggers: () => ops.getTriggerDetail(db, name, schema),
    };

    const [result, err] = await attempt(() => methodMap[category]());

    if (err) {

        observer.emit('error', { source: 'explore', error: err });
        throw err;

    }

    return result as DetailTypeMap[C] | null;

}

/**
 * Format a summary description for list display.
 *
 * @param category - Object category
 * @param item - Summary item
 * @returns Formatted description string
 */
export function formatSummaryDescription(
    category: ExploreCategory | string,
    item: unknown,
): string {

    switch (category) {

    case 'tables': {

        const t = item as TableSummary;
        const parts = [`${t.columnCount} columns`];

        if (t.rowCountEstimate !== undefined) {

            parts.push(`~${formatNumber(t.rowCountEstimate)} rows`);

        }

        return parts.join(', ');

    }

    case 'views': {

        const v = item as ViewSummary;

        return `${v.columnCount} columns${v.isUpdatable ? ', updatable' : ''}`;

    }

    case 'procedures': {

        const p = item as ProcedureSummary;

        return `${p.parameterCount} parameters`;

    }

    case 'functions': {

        const f = item as FunctionSummary;

        return `${f.parameterCount} params → ${f.returnType}`;

    }

    case 'types': {

        const t = item as TypeSummary;

        if (t.kind === 'enum' && t.valueCount !== undefined) {

            return `enum (${t.valueCount} values)`;

        }

        return t.kind;

    }

    case 'indexes': {

        const i = item as IndexSummary;
        const parts = [`on ${i.tableName}`];

        if (i.isPrimary) {

            parts.push('PRIMARY');

        }
        else if (i.isUnique) {

            parts.push('UNIQUE');

        }

        return parts.join(', ');

    }

    case 'foreignKeys': {

        const fk = item as ForeignKeySummary;

        return `${fk.tableName} → ${fk.referencedTable}`;

    }

    case 'triggers': {

        const t = item as TriggerSummary;

        return `${t.timing} ${t.events.join('/')} on ${t.tableName}`;

    }

    case 'locks': {

        const l = item as LockSummary;

        return `${l.lockType} ${l.mode}${l.objectName ? ` on ${l.objectName}` : ''}${l.granted ? '' : ' (waiting)'}`;

    }

    case 'connections': {

        const c = item as ConnectionSummary;

        return `${c.username}@${c.database} (${c.state})`;

    }

    default:
        return '';

    }

}

/**
 * Format a number with thousands separators.
 */
function formatNumber(n: number): string {

    if (n >= 1_000_000) {

        return `${(n / 1_000_000).toFixed(1)}M`;

    }

    if (n >= 1_000) {

        return `${(n / 1_000).toFixed(1)}K`;

    }

    return n.toString();

}
