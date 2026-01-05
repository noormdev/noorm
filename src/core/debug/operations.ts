/**
 * Debug operations for viewing and managing noorm internal tables.
 *
 * Provides generic CRUD operations across all noorm tracking tables.
 * Intended for debugging and administrative purposes only.
 *
 * WHY: Allows developers to inspect and clean up internal state
 * when debugging noorm behavior or recovering from corrupt states.
 */
import type { Kysely } from 'kysely';

import { attempt } from '@logosdx/utils';

import { observer } from '../observer.js';
import { NOORM_TABLES, type NoormDatabase, type NoormTableName } from '../shared/index.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/**
 * Table metadata for display purposes.
 */
export interface NoormTableInfo {
    /** Table constant key */
    key: keyof typeof NOORM_TABLES;

    /** Actual table name */
    name: NoormTableName;

    /** Human-readable display name */
    displayName: string;

    /** Brief description of table purpose */
    description: string;
}

/**
 * Table row count result.
 */
export interface TableCountResult {
    /** Table name */
    table: NoormTableName;

    /** Number of rows */
    count: number;
}

/**
 * Generic row type for dynamic table access.
 */
export type NoormTableRow = Record<string, unknown>;

/**
 * Sort direction.
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Options for fetching table rows.
 */
export interface GetRowsOptions {
    /** Maximum number of rows to return */
    limit?: number;

    /** Column to sort by */
    sortColumn?: string;

    /** Sort direction */
    sortDirection?: SortDirection;
}

/**
 * Debug operations interface.
 */
export interface DebugOperations {
    /** Get row counts for all noorm tables */
    getTableCounts(): Promise<TableCountResult[]>;

    /** Get rows from a specific table */
    getTableRows(table: NoormTableName, options?: GetRowsOptions): Promise<NoormTableRow[]>;

    /** Get a single row by ID */
    getRowById(table: NoormTableName, id: number): Promise<NoormTableRow | null>;

    /** Delete a single row by ID */
    deleteRowById(table: NoormTableName, id: number): Promise<boolean>;

    /** Delete multiple rows by IDs */
    deleteRowsByIds(table: NoormTableName, ids: number[]): Promise<number>;

    /** Get column names for a table */
    getTableColumns(table: NoormTableName): string[];
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/**
 * Metadata for all noorm internal tables.
 */
export const NOORM_TABLE_INFO: NoormTableInfo[] = [
    {
        key: 'version',
        name: NOORM_TABLES.version,
        displayName: 'Version',
        description: 'Version tracking',
    },
    {
        key: 'change',
        name: NOORM_TABLES.change,
        displayName: 'Changes',
        description: 'Operation batch tracking',
    },
    {
        key: 'executions',
        name: NOORM_TABLES.executions,
        displayName: 'Executions',
        description: 'File execution records',
    },
    {
        key: 'lock',
        name: NOORM_TABLES.lock,
        displayName: 'Locks',
        description: 'Concurrent operation locks',
    },
    {
        key: 'identities',
        name: NOORM_TABLES.identities,
        displayName: 'Identities',
        description: 'Team member identities',
    },
];

/**
 * Column definitions per table.
 */
const TABLE_COLUMNS: Record<NoormTableName, string[]> = {
    [NOORM_TABLES.version]: [
        'id',
        'cli_version',
        'noorm_version',
        'state_version',
        'settings_version',
        'installed_at',
        'upgraded_at',
    ],
    [NOORM_TABLES.change]: [
        'id',
        'name',
        'change_type',
        'direction',
        'checksum',
        'executed_at',
        'executed_by',
        'config_name',
        'cli_version',
        'status',
        'error_message',
        'duration_ms',
    ],
    [NOORM_TABLES.executions]: [
        'id',
        'change_id',
        'filepath',
        'file_type',
        'checksum',
        'cli_version',
        'status',
        'error_message',
        'skip_reason',
        'duration_ms',
    ],
    [NOORM_TABLES.lock]: [
        'id',
        'config_name',
        'locked_by',
        'locked_at',
        'expires_at',
        'reason',
    ],
    [NOORM_TABLES.identities]: [
        'id',
        'identity_hash',
        'email',
        'name',
        'machine',
        'os',
        'public_key',
        'registered_at',
        'last_seen_at',
    ],
};

// ─────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────

/**
 * Creates debug operations for a database connection.
 *
 * @example
 * ```typescript
 * const conn = await createConnection(config, '__debug__');
 * const ops = createDebugOperations(conn.db);
 *
 * const counts = await ops.getTableCounts();
 * const rows = await ops.getTableRows(NOORM_TABLES.change, { limit: 50 });
 * ```
 */
export function createDebugOperations(db: Kysely<NoormDatabase>): DebugOperations {

    return {

        async getTableCounts(): Promise<TableCountResult[]> {

            const results: TableCountResult[] = [];

            for (const info of NOORM_TABLE_INFO) {

                const [result, err] = await attempt(() =>
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    db.selectFrom(info.name as any)
                        .select(db.fn.count('id').as('count'))
                        .executeTakeFirst(),
                );

                if (err) {

                    observer.emit('error', {
                        source: 'debug',
                        error: err,
                        context: { table: info.name, operation: 'count' },
                    });

                    results.push({ table: info.name, count: 0 });

                }
                else {

                    results.push({
                        table: info.name,
                        count: Number(result?.count ?? 0),
                    });

                }

            }

            return results;

        },

        async getTableRows(
            table: NoormTableName,
            options: GetRowsOptions = {},
        ): Promise<NoormTableRow[]> {

            const { limit = 100, sortColumn = 'id', sortDirection = 'desc' } = options;

            const [rows, err] = await attempt(() =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                db.selectFrom(table as any)
                    .selectAll()
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .orderBy(sortColumn as any, sortDirection)
                    .limit(limit)
                    .execute(),
            );

            if (err) {

                observer.emit('error', {
                    source: 'debug',
                    error: err,
                    context: { table, operation: 'get-rows' },
                });

                return [];

            }

            return rows as NoormTableRow[];

        },

        async getRowById(table: NoormTableName, id: number): Promise<NoormTableRow | null> {

            const [row, err] = await attempt(() =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                db.selectFrom(table as any)
                    .selectAll()
                    .where('id', '=', id)
                    .executeTakeFirst(),
            );

            if (err) {

                observer.emit('error', {
                    source: 'debug',
                    error: err,
                    context: { table, id, operation: 'get-row' },
                });

                return null;

            }

            return (row as NoormTableRow) ?? null;

        },

        async deleteRowById(table: NoormTableName, id: number): Promise<boolean> {

            const [result, err] = await attempt(() =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                db.deleteFrom(table as any)
                    .where('id', '=', id)
                    .executeTakeFirst(),
            );

            if (err) {

                observer.emit('error', {
                    source: 'debug',
                    error: err,
                    context: { table, id, operation: 'delete-row' },
                });

                return false;

            }

            return Number(result?.numDeletedRows ?? 0) > 0;

        },

        async deleteRowsByIds(table: NoormTableName, ids: number[]): Promise<number> {

            if (ids.length === 0) {

                return 0;

            }

            const [result, err] = await attempt(() =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                db.deleteFrom(table as any)
                    .where('id', 'in', ids)
                    .execute(),
            );

            if (err) {

                observer.emit('error', {
                    source: 'debug',
                    error: err,
                    context: { table, ids, operation: 'delete-rows' },
                });

                return 0;

            }

            return result.reduce((sum, r) => sum + Number(r.numDeletedRows ?? 0), 0);

        },

        getTableColumns(table: NoormTableName): string[] {

            return TABLE_COLUMNS[table] ?? ['id'];

        },

    };

}

/**
 * Get display info for a table by name.
 */
export function getTableInfo(table: NoormTableName): NoormTableInfo | undefined {

    return NOORM_TABLE_INFO.find((info) => info.name === table);

}

/**
 * Get all table names.
 */
export function getAllTableNames(): NoormTableName[] {

    return NOORM_TABLE_INFO.map((info) => info.name);

}
