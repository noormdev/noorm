/**
 * .dt data transfer format module.
 *
 * Provides the public API for:
 * - File export: DB table → .dt/.dtz/.dtzx file
 * - File import: .dt/.dtz/.dtzx file → DB table
 * - In-memory cross-dialect conversion (DtStreamer)
 * - Schema building and validation
 * - Database version detection
 *
 * @example
 * ```typescript
 * import { exportTable, importDtFile, createStreamer } from './dt/index.js';
 *
 * // Export a table to .dt file
 * const [result, err] = await exportTable({
 *     db: kyselyDb,
 *     dialect: 'postgres',
 *     tableName: 'users',
 *     filepath: './data/users.dtz',
 * });
 *
 * // Import from .dt file
 * const [importResult, importErr] = await importDtFile({
 *     filepath: './data/users.dtz',
 *     db: destDb,
 *     dialect: 'mysql',
 * });
 *
 * // Cross-dialect streaming (used internally by transfer module)
 * const streamer = createStreamer({
 *     sourceDialect: 'postgres',
 *     targetDialect: 'mysql',
 *     columns: schema.columns,
 * });
 * ```
 */
import { availableParallelism } from 'os';

import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';

import type { Kysely } from 'kysely';
import type { NoormDatabase } from '../shared/tables.js';
import type { ExportTableOptions, ImportFileOptions, DtStreamerOptions, DtSchema, DtValue, DatabaseVersion } from './types.js';
import type { Dialect } from '../connection/types.js';
import type { ConnectionEvents, ComputeEvents } from '../worker-bridge/types.js';

import { observer } from '../observer.js';
import { WorkerBridge } from '../worker-bridge/bridge.js';
import { WorkerPool } from '../worker-bridge/pool.js';
import { OrderBuffer } from '../worker-bridge/order-buffer.js';
import { resolveWorker } from '../worker-bridge/paths.js';
import { DtWriter } from './writer.js';
import { DtReader } from './reader.js';
import { DtStreamer } from './streamer.js';
import { buildDtSchema, validateSchema } from './schema.js';

const CONNECTION_WORKER = resolveWorker('connection');
const COMPUTE_WORKER = resolveWorker('compute');

/**
 * Create a compute pool sized to the available CPU cores.
 *
 * Reserves two cores for the main thread and connection worker.
 */
function createDefaultComputePool(): WorkerPool<ComputeEvents> {

    return WorkerBridge.pool<ComputeEvents>(COMPUTE_WORKER, {
        size: Math.max(1, availableParallelism() - 2),
    });

}

/**
 * Create and connect a connection worker bridge.
 *
 * Spawns a new worker thread and connects it to the given database.
 */
async function createDefaultConnectionBridge(
    dialect: Dialect,
    connectionString: string,
): Promise<[WorkerBridge<ConnectionEvents> | null, Error | null]> {

    const bridge = new WorkerBridge<ConnectionEvents>(CONNECTION_WORKER);

    const [, connectErr] = await attempt(() =>
        bridge.request('connect', { dialect, connectionString }),
    );

    if (connectErr) {

        await attempt(() => bridge.shutdown());

        return [null, connectErr];

    }

    return [bridge, null];

}

/**
 * Export a database table to a .dt/.dtz/.dtzx file.
 *
 * Queries all rows from the table, serializes to .dt format,
 * and writes to the specified file path.
 *
 * @param options - Export configuration
 * @returns Row count and bytes written, or error
 *
 * @example
 * ```typescript
 * const [result, err] = await exportTable({
 *     db: kyselyDb,
 *     dialect: 'postgres',
 *     tableName: 'users',
 *     filepath: './data/users.dtz',
 *     batchSize: 5000,
 * });
 * ```
 */
export async function exportTable(
    options: ExportTableOptions,
): Promise<[{ rowsWritten: number; bytesWritten: number } | null, Error | null]> {

    const startTime = Date.now();
    const { db, dialect, tableName, filepath, passphrase, schema: schemaName } = options;
    const kyselyDb = db as Kysely<NoormDatabase>;
    const batchSize = options.batchSize ?? 1000;

    // Build schema
    const [dtSchema, schemaErr] = await buildDtSchema({
        db: kyselyDb,
        dialect,
        tableName,
        version: options.version,
        schema: schemaName,
    });

    if (schemaErr || !dtSchema) {

        return [null, schemaErr ?? new Error('Failed to build schema')];

    }

    observer.emit('dt:export:start', {
        filepath,
        table: tableName,
        columnCount: dtSchema.columns.length,
    });

    // Create writer
    const writer = new DtWriter({ filepath, schema: dtSchema, passphrase });
    const [, openErr] = await attempt(() => writer.open());

    if (openErr) {

        return [null, openErr];

    }

    // Resolve workers — use provided overrides or create our own
    let ownedConnectionBridge: WorkerBridge<ConnectionEvents> | null = null;
    let ownedComputePool: WorkerPool<ComputeEvents> | null = null;

    let connectionBridge = options.connectionBridge;
    let computePool = options.computePool;

    // Create connection worker when connection string is available but no bridge provided
    if (!connectionBridge && options.connectionString) {

        const [bridge, bridgeErr] = await createDefaultConnectionBridge(dialect, options.connectionString);

        if (bridgeErr) {

            return [null, bridgeErr];

        }

        connectionBridge = bridge!;
        ownedConnectionBridge = bridge!;

    }

    // Always create compute pool when not provided
    if (!computePool) {

        computePool = createDefaultComputePool();
        ownedComputePool = computePool;

    }

    // Worker pipeline: offload fetching and serialization to worker threads
    const [result, workerErr] = await exportTableWithWorkers({
        writer,
        dtSchema,
        tableName,
        filepath,
        dialect,
        batchSize,
        connectionBridge,
        computePool,
        kyselyDb,
    });

    // Shut down owned workers
    if (ownedComputePool) {

        await attempt(() => ownedComputePool!.shutdown());

    }

    if (ownedConnectionBridge) {

        await attempt(() => ownedConnectionBridge!.shutdown());

    }

    if (workerErr) {

        return [null, workerErr];

    }

    const durationMs = Date.now() - startTime;

    observer.emit('dt:export:complete', {
        filepath,
        table: tableName,
        rowsWritten: result!.rowsWritten,
        bytesWritten: result!.bytesWritten,
        durationMs,
    });

    return [result, null];

}

/**
 * Build a dialect-appropriate SQL identifier quoting function.
 */
function getQuoteIdent(dialect: string): (c: string) => string {

    if (dialect === 'mssql') return (c: string) => `[${c}]`;
    if (dialect === 'mysql') return (c: string) => `\`${c}\``;

    return (c: string) => `"${c}"`;

}

/**
 * Build a raw SQL string for a paginated SELECT query.
 */
function buildBatchSql(
    dialect: string,
    tableName: string,
    columnList: string,
    orderCol: string,
    batchSize: number,
    offset: number,
): string {

    if (dialect === 'mssql') {

        return `SELECT ${columnList} FROM [${tableName}] ORDER BY ${orderCol} OFFSET ${offset} ROWS FETCH NEXT ${batchSize} ROWS ONLY`;

    }

    return `SELECT ${columnList} FROM "${tableName}" LIMIT ${batchSize} OFFSET ${offset}`;

}

/**
 * Worker-based export pipeline — offload fetching and serialization to worker threads.
 *
 * Uses a three-stage pipeline:
 * 1. Connection worker fetches batches via paginated SQL queries
 * 2. Compute pool serializes individual rows in parallel
 * 3. OrderBuffer reassembles rows in order and writes to DtWriter
 *
 * Backpressure: pauses fetching when pending items exceed batchSize * 3.
 */
async function exportTableWithWorkers(ctx: {
    writer: DtWriter;
    dtSchema: DtSchema;
    tableName: string;
    filepath: string;
    dialect: string;
    batchSize: number;
    connectionBridge?: WorkerBridge<ConnectionEvents>;
    computePool: WorkerPool<ComputeEvents>;
    kyselyDb: Kysely<NoormDatabase>;
}): Promise<[{ rowsWritten: number; bytesWritten: number } | null, Error | null]> {

    const { writer, dtSchema, tableName, filepath, dialect, batchSize } = ctx;
    const { connectionBridge, computePool, kyselyDb } = ctx;
    const backpressureLimit = batchSize * 3;

    // --- Stage 0: Get total row count ---
    let totalRows = 0;

    if (connectionBridge) {

        const countSql = dialect === 'mssql'
            ? `SELECT COUNT(*) AS cnt FROM [${tableName}]`
            : `SELECT COUNT(*) AS cnt FROM "${tableName}"`;

        const [countResult, countErr] = await attempt(() =>
            connectionBridge.request('query', { sql: countSql }),
        );

        if (countErr) {

            return [null, countErr];

        }

        const firstRow = countResult!.rows[0] as Record<string, unknown> | undefined;
        totalRows = Number(firstRow?.['cnt'] ?? 0);

    }

    // --- Stage 1-3: Fetch → Serialize → Write ---
    const columns = dtSchema.columns.map((c) => c.name);
    const quoteIdent = getQuoteIdent(dialect);
    const columnList = columns.map(quoteIdent).join(', ');
    const orderCol = quoteIdent(columns[0]!);

    let globalIndex = 0;
    let loaded = 0;
    let processed = 0;
    let saved = 0;
    let inFlight = 0;
    let pipelineError: Error | null = null;

    // OrderBuffer: flush in-order to writer
    const orderBuffer = new OrderBuffer<DtValue[]>((values) => {

        writer.writeRow(values);
        saved++;
        inFlight--;

        observer.emit('dt:export:saved', { table: tableName, saved, totalRows });

    });

    // Fetch loop
    let offset = 0;

    while (true) {

        // Backpressure: wait until in-flight drops below limit
        while (inFlight >= backpressureLimit) {

            await new Promise((resolve) => setTimeout(resolve, 1));

        }

        // Fetch a batch
        let batchRows: Record<string, unknown>[];

        if (connectionBridge) {

            const batchSql = buildBatchSql(dialect, tableName, columnList, orderCol, batchSize, offset);

            const [queryResult, queryErr] = await attempt(() =>
                connectionBridge.request('query', { sql: batchSql }),
            );

            if (queryErr) {

                pipelineError = queryErr;
                break;

            }

            if (queryResult!.error) {

                pipelineError = new Error(queryResult!.error);
                break;

            }

            batchRows = queryResult!.rows as Record<string, unknown>[];

        }
        else {

            // Direct Kysely fetch when no connection worker is available
            const [rows, fetchErr] = await attempt(() => {

                if (dialect === 'mssql') {

                    return sql<Record<string, unknown>>`
                        SELECT ${sql.raw(columnList)}
                        FROM ${sql.table(tableName)}
                        ORDER BY ${sql.raw(orderCol)}
                        OFFSET ${offset} ROWS
                        FETCH NEXT ${batchSize} ROWS ONLY
                    `.execute(kyselyDb);

                }

                return sql<Record<string, unknown>>`
                    SELECT ${sql.raw(columnList)}
                    FROM ${sql.table(tableName)}
                    LIMIT ${batchSize}
                    OFFSET ${offset}
                `.execute(kyselyDb);

            });

            if (fetchErr) {

                pipelineError = fetchErr;
                break;

            }

            batchRows = rows.rows;

        }

        if (batchRows.length === 0) break;

        loaded += batchRows.length;

        observer.emit('dt:export:loaded', { table: tableName, loaded, totalRows });

        // Dispatch rows to compute pool for serialization
        for (const row of batchRows) {

            const rowIndex = globalIndex++;
            inFlight++;

            // Fire-and-forget — result handled asynchronously
            computePool.request('serialize', {
                row,
                columns: dtSchema.columns,
                index: rowIndex,
            }).then((result) => {

                processed++;

                observer.emit('dt:export:processed', { table: tableName, processed, totalRows });

                if (result.error) {

                    pipelineError = pipelineError ?? new Error(result.error);

                    return;

                }

                orderBuffer.add(result.index, result.values);

            });

        }

        offset += batchRows.length;

        observer.emit('dt:export:progress', {
            filepath,
            table: tableName,
            rowsWritten: writer.rowsWritten,
            bytesWritten: writer.bytesWritten,
        });

        if (batchRows.length < batchSize) break;

    }

    // Wait for all in-flight compute to drain
    while (inFlight > 0) {

        await new Promise((resolve) => setTimeout(resolve, 1));

    }

    if (pipelineError) {

        return [null, pipelineError];

    }

    // Close writer
    const [, closeErr] = await attempt(() => writer.close());

    if (closeErr) {

        return [null, closeErr];

    }

    return [{ rowsWritten: writer.rowsWritten, bytesWritten: writer.bytesWritten }, null];

}

/**
 * Import a .dt/.dtz/.dtzx file into a database table.
 *
 * Reads the file, validates schema against the target, then inserts rows.
 *
 * @param options - Import configuration
 * @returns Row counts, or error
 *
 * @example
 * ```typescript
 * const [result, err] = await importDtFile({
 *     filepath: './data/users.dtz',
 *     db: destDb,
 *     dialect: 'mysql',
 *     onConflict: 'skip',
 * });
 * ```
 */
export async function importDtFile(
    options: ImportFileOptions,
): Promise<[{ rowsImported: number; rowsSkipped: number } | null, Error | null]> {

    const startTime = Date.now();
    const { filepath, db, dialect, passphrase, version } = options;
    const kyselyDb = db as Kysely<NoormDatabase>;
    const batchSize = options.batchSize ?? 1000;

    // Open reader
    const reader = new DtReader({ filepath, passphrase });
    const [, openErr] = await attempt(() => reader.open());

    if (openErr) {

        observer.emit('error', { source: 'dt:import', error: openErr, context: { filepath } });

        return [null, openErr];

    }

    const dtSchema = reader.schema;

    if (!dtSchema) {

        const err = new Error('Failed to read .dt schema');
        observer.emit('error', { source: 'dt:import', error: err, context: { filepath } });

        return [null, err];

    }

    const tableName = dtSchema.t ?? 'unknown';

    observer.emit('dt:import:start', {
        filepath,
        sourceDialect: dtSchema.d,
        sourceVersion: dtSchema.dv,
        table: tableName,
    });

    // Validate schema against target
    const [validation, validateErr] = await validateSchema({
        dtSchema,
        targetDb: kyselyDb,
        targetDialect: dialect,
        targetVersion: version,
    });

    if (validateErr) {

        reader.close();
        observer.emit('error', { source: 'dt:import', error: validateErr, context: { filepath, table: tableName } });

        return [null, validateErr];

    }

    observer.emit('dt:import:schema', {
        filepath,
        table: tableName,
        columns: dtSchema.columns.length,
        validation: validation!,
    });

    // If validation has errors, abort
    if (validation && !validation.valid) {

        reader.close();
        const err = new Error(`Schema validation failed: ${validation.errors.join('; ')}`);
        observer.emit('error', { source: 'dt:import', error: err, context: { filepath, table: tableName } });

        return [null, err];

    }

    // Truncate if requested
    if (options.truncate && tableName !== 'unknown') {

        const truncateSql = dialect === 'postgres'
            ? `TRUNCATE TABLE "${tableName}" CASCADE`
            : dialect === 'mssql'
                ? `DELETE FROM [${tableName}]`
                : `TRUNCATE TABLE \`${tableName}\``;

        const [, truncErr] = await attempt(() => sql.raw(truncateSql).execute(kyselyDb));

        if (truncErr) {

            reader.close();
            const err = new Error(`Failed to truncate: ${truncErr.message}`);
            observer.emit('error', { source: 'dt:import', error: err, context: { filepath, table: tableName } });

            return [null, err];

        }

    }

    // Resolve compute pool — use provided override or create our own
    let ownedComputePool: WorkerPool<ComputeEvents> | null = null;
    let computePool = options.computePool;

    if (!computePool) {

        computePool = createDefaultComputePool();
        ownedComputePool = computePool;

    }

    // Worker pipeline: offload deserialization to compute pool
    const [result, workerErr] = await importFileWithWorkers({
        reader,
        dtSchema,
        tableName,
        filepath,
        dialect,
        version,
        batchSize,
        onConflict: options.onConflict ?? 'fail',
        computePool,
        kyselyDb,
    });

    // Shut down owned compute pool
    if (ownedComputePool) {

        await attempt(() => ownedComputePool!.shutdown());

    }

    if (workerErr) {

        reader.close();
        observer.emit('error', { source: 'dt:import', error: workerErr, context: { filepath, table: tableName } });

        return [null, workerErr];

    }

    reader.close();

    const durationMs = Date.now() - startTime;

    observer.emit('dt:import:complete', {
        filepath,
        table: tableName,
        rowsImported: result!.rowsImported,
        rowsSkipped: result!.rowsSkipped,
        durationMs,
    });

    return [result, null];

}

/**
 * Create a DtStreamer for in-memory cross-dialect conversion.
 *
 * Used internally by the transfer module for cross-dialect DB-to-DB transfers.
 *
 * @param options - Source/target dialects and column definitions
 * @returns Configured DtStreamer instance
 */
export function createStreamer(options: DtStreamerOptions): DtStreamer {

    return new DtStreamer(options);

}

/**
 * Worker-based import pipeline — offload deserialization to compute pool.
 *
 * Uses a three-stage pipeline:
 * 1. DtReader reads rows in batches from the .dt file
 * 2. Compute pool deserializes individual rows in parallel
 * 3. OrderBuffer reassembles in order, accumulates batch, inserts via Kysely
 *
 * Pull-based: reads a batch, waits for drain, then reads the next batch.
 */
async function importFileWithWorkers(ctx: {
    reader: DtReader;
    dtSchema: DtSchema;
    tableName: string;
    filepath: string;
    dialect: Dialect;
    version?: DatabaseVersion;
    batchSize: number;
    onConflict: string;
    computePool: WorkerPool<ComputeEvents>;
    kyselyDb: Kysely<NoormDatabase>;
}): Promise<[{ rowsImported: number; rowsSkipped: number } | null, Error | null]> {

    const { reader, dtSchema, tableName, filepath, dialect, version, batchSize } = ctx;
    const { onConflict, computePool, kyselyDb } = ctx;

    let rowsImported = 0;
    let rowsSkipped = 0;
    let loaded = 0;
    let processed = 0;
    let saved = 0;
    let globalIndex = 0;
    let inFlight = 0;
    let pipelineError: Error | null = null;

    // Count total rows by iterating (we'll re-read). For .dt files,
    // totalRows is estimated from file — for now use 0 as unknown.
    let totalRows = 0;

    // Accumulate ordered deserialized rows for batch insert
    let insertBatch: Record<string, unknown>[] = [];
    const columnNames = dtSchema.columns.map((c) => c.name);

    /**
     * Flush accumulated insert batch to the database.
     */
    const flushInsertBatch = async (): Promise<Error | null> => {

        if (insertBatch.length === 0) return null;

        const [batchResult, insertErr] = await insertImportBatch(
            kyselyDb,
            tableName,
            insertBatch,
            onConflict,
            dialect,
            columnNames,
            rowsImported + rowsSkipped,
        );

        if (insertErr) {

            return insertErr;

        }

        rowsImported += batchResult.inserted + batchResult.updated;
        rowsSkipped += batchResult.skipped;
        insertBatch = [];

        observer.emit('dt:import:progress', {
            filepath,
            table: tableName,
            rowsImported,
            rowsSkipped,
        });

        return null;

    };

    // OrderBuffer: reassemble deserialized rows in order
    const orderBuffer = new OrderBuffer<Record<string, unknown>>((record) => {

        insertBatch.push(record);
        saved++;
        inFlight--;

        observer.emit('dt:import:saved', { table: tableName, saved, totalRows });

    });

    // Read rows in batches from DtReader
    let readBatch: DtValue[][] = [];

    for await (const values of reader.rows()) {

        readBatch.push(values);
        loaded++;
        totalRows = Math.max(totalRows, loaded);

        if (readBatch.length >= batchSize) {

            observer.emit('dt:import:loaded', { table: tableName, loaded, totalRows });

            // Dispatch batch to compute pool
            for (const rowValues of readBatch) {

                const rowIndex = globalIndex++;
                inFlight++;

                computePool.request('deserialize', {
                    values: rowValues,
                    columns: dtSchema.columns,
                    targetDialect: dialect,
                    targetVersion: version ? `${version.major}.${version.minor}` : undefined,
                    index: rowIndex,
                }).then((result) => {

                    processed++;

                    observer.emit('dt:import:processed', { table: tableName, processed, totalRows });

                    if (result.error) {

                        pipelineError = pipelineError ?? new Error(result.error);

                        return;

                    }

                    orderBuffer.add(result.index, result.record);

                });

            }

            readBatch = [];

            // Wait for all in-flight to drain before reading next batch
            while (inFlight > 0) {

                await new Promise((resolve) => setTimeout(resolve, 1));

            }

            if (pipelineError) {

                return [null, pipelineError];

            }

            // Flush accumulated insert batch
            const flushErr = await flushInsertBatch();

            if (flushErr) {

                return [null, flushErr];

            }

        }

    }

    // Process remaining rows
    if (readBatch.length > 0) {

        observer.emit('dt:import:loaded', { table: tableName, loaded, totalRows });

        for (const rowValues of readBatch) {

            const rowIndex = globalIndex++;
            inFlight++;

            computePool.request('deserialize', {
                values: rowValues,
                columns: dtSchema.columns,
                targetDialect: dialect,
                targetVersion: version ? `${version.major}.${version.minor}` : undefined,
                index: rowIndex,
            }).then((result) => {

                processed++;

                observer.emit('dt:import:processed', { table: tableName, processed, totalRows });

                if (result.error) {

                    pipelineError = pipelineError ?? new Error(result.error);

                    return;

                }

                orderBuffer.add(result.index, result.record);

            });

        }

        // Wait for drain
        while (inFlight > 0) {

            await new Promise((resolve) => setTimeout(resolve, 1));

        }

        if (pipelineError) {

            return [null, pipelineError];

        }

        // Flush remaining
        const flushErr = await flushInsertBatch();

        if (flushErr) {

            return [null, flushErr];

        }

    }

    return [{ rowsImported, rowsSkipped }, null];

}

/**
 * Insert a batch of rows for import.
 */
async function insertImportBatch(
    db: Kysely<NoormDatabase>,
    table: string,
    rows: Record<string, unknown>[],
    onConflict: string,
    dialect: string,
    columns: string[],
    startRowIndex = 0,
): Promise<[{ inserted: number; skipped: number; updated: number }, Error | null]> {

    let inserted = 0;
    let skipped = 0;
    let updated = 0;

    for (let i = 0; i < rows.length; i++) {

        const row = rows[i]!;
        const globalRowNum = startRowIndex + i + 1;

        /** Summarize first 5 columns as `col=value, col=value`, truncated to 100 chars. */
        const rowSummary = (): string => {

            const entries = Object.entries(row).slice(0, 5);
            const parts = entries.map(([k, v]) => `${k}=${v === null ? 'NULL' : String(v)}`);
            const full = parts.join(', ');

            return full.length > 100 ? full.slice(0, 97) + '...' : full;

        };

        const [, err] = await attempt(() =>
            db.insertInto(table as never).values(row as never).execute(),
        );

        if (err) {

            if (!isDuplicateError(err.message)) {

                // Non-duplicate error — log first occurrence for diagnostics
                if (skipped === 0 && inserted === 0) {

                    observer.emit('error', {
                        source: 'dt:import',
                        error: err,
                        context: { table, operation: 'insert-row', onConflict, row: Object.keys(row).slice(0, 5).join(', ') },
                    });

                }

                // Non-duplicate error
                if (onConflict === 'fail') {

                    return [{ inserted, skipped, updated }, new Error(`Row ${globalRowNum} (${rowSummary()}): ${err.message}`)];

                }

                skipped++;
                continue;

            }

            // Duplicate key error
            if (onConflict === 'skip') {

                skipped++;

            }
            else if (onConflict === 'update') {

                // Try to update existing row
                const [updateResult, updateErr] = await attemptUpdate(db, table, row, dialect, columns);

                if (updateErr) {

                    return [{ inserted, skipped, updated }, new Error(`Row ${globalRowNum} (${rowSummary()}): ${updateErr.message}`)];

                }

                if (updateResult) {

                    updated++;

                }
                else {

                    skipped++;

                }

            }
            else if (onConflict === 'fail') {

                return [{ inserted, skipped, updated }, new Error(`Row ${globalRowNum}: ${err.message}`)];

            }
            else {

                skipped++;

            }

        }
        else {

            inserted++;

        }

    }

    return [{ inserted, skipped, updated }, null];

}

/**
 * Attempt to update an existing row.
 *
 * Uses the first column as the primary key for the WHERE clause.
 * This is a heuristic - ideally we'd know the actual PK from schema.
 */
async function attemptUpdate(
    db: Kysely<NoormDatabase>,
    table: string,
    row: Record<string, unknown>,
    _dialect: string,
    columns: string[],
): Promise<[boolean, Error | null]> {

    // Assume first column is the primary key (common convention)
    const pkColumn = columns[0];

    if (!pkColumn || row[pkColumn] === undefined) {

        return [false, null];

    }

    const pkValue = row[pkColumn];

    // Build update values (exclude PK column)
    const updateValues: Record<string, unknown> = {};

    for (const col of columns) {

        if (col !== pkColumn && row[col] !== undefined) {

            updateValues[col] = row[col];

        }

    }

    if (Object.keys(updateValues).length === 0) {

        // Nothing to update besides PK
        return [true, null];

    }

    // Use Kysely's update builder for proper value handling
    const [, err] = await attempt(() =>
        db
            .updateTable(table as never)
            .set(updateValues as never)
            .where(pkColumn as never, '=', pkValue as never)
            .execute(),
    );

    if (err) {

        return [false, err];

    }

    return [true, null];

}

/**
 * Check if an error is a duplicate key violation.
 */
function isDuplicateError(message: string): boolean {

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

// Re-export public types and classes
export type {
    DtSchema,
    DtColumn,
    DtValue,
    UniversalType,
    SimpleType,
    EncodedType,
    Encoding,
    EncodedValue,
    FormatVersion,
    DatabaseVersion,
    TypeMappingResult,
    DtWriterOptions,
    DtReaderOptions,
    DtStreamerOptions,
    BuildSchemaOptions,
    ValidateSchemaOptions,
    SchemaValidationResult,
    ExportTableOptions,
    ImportFileOptions,
    DtEncryptedPayload,
} from './types.js';

export type { DtEvents } from './events.js';

export { DtWriter } from './writer.js';
export { DtReader } from './reader.js';
export { DtStreamer } from './streamer.js';
export { buildDtSchema, validateSchema } from './schema.js';
export { queryDatabaseVersion } from './version.js';
export { toUniversalType, toDialectType, isEncodedType } from './type-map.js';
export { serializeRow, serializeValue, encodeValue } from './serialize.js';
export { deserializeRow, deserializeValue } from './deserialize.js';
export { encryptWithPassphrase, decryptWithPassphrase } from './crypto.js';
export { FORMAT_VERSION, GZIP_THRESHOLD, GZIP_RATIO_THRESHOLD, SIMPLE_TYPES, ENCODED_TYPES } from './constants.js';
export { resolveExportExtension, resolveExportPath, ensureExportDirectory } from './paths.js';

export { modifyDtFile, transformSchema, validateRecipe, buildRowProxy } from './modify.js';
export type {
    Recipe,
    Modification,
    DropColumn,
    AddColumn,
    RenameColumn,
    AlterColumn,
    FilterRows,
    DefaultValue,
    LiteralDefault,
    ExpressionDefault,
    ModifyResult,
    ModifyOptions,
} from './modify.js';
