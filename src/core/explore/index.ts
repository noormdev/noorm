/**
 * Database schema exploration module.
 *
 * Provides APIs for browsing database metadata across PostgreSQL,
 * MySQL, MSSQL, and SQLite dialects.
 *
 * @example
 * ```typescript
 * import { fetchOverview, fetchList, fetchDetail } from './core/explore'
 *
 * // Get counts of all object types
 * const overview = await fetchOverview(db, 'postgres')
 *
 * // List all tables
 * const tables = await fetchList(db, 'postgres', 'tables')
 *
 * // Get full table detail
 * const detail = await fetchDetail(db, 'postgres', 'tables', 'users', 'public')
 * ```
 */
export {
    fetchOverview,
    fetchList,
    fetchDetail,
    formatSummaryDescription,
} from './operations.js';

export type { DetailCategory, ExploreOptions } from './operations.js';

export { getExploreOperations } from './dialects/index.js';

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
} from './types.js';
