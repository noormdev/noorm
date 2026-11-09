/**
 * Database schema exploration module.
 *
 * Provides APIs for browsing database metadata across PostgreSQL,
 * MySQL, MSSQL, and SQLite dialects.
 *
 * @example
 * ```typescript
 * import { fetchOverview, fetchList, fetchDetail } from './core/explore'
 * import type { ExploreGate } from './core/explore'
 *
 * const gate: ExploreGate = { configName: 'dev', access, channel: 'user' }
 *
 * // Get counts of all object types
 * const overview = await fetchOverview(db, 'postgres', { gate })
 *
 * // List all tables
 * const tables = await fetchList(db, 'postgres', 'tables', { gate })
 *
 * // Get full table detail
 * const detail = await fetchDetail(db, 'postgres', 'tables', 'users', { schema: 'public', gate })
 * ```
 */
export {
    DEFAULT_PEEK_ROWS,
    GATED_BY_CALLER,
    fetchOverview,
    fetchList,
    fetchDetail,
    fetchRowPeek,
    formatSummaryDescription,
    userGate,
} from './operations.js';

export type { DetailCategory, ExploreGate, ExploreOptions, RowPeek } from './operations.js';

export { getExploreOperations } from './dialects/index.js';

export { applyRowLimit, MAX_PEEK_ROWS, peekQuery, readPeekRows } from './peek.js';

export type {
    ExploreCategory,
    ExploreOverview,
    TableSummary,
    ViewSummary,
    ProcedureSummary,
    FunctionSummary,
    TypeSummary,
    IndexSummary,
    ForeignKeySummary,
    ColumnDetail,
    ParameterDetail,
    TableDetail,
    ViewDetail,
    ProcedureDetail,
    FunctionDetail,
    TypeDetail,
    DialectExploreOperations,
    ExploreSummary,
    ExploreDetail,
    RowPeekQuery,
} from './types.js';
