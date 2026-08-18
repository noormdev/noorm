/**
 * Database schema exploration operations.
 *
 * High-level API for exploring database schema metadata.
 * Delegates to dialect-specific implementations.
 */
import { attempt } from '@logosdx/utils';

import type { Kysely } from 'kysely';
import type { Dialect } from '../connection/types.js';
import type { Channel, ConfigAccess } from '../policy/index.js';
import type {
    ColumnDetail,
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
import { readPeekRows } from './peek.js';
import { observer } from '../observer.js';
import { assertPolicy } from '../policy/index.js';

/**
 * Options for explore operations.
 */
export interface ExploreOptions {

    /** Include noorm internal tables (__noorm_*). Default: false */
    includeNoormTables?: boolean;

    /**
     * Restrict results to one schema. Rejected on SQLite, which has none —
     * silently returning an empty list would be indistinguishable from
     * "the schema is empty".
     */
    schema?: string;

}

/**
 * Check if a name is a noorm internal table.
 */
function isNoormTable(name: string | undefined | null): boolean {

    return name?.startsWith('__noorm_') ?? false;

}

/**
 * Guard the `schema` option against dialects that have no schema level.
 *
 * @throws when a schema is requested on SQLite
 */
function assertSchemaSupported(dialect: Dialect, schema?: string): void {

    if (schema && dialect === 'sqlite') {

        throw new Error(
            'SQLite has no schemas; drop the schema filter to explore this database',
        );

    }

}

/**
 * Fetch overview counts for all object categories.
 *
 * Counts come from the same listing calls the detail views use, so the
 * overview cannot disagree with what drilling in shows. An earlier
 * `getOverview()` fast path counted with separate `COUNT(*)` queries and
 * hardcoded triggers/locks/connections to zero, which meant the numbers
 * changed depending on an unrelated option.
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
    const { schema } = options;

    assertSchemaSupported(dialect, schema);

    const [lists, err] = await attempt(() => Promise.all([
        ops.listTables(db, schema),
        ops.listViews(db, schema),
        ops.listProcedures(db, schema),
        ops.listFunctions(db, schema),
        ops.listTypes(db, schema),
        ops.listIndexes(db, schema),
        ops.listForeignKeys(db, schema),
        ops.listTriggers(db, schema),
        ops.listLocks(db),
        ops.listConnections(db),
    ]));

    if (err) {

        observer.emit('error', { source: 'explore', error: err });
        throw err;

    }

    const [tables, views, procedures, functions, types, indexes, foreignKeys, triggers, locks, connections] = lists;
    const keep = (name: string | undefined) => options.includeNoormTables || !isNoormTable(name);

    return {
        tables: tables.filter((t) => keep(t.name)).length,
        views: views.length,
        procedures: procedures.length,
        functions: functions.length,
        types: types.length,
        indexes: indexes.filter((i) => keep(i.tableName)).length,
        foreignKeys: foreignKeys.filter((fk) => keep(fk.tableName)).length,
        triggers: triggers.filter((t) => keep(t.tableName)).length,
        locks: locks.length,
        connections: connections.length,
    };

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
    const { schema } = options;

    assertSchemaSupported(dialect, schema);

    const methodMap: Record<ExploreCategory, () => Promise<unknown>> = {
        tables: () => ops.listTables(db, schema),
        views: () => ops.listViews(db, schema),
        procedures: () => ops.listProcedures(db, schema),
        functions: () => ops.listFunctions(db, schema),
        types: () => ops.listTypes(db, schema),
        indexes: () => ops.listIndexes(db, schema),
        foreignKeys: () => ops.listForeignKeys(db, schema),
        triggers: () => ops.listTriggers(db, schema),
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
 * Rows a peek reads per set unless the caller sizes it itself.
 */
export const DEFAULT_PEEK_ROWS = 10;

/**
 * Policy inputs the row peek is checked against.
 *
 * Mandatory, and shaped like `SqlPolicyGate`, for the same reason: this is the
 * one explore operation that returns user data rather than catalog metadata, so
 * it is gated on `sql:read` where the rest of the module needs only `explore`.
 * A schema-only permission must not become a way to read rows.
 */
export interface RowPeekGate {

    /** Config name, which is what the policy message names. */
    configName: string;

    /** The config's per-channel access roles. */
    access: ConfigAccess;

    /** Who is driving — see `resolveChannel`. */
    channel: Channel;

}

/**
 * Both ends of a table, or the one set that is honest for it.
 *
 * `mode` is what the caller renders from, because "first N and last N" is only
 * one of three truthful answers:
 *
 * | mode | what came back | why |
 * |------|----------------|-----|
 * | `whole` | every row the table has, in `first` | it holds fewer than two pages |
 * | `ends` | `first` and `last`, disjoint | it holds more |
 * | `head` | `first` only, and there may be more | no primary key to order a tail by |
 */
export interface RowPeek {

    /** Which of the three shapes above this is. */
    mode: 'whole' | 'ends' | 'head';

    /** Column names in ordinal order, so both sets draw the same grid. */
    columns: string[];

    /** Primary-key columns the read was ordered by. Empty in `head` mode. */
    keyColumns: string[];

    /** The head of the table, or the whole of it in `whole` mode. */
    first: Record<string, unknown>[];

    /** The tail, in ascending order. Empty except in `ends` mode. */
    last: Record<string, unknown>[];

}

/**
 * A row's key as one comparable string.
 *
 * `String` per column before encoding, rather than stringifying the row object:
 * a driver may hand the same key back as a number in one result and a string in
 * another, and a Date or a Buffer has no JSON form worth comparing. Within one
 * table a key column holds one type, so a per-column `String` is enough to tell
 * two rows apart, and a primary key is unique so there are no ties to break.
 *
 * The parts are then encoded as a JSON array rather than joined by a
 * separator, because any separator a value could itself contain would make
 * `('a|b', 'c')` and `('a', 'b|c')` the same key.
 */
function keyOf(row: Record<string, unknown>, keyColumns: string[]): string {

    return JSON.stringify(keyColumns.map((column) => String(row[column])));

}

/**
 * Column names in ordinal order.
 */
function namesInOrder(columns: ColumnDetail[]): string[] {

    return [...columns]
        .sort((a, b) => a.ordinalPosition - b.ordinalPosition)
        .map((column) => column.name);

}

/**
 * Read the first and last rows of a table.
 *
 * Ordered by the primary key, which is the only order a relational table
 * actually has: `ORDER BY pk ASC` and `ORDER BY pk DESC` both ride the primary
 * key index, so reading the tail costs the same as reading the head no matter
 * how large the table is. Without a primary key there is no tail to read — the
 * alternative would be a full scan and a sort of an unbounded table to answer a
 * question the user asked casually — so the result comes back in `head` mode
 * and says so.
 *
 * The second query is skipped whenever the first one already answered: a page
 * that came back short is the whole table. When both run and their keys
 * intersect, the two sets are merged rather than drawn twice, because a table
 * holding fewer than two pages would otherwise show the same rows under both
 * headings with nothing to distinguish that from a table that really has them
 * at both ends.
 *
 * @param db - Kysely database instance
 * @param dialect - Database dialect
 * @param detail - The table, as `fetchDetail` returned it
 * @param gate - Policy inputs; the read is refused unless they allow `sql:read`
 * @param limit - Rows per set
 * @returns Both ends of the table, or the single set that is honest for it
 *
 * @throws Error carrying the policy's blockedReason when `gate` denies.
 *
 * @example
 * ```typescript
 * const peek = await fetchRowPeek(db, 'postgres', detail, {
 *     configName: 'local',
 *     access: config.access,
 *     channel: 'user',
 * });
 *
 * if (peek.mode === 'head') console.log('no primary key; no tail');
 * ```
 */
export async function fetchRowPeek(
    db: Kysely<unknown>,
    dialect: Dialect,
    detail: TableDetail,
    gate: RowPeekGate,
    limit: number = DEFAULT_PEEK_ROWS,
): Promise<RowPeek> {

    const columns = namesInOrder(detail.columns);
    const keyColumns = namesInOrder(detail.columns.filter((column) => column.isPrimaryKey));
    const base = { table: detail.name, schema: detail.schema, keyColumns, limit };

    assertPolicy(gate.channel, { name: gate.configName, access: gate.access }, 'sql:read');

    const [first, headErr] = await attempt(() => readPeekRows(db, dialect, { ...base, direction: 'asc' }));

    if (headErr) {

        observer.emit('error', { source: 'explore', error: headErr });
        throw headErr;

    }

    // A short page is the whole table, whether or not it has a key: there is
    // nothing left for a tail query to find.
    if (first.length < limit) {

        return { mode: 'whole', columns, keyColumns, first, last: [] };

    }

    if (keyColumns.length === 0) {

        return { mode: 'head', columns, keyColumns, first, last: [] };

    }

    const [tail, tailErr] = await attempt(() => readPeekRows(db, dialect, { ...base, direction: 'desc' }));

    if (tailErr) {

        observer.emit('error', { source: 'explore', error: tailErr });
        throw tailErr;

    }

    const last = [...tail].reverse();
    const headKeys = new Set(first.map((row) => keyOf(row, keyColumns)));
    const beyondHead = last.filter((row) => !headKeys.has(keyOf(row, keyColumns)));

    if (beyondHead.length === last.length) {

        return { mode: 'ends', columns, keyColumns, first, last };

    }

    // The ends met. Both sets are already ascending and the overlap is what
    // joins them, so appending the part the head did not cover reconstructs the
    // table in order.
    return { mode: 'whole', columns, keyColumns, first: [...first, ...beyondHead], last: [] };

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
