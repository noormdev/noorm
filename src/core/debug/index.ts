/**
 * Debug module exports.
 *
 * Operations for viewing and managing noorm internal tables.
 */

export {
    createDebugOperations,
    getTableInfo,
    getAllTableNames,
    NOORM_TABLE_INFO,
} from './operations.js';

export type {
    NoormTableInfo,
    TableCountResult,
    NoormTableRow,
    SortDirection,
    GetRowsOptions,
    DebugOperations,
} from './operations.js';
