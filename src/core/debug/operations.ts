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
import { assertPolicy } from '../policy/index.js';
import { NOORM_TABLES, getNoormTables, noormDb, type NoormDatabase, type NoormTableName } from '../shared/index.js';
import type { Channel, ConfigAccess } from '../policy/index.js';
import type { Dialect } from '../connection/types.js';

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
 *
 * `count` is nullable because a table whose count query failed must not be
 * reportable as a table with zero rows — the two render identically and the
 * caller has no other way to tell them apart.
 */
export interface TableCountResult {
    /** Table name */
    table: NoormTableName;

    /** Number of rows, or `null` when the count query failed */
    count: number | null;

    /** Failure message; present only when `count` is `null` */
    error?: string;
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
 * Who is asking and which config's access roles gate the request.
 *
 * These operations delete from `vault` and `identities`, so the gate belongs
 * at this seam rather than in the TUI screens — a second surface would
 * otherwise inherit the tables without inheriting the check.
 */
export interface DebugPolicyContext {
    /** CLI/TUI/SDK callers are `user`; the MCP server is `mcp` */
    channel: Channel;

    /** Config being inspected; missing `access` denies every operation */
    config: { name: string; access?: ConfigAccess };
}

/**
 * Debug operations interface.
 *
 * Every method throws when the policy denies it, when the table is not a
 * noorm table, or when the query fails. Falsy return values mean only
 * "not found" / "nothing deleted", never "something went wrong".
 */
export interface DebugOperations {
    /** Get row counts for all noorm tables; a per-table failure yields `count: null` */
    getTableCounts(): Promise<TableCountResult[]>;

    /** Get rows from a specific table */
    getTableRows(table: NoormTableName, options?: GetRowsOptions): Promise<NoormTableRow[]>;

    /** Get a single row by ID; `null` means the row does not exist */
    getRowById(table: NoormTableName, id: number): Promise<NoormTableRow | null>;

    /** Delete a single row by ID; `false` means the row did not exist */
    deleteRowById(table: NoormTableName, id: number): Promise<boolean>;

    /** Delete multiple rows by IDs; returns how many existed */
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
    {
        key: 'vault',
        name: NOORM_TABLES.vault,
        displayName: 'Vault',
        description: 'Encrypted vault secrets',
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
        'encrypted_vault_key',
    ],
    [NOORM_TABLES.vault]: [
        'id',
        'secret_key',
        'encrypted_value',
        'set_by',
        'created_at',
        'updated_at',
    ],
};

// ─────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────

/**
 * Creates debug operations for a database connection.
 *
 * Uses dialect-aware schema scoping via `noormDb()` so queries target
 * the correct schema on pg/mssql while remaining compatible with
 * sqlite/mysql. The table names passed as parameters (`NoormTableName`)
 * are already the correct names from the caller.
 *
 * `policy` is required rather than optional: these operations delete from
 * `vault` and `identities`, and an omitted gate is exactly the defect this
 * parameter closes.
 *
 * @param db - Kysely database instance
 * @param dialect - Database dialect for schema scoping
 * @param policy - Channel and config whose access roles gate every operation
 *
 * @example
 * ```typescript
 * const conn = await createConnection(config, '__debug__');
 * const ops = createDebugOperations(conn.db, 'postgres', { channel: 'user', config });
 *
 * const counts = await ops.getTableCounts();
 * const rows = await ops.getTableRows(NOORM_TABLES.change, { limit: 50 });
 * ```
 */
export function createDebugOperations(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    policy: DebugPolicyContext,
): DebugOperations {

    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    // Map prefixed names → dialect-aware names for query use.
    // Callers pass NoormTableName (prefixed) but on pg/mssql ndb expects clean names.
    const nameMap: Record<string, string> = {};

    for (const info of NOORM_TABLE_INFO) {

        nameMap[info.name] = tables[info.key];

    }

    const gate = (permission: 'debug:read' | 'debug:write'): void => {

        assertPolicy(policy.channel, policy.config, permission);

    };

    const resolveTable = (table: NoormTableName): string => {

        const resolved = nameMap[table];

        if (!resolved) {

            throw new Error(`"${table}" is not a noorm internal table.`);

        }

        return resolved;

    };

    const columnsFor = (table: NoormTableName): string[] => {

        const columns = TABLE_COLUMNS[table];

        if (!columns) {

            throw new Error(`"${table}" is not a noorm internal table.`);

        }

        return columns;

    };

    return {

        async getTableCounts(): Promise<TableCountResult[]> {

            gate('debug:read');

            const results: TableCountResult[] = [];

            for (const info of NOORM_TABLE_INFO) {

                // Use dialect-aware table name for the query, not the static prefixed name
                const tableName = tables[info.key];

                const [result, err] = await attempt(() =>
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ndb.selectFrom(tableName as any)
                        .select(ndb.fn.count('id').as('count'))
                        .executeTakeFirst(),
                );

                if (err) {

                    observer.emit('error', {
                        source: 'debug',
                        error: err,
                        context: { table: info.name, operation: 'count' },
                    });

                    // One unreadable table must not abort the whole overview —
                    // but it must not read as "empty" either.
                    results.push({ table: info.name, count: null, error: err.message });

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

            gate('debug:read');

            const { limit = 100, sortColumn = 'id', sortDirection = 'desc' } = options;

            const queryTable = resolveTable(table);
            const columns = columnsFor(table);

            // `sortColumn` is caller-supplied and reaches orderBy() as an
            // identifier. Kysely quotes it, so this is not an injection vector —
            // but an unknown value produces a driver error that used to be
            // swallowed into an empty result. Reject it by name instead.
            if (!columns.includes(sortColumn)) {

                throw new Error(`"${sortColumn}" is not a column of ${table}.`);

            }

            if (sortDirection !== 'asc' && sortDirection !== 'desc') {

                throw new Error(`"${sortDirection}" is not a sort direction.`);

            }

            const [rows, err] = await attempt(() =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ndb.selectFrom(queryTable as any)
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

                throw err;

            }

            return rows as NoormTableRow[];

        },

        async getRowById(table: NoormTableName, id: number): Promise<NoormTableRow | null> {

            gate('debug:read');

            const queryTable = resolveTable(table);

            const [row, err] = await attempt(() =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ndb.selectFrom(queryTable as any)
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

                throw err;

            }

            return (row as NoormTableRow) ?? null;

        },

        async deleteRowById(table: NoormTableName, id: number): Promise<boolean> {

            gate('debug:write');

            const queryTable = resolveTable(table);

            const [result, err] = await attempt(() =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ndb.deleteFrom(queryTable as any)
                    .where('id', '=', id)
                    .executeTakeFirst(),
            );

            if (err) {

                observer.emit('error', {
                    source: 'debug',
                    error: err,
                    context: { table, id, operation: 'delete-row' },
                });

                throw err;

            }

            return Number(result?.numDeletedRows ?? 0) > 0;

        },

        async deleteRowsByIds(table: NoormTableName, ids: number[]): Promise<number> {

            // Authorize before the empty-list short circuit — a denied caller
            // must be told so, not handed a plausible-looking 0.
            gate('debug:write');

            if (ids.length === 0) {

                return 0;

            }

            const queryTable = resolveTable(table);

            const [result, err] = await attempt(() =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ndb.deleteFrom(queryTable as any)
                    .where('id', 'in', ids)
                    .execute(),
            );

            if (err) {

                observer.emit('error', {
                    source: 'debug',
                    error: err,
                    context: { table, ids, operation: 'delete-rows' },
                });

                throw err;

            }

            return result.reduce((sum, r) => sum + Number(r.numDeletedRows ?? 0), 0);

        },

        getTableColumns(table: NoormTableName): string[] {

            gate('debug:read');

            return columnsFor(table);

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
