/**
 * Transfer executor.
 *
 * Executes data transfer based on the transfer plan.
 * Handles both same-server (direct SQL) and cross-server (batch) transfers.
 */
import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';

import type { Kysely } from 'kysely';
import type { DualConnectionContext } from '../db/dual.js';
import type { NoormDatabase } from '../shared/tables.js';
import type { Dialect } from '../connection/types.js';
import type { TransferDialectOperations } from './dialects/types.js';
import type {
    TransferOptions,
    TransferPlan,
    TransferTablePlan,
    TransferResult,
    TransferTableResult,
    ConflictStrategy,
} from './types.js';

import { observer } from '../observer.js';
import { getTransferOperations } from './dialects/index.js';

/**
 * Default batch size for cross-server transfers.
 */
const DEFAULT_BATCH_SIZE = 1000;

/**
 * Execute transfer based on plan.
 *
 * @param ctx - Dual connection context
 * @param plan - Transfer plan from planner
 * @param options - Transfer options
 * @returns Transfer result or error
 */
export async function executeTransfer(
    ctx: DualConnectionContext,
    plan: TransferPlan,
    options: TransferOptions = {},
): Promise<[TransferResult | null, Error | null]> {

    const startTime = Date.now();
    const { dialect } = ctx.source;
    const ops = getTransferOperations(dialect);

    if (!ops) {

        return [null, new Error(`Unsupported dialect: ${dialect}`)];

    }

    const tableResults: TransferTableResult[] = [];
    let totalRows = 0;
    let hasFailures = false;

    observer.emit('transfer:starting', {
        tableCount: plan.tables.length,
        sameServer: plan.sameServer,
    });

    // Disable FK checks on destination
    if (options.disableForeignKeys !== false) {

        const [, disableErr] = await attempt(() =>
            ops.executeDisableFK(
                ctx.destination.db,
                plan.tables.map((t) => t.name),
            ),
        );

        if (disableErr) {

            return [null, new Error(`Failed to disable FK checks: ${disableErr.message}`)];

        }

    }

    // Transfer each table in order
    for (let i = 0; i < plan.tables.length; i++) {

        const tablePlan = plan.tables[i]!;

        observer.emit('transfer:table:before', {
            table: tablePlan.name,
            index: i,
            total: plan.tables.length,
            rowCount: tablePlan.rowCount,
        });

        const tableStart = Date.now();
        let result: TransferTableResult;
        const strategy = options.onConflict ?? 'fail';

        // Same-server direct INSERT...SELECT only works when no conflict handling needed
        // For skip/update/replace strategies, use cross-server batch path
        const useSameServer = plan.sameServer && strategy === 'fail';

        if (useSameServer) {

            const [tableResult, tableErr] = await transferTableSameServer(
                ctx,
                tablePlan,
                options,
                ops,
            );

            if (tableErr) {

                result = {
                    table: tablePlan.name,
                    status: 'failed',
                    rowsTransferred: 0,
                    rowsSkipped: 0,
                    durationMs: Date.now() - tableStart,
                    error: tableErr.message,
                };
                hasFailures = true;

            }
            else {

                result = tableResult!;

            }

        }
        else {

            const [tableResult, tableErr] = await transferTableCrossServer(
                ctx,
                tablePlan,
                options,
                ops,
            );

            if (tableErr) {

                result = {
                    table: tablePlan.name,
                    status: 'failed',
                    rowsTransferred: 0,
                    rowsSkipped: 0,
                    durationMs: Date.now() - tableStart,
                    error: tableErr.message,
                };
                hasFailures = true;

            }
            else {

                result = tableResult!;

            }

        }

        tableResults.push(result);
        totalRows += result.rowsTransferred;

        observer.emit('transfer:table:after', {
            table: tablePlan.name,
            status: result.status,
            rowsTransferred: result.rowsTransferred,
            rowsSkipped: result.rowsSkipped,
            durationMs: result.durationMs,
            error: result.error,
        });

    }

    // Re-enable FK checks on destination
    if (options.disableForeignKeys !== false) {

        const [, enableErr] = await attempt(() =>
            ops.executeEnableFK(
                ctx.destination.db,
                plan.tables.map((t) => t.name),
            ),
        );

        if (enableErr) {

            // Log warning but don't fail the transfer
            observer.emit('error', {
                source: 'transfer',
                error: enableErr,
                context: { phase: 'enable-fk' },
            });

        }

    }

    const durationMs = Date.now() - startTime;
    const allSuccess = tableResults.every((r) => r.status === 'success');

    const result: TransferResult = {
        status: hasFailures ? (allSuccess ? 'partial' : 'failed') : 'success',
        tables: tableResults,
        totalRows,
        durationMs,
    };

    observer.emit('transfer:complete', {
        status: result.status,
        totalRows,
        tableCount: plan.tables.length,
        durationMs,
    });

    return [result, null];

}

/**
 * Transfer table using same-server direct SQL.
 */
async function transferTableSameServer(
    ctx: DualConnectionContext,
    plan: TransferTablePlan,
    options: TransferOptions,
    ops: ReturnType<typeof getTransferOperations>,
): Promise<[TransferTableResult | null, Error | null]> {

    const startTime = Date.now();

    if (!ops) {

        return [null, new Error('No dialect operations')];

    }

    // Truncate if requested
    if (options.truncateFirst) {

        const [, truncateErr] = await truncateTable(
            ctx.destination.db,
            ctx.destination.dialect,
            plan.name,
        );

        if (truncateErr) {

            return [null, new Error(`Failed to truncate: ${truncateErr.message}`)];

        }

    }

    // Enable identity insert if needed
    if (options.preserveIdentity !== false && plan.hasIdentity) {

        const enableSql = ops.getEnableIdentityInsertSql(plan.name);

        if (enableSql) {

            const [, enableErr] = await attempt(() =>
                sql.raw(enableSql).execute(ctx.destination.db),
            );

            if (enableErr) {

                return [null, new Error(`Failed to enable identity insert: ${enableErr.message}`)];

            }

        }

    }

    // Build and execute direct transfer
    const transferSql = ops.buildDirectTransfer(
        ctx.source.config.connection.database,
        plan.name,
        plan.name,
        plan.columns,
        plan.schema,
        plan.schema,
    );

    const [, transferErr] = await attempt(() =>
        sql.raw(transferSql).execute(ctx.destination.db),
    );

    // Cleanup: disable identity insert (best effort)
    if (options.preserveIdentity !== false && plan.hasIdentity) {

        const disableSql = ops.getDisableIdentityInsertSql(plan.name);

        if (disableSql) {

            await attempt(() => sql.raw(disableSql).execute(ctx.destination.db));

        }

        // Reset sequence (best effort)
        if (plan.identityColumn) {

            const resetSql = ops.getResetSequenceSql(plan.name, plan.identityColumn, plan.schema);

            if (resetSql) {

                await attempt(() => sql.raw(resetSql).execute(ctx.destination.db));

            }

        }

    }

    if (transferErr) {

        return [null, new Error(`Transfer failed: ${transferErr.message}`)];

    }

    const rowsTransferred = plan.rowCount;

    observer.emit('transfer:table:progress', {
        table: plan.name,
        rowsTransferred,
        rowsTotal: plan.rowCount,
        rowsSkipped: 0,
    });

    return [{
        table: plan.name,
        status: 'success',
        rowsTransferred,
        rowsSkipped: 0,
        durationMs: Date.now() - startTime,
    }, null];

}

/**
 * Transfer table using cross-server batch approach.
 */
async function transferTableCrossServer(
    ctx: DualConnectionContext,
    plan: TransferTablePlan,
    options: TransferOptions,
    ops: ReturnType<typeof getTransferOperations>,
): Promise<[TransferTableResult | null, Error | null]> {

    const startTime = Date.now();
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const strategy = options.onConflict ?? 'fail';

    if (!ops) {

        return [null, new Error('No dialect operations')];

    }

    // Truncate if requested
    if (options.truncateFirst) {

        const [, truncateErr] = await truncateTable(
            ctx.destination.db,
            ctx.destination.dialect,
            plan.name,
        );

        if (truncateErr) {

            return [null, new Error(`Failed to truncate: ${truncateErr.message}`)];

        }

    }

    // Enable identity insert if needed
    if (options.preserveIdentity !== false && plan.hasIdentity) {

        const enableSql = ops.getEnableIdentityInsertSql(plan.name);

        if (enableSql) {

            const [, enableErr] = await attempt(() =>
                sql.raw(enableSql).execute(ctx.destination.db),
            );

            if (enableErr) {

                return [null, new Error(`Failed to enable identity insert: ${enableErr.message}`)];

            }

        }

    }

    let rowsTransferred = 0;
    let rowsSkipped = 0;
    let offset = 0;
    let transferError: Error | null = null;

    // Fetch and insert in batches
    while (true) {

        // Fetch batch from source
        const [rows, fetchErr] = await attempt(() =>
            fetchBatch(
                ctx.source.db,
                ctx.source.dialect,
                plan.name,
                plan.columns,
                batchSize,
                offset,
                plan.schema,
            ),
        );

        if (fetchErr) {

            transferError = new Error(`Failed to fetch batch: ${fetchErr.message}`);
            break;

        }

        if (rows.length === 0) {

            break;

        }

        // Insert batch to destination
        const [batchResult, insertErr] = await insertBatch(
            ctx.destination.db,
            ctx.destination.dialect,
            plan.name,
            plan.columns,
            plan.primaryKey,
            rows,
            strategy,
            ops,
        );

        if (insertErr) {

            transferError = new Error(`Failed to insert batch: ${insertErr.message}`);
            break;

        }

        rowsTransferred += batchResult.inserted;
        rowsSkipped += batchResult.skipped;
        offset += rows.length;

        observer.emit('transfer:table:progress', {
            table: plan.name,
            rowsTransferred,
            rowsTotal: plan.rowCount,
            rowsSkipped,
        });

        // Check if we got fewer rows than batch size (end of data)
        if (rows.length < batchSize) {

            break;

        }

    }

    // Cleanup: disable identity insert (best effort)
    if (options.preserveIdentity !== false && plan.hasIdentity) {

        const disableSql = ops.getDisableIdentityInsertSql(plan.name);

        if (disableSql) {

            await attempt(() => sql.raw(disableSql).execute(ctx.destination.db));

        }

        // Reset sequence (best effort)
        if (plan.identityColumn) {

            const resetSql = ops.getResetSequenceSql(plan.name, plan.identityColumn, plan.schema);

            if (resetSql) {

                await attempt(() => sql.raw(resetSql).execute(ctx.destination.db));

            }

        }

    }

    if (transferError) {

        return [null, transferError];

    }

    return [{
        table: plan.name,
        status: 'success',
        rowsTransferred,
        rowsSkipped,
        durationMs: Date.now() - startTime,
    }, null];

}

/**
 * Fetch a batch of rows from source table.
 *
 * Uses dialect-specific syntax for column quoting and pagination.
 */
async function fetchBatch(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    table: string,
    columns: string[],
    limit: number,
    offset: number,
    _schema?: string,
): Promise<Record<string, unknown>[]> {

    // Quote column names based on dialect
    const quoteIdent = dialect === 'mssql'
        ? (c: string) => `[${c}]`
        : dialect === 'mysql'
            ? (c: string) => `\`${c}\``
            : (c: string) => `"${c}"`;

    const columnList = columns.map(quoteIdent).join(', ');

    // MSSQL uses different pagination syntax
    if (dialect === 'mssql') {

        // MSSQL requires ORDER BY for OFFSET/FETCH
        // Use first column as default order (usually PK)
        const orderCol = quoteIdent(columns[0]!);
        const result = await sql<Record<string, unknown>>`
            SELECT ${sql.raw(columnList)}
            FROM ${sql.table(table)}
            ORDER BY ${sql.raw(orderCol)}
            OFFSET ${offset} ROWS
            FETCH NEXT ${limit} ROWS ONLY
        `.execute(db);

        return result.rows;

    }

    // PostgreSQL and MySQL use LIMIT/OFFSET
    const result = await sql<Record<string, unknown>>`
        SELECT ${sql.raw(columnList)}
        FROM ${sql.table(table)}
        LIMIT ${limit}
        OFFSET ${offset}
    `.execute(db);

    return result.rows;

}

/**
 * Batch insert result.
 */
interface BatchInsertResult {

    inserted: number;
    skipped: number;

}

/**
 * Insert a batch of rows to destination table.
 *
 * Uses dialect-specific SQL for MSSQL MERGE statements.
 * Falls back to Kysely's onConflict for PostgreSQL and MySQL.
 *
 * Returns inserted/skipped counts or error.
 */
async function insertBatch(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    table: string,
    columns: string[],
    primaryKey: string[],
    rows: Record<string, unknown>[],
    strategy: ConflictStrategy,
    ops: TransferDialectOperations | undefined,
): Promise<[BatchInsertResult, Error | null]> {

    if (rows.length === 0) {

        return [{ inserted: 0, skipped: 0 }, null];

    }

    // MSSQL requires MERGE and MySQL requires INSERT IGNORE / ON DUPLICATE KEY
    // Use dialect-specific raw SQL for conflict handling on non-PostgreSQL dialects
    if ((dialect === 'mssql' || dialect === 'mysql') && strategy !== 'fail' && primaryKey.length > 0 && ops) {

        return insertBatchRawSql(db, dialect, table, columns, primaryKey, rows, strategy, ops);

    }

    let inserted = 0;
    let skipped = 0;

    // Insert row by row
    for (const row of rows) {

        const query = db
            .insertInto(table as never)
            .values(row as never);

        // Handle conflict based on strategy
        if (strategy === 'skip' && primaryKey.length > 0) {

            const [, err] = await attempt(() =>
                query
                    .onConflict((oc) => oc.columns(primaryKey as never[]).doNothing())
                    .execute(),
            );

            if (err) {

                if (isDuplicateKeyError(err.message)) {

                    skipped++;

                }
                else {

                    return [{ inserted, skipped }, err];

                }

            }
            else {

                inserted++;

            }

        }
        else if (strategy === 'update' && primaryKey.length > 0) {

            const updateSet: Record<string, unknown> = {};

            for (const col of columns) {

                if (!primaryKey.includes(col)) {

                    updateSet[col] = row[col];

                }

            }

            const [, err] = await attempt(() =>
                query
                    .onConflict((oc) => oc.columns(primaryKey as never[]).doUpdateSet(updateSet as never))
                    .execute(),
            );

            if (err) {

                if (isDuplicateKeyError(err.message)) {

                    skipped++;

                }
                else {

                    return [{ inserted, skipped }, err];

                }

            }
            else {

                inserted++;

            }

        }
        else {

            // Standard insert (fail on conflict) or replace
            const [, err] = await attempt(() => query.execute());

            if (err) {

                if (strategy === 'fail') {

                    return [{ inserted, skipped }, err];

                }

                // For replace strategy, skip on error
                skipped++;

            }
            else {

                inserted++;

            }

        }

    }

    return [{ inserted, skipped }, null];

}

/**
 * Insert batch using dialect-specific raw SQL.
 *
 * MSSQL uses MERGE statements, MySQL uses INSERT IGNORE / ON DUPLICATE KEY.
 * Handles both @p{n} (MSSQL) and ? (MySQL) parameter placeholders.
 */
async function insertBatchRawSql(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    table: string,
    columns: string[],
    primaryKey: string[],
    rows: Record<string, unknown>[],
    strategy: ConflictStrategy,
    ops: TransferDialectOperations,
): Promise<[BatchInsertResult, Error | null]> {

    let inserted = 0;
    let skipped = 0;

    // Build the SQL template once
    const sqlTemplate = ops.buildConflictInsert(table, columns, primaryKey, strategy);

    for (const row of rows) {

        // Build parameter values in column order
        const values = columns.map((col) => row[col]);

        const sqlParts: string[] = [];
        const sqlValues: unknown[] = [];

        if (dialect === 'mssql') {

            // MSSQL uses @p0, @p1, etc. — split by named parameter markers
            let match: RegExpExecArray | null;
            const paramRegex = /@p(\d+)/g;
            let lastIndex = 0;

            paramRegex.lastIndex = 0;

            while ((match = paramRegex.exec(sqlTemplate)) !== null) {

                sqlParts.push(sqlTemplate.slice(lastIndex, match.index));
                sqlValues.push(values[parseInt(match[1]!, 10)]);
                lastIndex = match.index + match[0].length;

            }

            sqlParts.push(sqlTemplate.slice(lastIndex));

        }
        else {

            // MySQL uses ? positional placeholders
            const parts = sqlTemplate.split('?');
            let paramIdx = 0;

            for (let i = 0; i < parts.length; i++) {

                sqlParts.push(parts[i]!);

                if (i < parts.length - 1) {

                    sqlValues.push(values[paramIdx++]);

                }

            }

        }

        // Build parameterized SQL using Kysely's sql function
        const finalSql = sql.join(
            sqlParts.map((part, i) => {

                if (i < sqlValues.length) {

                    return sql`${sql.raw(part)}${sql.val(sqlValues[i])}`;

                }

                return sql.raw(part);

            }),
            sql.raw(''),
        );

        const [, err] = await attempt(() => finalSql.execute(db));

        if (err) {

            if (isDuplicateKeyError(err.message)) {

                skipped++;

            }
            else {

                return [{ inserted, skipped }, err];

            }

        }
        else {

            inserted++;

        }

    }

    return [{ inserted, skipped }, null];

}

/**
 * Check if an error message indicates a duplicate key violation.
 */
function isDuplicateKeyError(message: string): boolean {

    const lower = message.toLowerCase();

    return (
        lower.includes('duplicate') ||
        lower.includes('unique constraint') ||
        lower.includes('primary key') ||
        lower.includes('violates unique') ||
        lower.includes('cannot insert duplicate') ||
        lower.includes('duplicate entry')
    );

}

/**
 * Truncate a table with dialect-specific handling.
 *
 * PostgreSQL requires CASCADE for FK relationships.
 * MSSQL doesn't support TRUNCATE with FK constraints - use DELETE instead.
 */
async function truncateTable(
    db: Kysely<NoormDatabase>,
    dialect: string,
    table: string,
): Promise<[void, Error | null]> {

    let truncateSql: string;

    switch (dialect) {

    case 'postgres':
        // PostgreSQL needs CASCADE for FK relationships
        truncateSql = `TRUNCATE TABLE "${table}" CASCADE`;
        break;

    case 'mssql':
        // MSSQL can't TRUNCATE with FK constraints, use DELETE
        truncateSql = `DELETE FROM [${table}]`;
        break;

    case 'mysql':
        truncateSql = `TRUNCATE TABLE \`${table}\``;
        break;

    default:
        truncateSql = `TRUNCATE TABLE ${table}`;

    }

    const [, err] = await attempt(() => sql.raw(truncateSql).execute(db));

    return [undefined, err];

}
