/**
 * Transfer executor.
 *
 * Executes data transfer based on the transfer plan.
 * Handles both same-server (direct SQL) and cross-server (batch) transfers.
 */
import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';

import type { InsertResult, Kysely } from 'kysely';
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

import type { KeysetPager } from '../dt/paging.js';

import { observer } from '../observer.js';
import { getTransferOperations } from './dialects/index.js';
import { DtStreamer } from '../dt/streamer.js';
import { createKeysetPager } from '../dt/paging.js';
import { queryDatabaseVersion } from '../dt/version.js';

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
    const { dialect: _srcDialect } = ctx.source;
    const destDialect = ctx.destination.dialect;
    const ops = getTransferOperations(destDialect);

    if (!ops) {

        return [null, new Error(`Unsupported dialect: ${destDialect}`)];

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

        // Choose transfer strategy
        const useSameServer = plan.sameServer && strategy === 'fail' && !plan.crossDialect;
        const useCrossDialect = plan.crossDialect && tablePlan.columnTypes;

        let tableResult: TransferTableResult | null;
        let tableErr: Error | null;

        if (useSameServer) {

            [tableResult, tableErr] = await transferTableSameServer(
                ctx,
                tablePlan,
                options,
                ops,
            );

        }
        else if (useCrossDialect) {

            [tableResult, tableErr] = await transferTableCrossDialect(
                ctx,
                tablePlan,
                plan,
                options,
            );

        }
        else {

            [tableResult, tableErr] = await transferTableCrossServer(
                ctx,
                tablePlan,
                options,
                ops,
            );

        }

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

    // Re-enable FK checks on destination. A failed re-enable never fails
    // the transfer itself (data already moved), but it must stay visible
    // to the caller — a swallowed failure here left referential integrity
    // off on the destination with no signal beyond an observer event
    // (QL-safe-05).
    let fkChecksRestored = true;

    if (options.disableForeignKeys !== false) {

        const [, enableErr] = await attempt(() =>
            ops.executeEnableFK(
                ctx.destination.db,
                plan.tables.map((t) => t.name),
            ),
        );

        if (enableErr) {

            fkChecksRestored = false;

            // Log warning but don't fail the transfer
            observer.emit('error', {
                source: 'transfer',
                error: enableErr,
                context: { phase: 'enable-fk' },
            });

        }

    }

    const durationMs = Date.now() - startTime;

    // `allSuccess` was false by definition whenever `hasFailures` was true,
    // so 'partial' was unreachable and a run that moved most of the data
    // looked identical to one that moved none.
    const anySuccess = tableResults.some((r) => r.status === 'success');

    const result: TransferResult = {
        status: hasFailures ? (anySuccess ? 'partial' : 'failed') : 'success',
        tables: tableResults,
        totalRows,
        durationMs,
        fkChecksRestored,
    };

    observer.emit('transfer:complete', {
        status: result.status,
        totalRows,
        tableCount: plan.tables.length,
        durationMs,
        fkChecksRestored,
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

    const [transferResult, transferErr] = await attempt(() =>
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

    // plan.rowCount is a planner estimate (postgres reltuples, MySQL
    // TABLE_ROWS) — reporting it as rowsTransferred meant the result never
    // reflected what the statement actually wrote.
    const rowsTransferred = Number(transferResult?.numAffectedRows ?? 0);

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
    let transferError: Error | null = null;
    const cursor = openSourceCursor(ctx, plan, batchSize);

    // Fetch and insert in batches
    while (true) {

        // Fetch batch from source
        const [rows, fetchErr] = await attempt(() => cursor.next());

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

        observer.emit('transfer:table:progress', {
            table: plan.name,
            rowsTransferred,
            rowsTotal: plan.rowCount,
            rowsSkipped,
        });

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
 * Transfer table using cross-dialect conversion via DtStreamer.
 *
 * Fetches rows from source, converts types in memory, inserts into target.
 */
async function transferTableCrossDialect(
    ctx: DualConnectionContext,
    plan: TransferTablePlan,
    transferPlan: TransferPlan,
    options: TransferOptions,
): Promise<[TransferTableResult | null, Error | null]> {

    const startTime = Date.now();
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const strategy = options.onConflict ?? 'fail';
    const destOps = getTransferOperations(ctx.destination.dialect);

    if (!destOps || !plan.columnTypes) {

        return [null, new Error('Missing dialect operations or column types for cross-dialect transfer')];

    }

    // Detect database versions for version-aware type conversion
    const [srcVersion] = await queryDatabaseVersion({ db: ctx.source.db, dialect: ctx.source.dialect });
    const [dstVersion] = await queryDatabaseVersion({ db: ctx.destination.db, dialect: ctx.destination.dialect });

    // Create streamer for in-memory type conversion
    const streamer = new DtStreamer({
        sourceDialect: ctx.source.dialect,
        sourceVersion: srcVersion ?? undefined,
        targetDialect: ctx.destination.dialect,
        targetVersion: dstVersion ?? undefined,
        columns: plan.columnTypes,
        batchSize,
    });

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

        const enableSql = destOps.getEnableIdentityInsertSql(plan.name);

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
    let transferError: Error | null = null;
    const cursor = openSourceCursor(ctx, plan, batchSize);

    observer.emit('dt:stream:start', {
        table: plan.name,
        sourceDialect: ctx.source.dialect,
        targetDialect: ctx.destination.dialect,
    });

    while (true) {

        // Fetch batch from source
        const [rows, fetchErr] = await attempt(() => cursor.next());

        if (fetchErr) {

            transferError = new Error(`Failed to fetch batch: ${fetchErr.message}`);
            break;

        }

        if (rows.length === 0) break;

        // Convert types via DtStreamer
        const convertedRows = streamer.convertBatch(rows);

        // Insert converted rows into destination
        for (const row of convertedRows) {

            const [, insertErr] = await attempt(() =>
                ctx.destination.db.insertInto(plan.name as never).values(row as never).execute(),
            );

            if (insertErr) {

                // Only a *conflict* is skippable. Testing the raw option
                // against 'fail' meant the SDK default (undefined) swallowed
                // every insert error — a type conversion the streamer got
                // wrong counted as a skipped row and the transfer reported
                // success with two thirds of the table missing.
                if (isDuplicateKeyError(insertErr.message) && strategy !== 'fail') {

                    rowsSkipped++;

                }
                else {

                    transferError = new Error(`Failed to insert row: ${insertErr.message}`);
                    break;

                }

            }
            else {

                rowsTransferred++;

            }

        }

        if (transferError) break;

        observer.emit('transfer:table:progress', {
            table: plan.name,
            rowsTransferred,
            rowsTotal: plan.rowCount,
            rowsSkipped,
        });

        observer.emit('dt:stream:progress', {
            table: plan.name,
            rowsConverted: rowsTransferred + rowsSkipped,
        });

    }

    // Cleanup: disable identity insert
    if (options.preserveIdentity !== false && plan.hasIdentity) {

        const disableSql = destOps.getDisableIdentityInsertSql(plan.name);

        if (disableSql) {

            await attempt(() => sql.raw(disableSql).execute(ctx.destination.db));

        }

    }

    const durationMs = Date.now() - startTime;

    observer.emit('dt:stream:complete', {
        table: plan.name,
        rowsConverted: rowsTransferred + rowsSkipped,
        durationMs,
    });

    if (transferError) {

        return [null, transferError];

    }

    return [{
        table: plan.name,
        status: 'success',
        rowsTransferred,
        rowsSkipped,
        durationMs,
    }, null];

}

/**
 * Open a stable cursor over a source table.
 *
 * Pages by primary key rather than `OFFSET`: an `OFFSET` walk with no total
 * order silently drops and duplicates rows whenever the source is written to
 * mid-transfer, while still reporting the full row count. See
 * `core/dt/paging.ts`.
 */
function openSourceCursor(
    ctx: DualConnectionContext,
    plan: TransferTablePlan,
    batchSize: number,
): KeysetPager {

    return createKeysetPager({
        db: ctx.source.db,
        dialect: ctx.source.dialect,
        table: plan.name,
        columns: plan.columns,
        keyColumns: plan.primaryKey,
        batchSize,
    });

}

/**
 * Batch insert result.
 */
interface BatchInsertResult {

    inserted: number;
    skipped: number;

}

/**
 * How many rows a Kysely insert actually wrote.
 *
 * A conflict-handling insert can succeed without writing anything, so the
 * absence of an exception says nothing about whether a row landed. Drivers
 * that do not report affected rows leave the field undefined; assume the
 * insert applied there rather than silently under-reporting.
 */
function countApplied(results: InsertResult[]): number {

    const affected = results[0]?.numInsertedOrUpdatedRows;

    return affected === undefined ? 1 : Number(affected);

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

            const [results, err] = await attempt(() =>
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
            else if (countApplied(results) > 0) {

                inserted++;

            }
            else {

                // DO NOTHING succeeds without writing. Counting the absence
                // of an exception as an insert is what made rowsTransferred
                // match the source while the destination was untouched.
                skipped++;

            }

        }
        else if (strategy === 'update' && primaryKey.length > 0) {

            const updateSet: Record<string, unknown> = {};

            for (const col of columns) {

                if (!primaryKey.includes(col)) {

                    updateSet[col] = row[col];

                }

            }

            const [results, err] = await attempt(() =>
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
            else if (countApplied(results) > 0) {

                inserted++;

            }
            else {

                skipped++;

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

        const [result, err] = await attempt(() => finalSql.execute(db));

        if (err) {

            if (isDuplicateKeyError(err.message)) {

                skipped++;

            }
            else {

                return [{ inserted, skipped }, err];

            }

        }
        else if (result.numAffectedRows === undefined || Number(result.numAffectedRows) > 0) {

            inserted++;

        }
        else {

            // INSERT IGNORE and MERGE both report zero rows on a no-op.
            skipped++;

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
