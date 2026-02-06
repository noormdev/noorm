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
import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';

import type { Kysely } from 'kysely';
import type { NoormDatabase } from '../shared/tables.js';
import type { ExportTableOptions, ImportFileOptions, DtStreamerOptions } from './types.js';

import { observer } from '../observer.js';
import { DtWriter } from './writer.js';
import { DtReader } from './reader.js';
import { DtStreamer } from './streamer.js';
import { buildDtSchema, validateSchema } from './schema.js';
import { serializeRow } from './serialize.js';
import { deserializeRow } from './deserialize.js';

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

    // Fetch and write in batches
    let offset = 0;
    const columns = dtSchema.columns.map((c) => c.name);
    const quoteIdent = dialect === 'mssql'
        ? (c: string) => `[${c}]`
        : dialect === 'mysql'
            ? (c: string) => `\`${c}\``
            : (c: string) => `"${c}"`;

    const columnList = columns.map(quoteIdent).join(', ');

    while (true) {

        const [rows, fetchErr] = await attempt(() => {

            if (dialect === 'mssql') {

                const orderCol = quoteIdent(columns[0]!);

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

            return [null, fetchErr];

        }

        if (rows.rows.length === 0) break;

        // Serialize and write each row
        for (const row of rows.rows) {

            const values = serializeRow({ row, columns: dtSchema.columns });
            writer.writeRow(values);

        }

        offset += rows.rows.length;

        observer.emit('dt:export:progress', {
            filepath,
            table: tableName,
            rowsWritten: writer.rowsWritten,
            bytesWritten: writer.bytesWritten,
        });

        if (rows.rows.length < batchSize) break;

    }

    // Close writer
    const [, closeErr] = await attempt(() => writer.close());

    if (closeErr) {

        return [null, closeErr];

    }

    const durationMs = Date.now() - startTime;

    observer.emit('dt:export:complete', {
        filepath,
        table: tableName,
        rowsWritten: writer.rowsWritten,
        bytesWritten: writer.bytesWritten,
        durationMs,
    });

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

    // Import rows in batches
    let rowsImported = 0;
    let rowsSkipped = 0;
    let batch: Record<string, unknown>[] = [];

    for await (const values of reader.rows()) {

        const row = deserializeRow({
            values,
            columns: dtSchema.columns,
            targetDialect: dialect,
            targetVersion: version,
        });

        batch.push(row);

        if (batch.length >= batchSize) {

            const columnNames = dtSchema.columns.map((c) => c.name);
            const [batchResult, insertErr] = await insertImportBatch(
                kyselyDb,
                tableName,
                batch,
                options.onConflict ?? 'fail',
                dialect,
                columnNames,
            );

            if (insertErr) {

                reader.close();
                observer.emit('error', { source: 'dt:import', error: insertErr, context: { filepath, table: tableName } });

                return [null, insertErr];

            }

            rowsImported += batchResult.inserted + batchResult.updated;
            rowsSkipped += batchResult.skipped;
            batch = [];

            observer.emit('dt:import:progress', {
                filepath,
                table: tableName,
                rowsImported,
                rowsSkipped,
            });

        }

    }

    // Insert remaining rows
    if (batch.length > 0) {

        const columnNames = dtSchema.columns.map((c) => c.name);
        const [batchResult, insertErr] = await insertImportBatch(
            kyselyDb,
            tableName,
            batch,
            options.onConflict ?? 'fail',
            dialect,
            columnNames,
        );

        if (insertErr) {

            reader.close();
            observer.emit('error', { source: 'dt:import', error: insertErr, context: { filepath, table: tableName } });

            return [null, insertErr];

        }

        rowsImported += batchResult.inserted + batchResult.updated;
        rowsSkipped += batchResult.skipped;

    }

    reader.close();

    const durationMs = Date.now() - startTime;

    observer.emit('dt:import:complete', {
        filepath,
        table: tableName,
        rowsImported,
        rowsSkipped,
        durationMs,
    });

    return [{ rowsImported, rowsSkipped }, null];

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
 * Insert a batch of rows for import.
 */
async function insertImportBatch(
    db: Kysely<NoormDatabase>,
    table: string,
    rows: Record<string, unknown>[],
    onConflict: string,
    dialect: string,
    columns: string[],
): Promise<[{ inserted: number; skipped: number; updated: number }, Error | null]> {

    let inserted = 0;
    let skipped = 0;
    let updated = 0;

    for (const row of rows) {

        const [, err] = await attempt(() =>
            db.insertInto(table as never).values(row as never).execute(),
        );

        if (err) {

            if (!isDuplicateError(err.message)) {

                // Non-duplicate error
                if (onConflict === 'fail') {

                    return [{ inserted, skipped, updated }, err];

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

                    return [{ inserted, skipped, updated }, updateErr];

                }

                if (updateResult) {

                    updated++;

                }
                else {

                    skipped++;

                }

            }
            else if (onConflict === 'fail') {

                return [{ inserted, skipped, updated }, err];

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
