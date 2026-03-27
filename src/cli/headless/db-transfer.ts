/**
 * Database transfer headless command.
 *
 * Transfers data between database configurations using ctx.noorm methods.
 */
import { attempt } from '@logosdx/utils';

import type { Logger } from '../../core/logger/index.js';
import { withContext, outputError, type HeadlessCommand } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';
import { resolveExportExtension, resolveExportPath, ensureExportDirectory } from '../../core/dt/index.js';
import { getStateManager } from '../../core/state/index.js';
import type { TransferOptions, ConflictStrategy } from '../../core/transfer/index.js';

export const help = `
# DB TRANSFER

Transfer data between database configurations

## Usage

    noorm db transfer --to <config> [options]
    noorm db transfer <source> --to <destination> [options]
    noorm db transfer --export <path> [options]
    noorm db transfer --import <path> [options]

## Arguments

    source         Source config name (defaults to active config)

## Flags

    --to           Destination config name (required for db-to-db)
    --export       Export path: file (single table) or directory (multi-table)
    --import       Import from .dt/.dtz/.dtzx file path
    --compress     Compress export as .dtz (default: plain .dt)
    --passphrase   Passphrase for .dtzx encryption/decryption (implies compression)
    --tables       Comma-separated list of tables (default: all)
    --on-conflict  Conflict strategy: fail, skip, update, replace (default: fail)
    --batch-size   Rows per batch for cross-server transfers (default: 1000)
    --truncate     Truncate destination tables before transfer
    --no-fk        Do not disable foreign key checks
    --no-identity  Do not preserve identity/auto-increment values
    --dry-run      Show transfer plan without executing

## Description

Transfers data from source to destination database. Both must use the same
dialect (PostgreSQL, MySQL, or MSSQL). Tables are transferred in foreign key
dependency order.

Same-server transfers use efficient direct INSERT...SELECT. Cross-server
transfers use batched reads/writes.

Use --export to write tables to .dt files instead of transferring to a
database. For single-table export, --export is the file path. For multi-table
export, --export is a directory and noorm generates <table>.<ext> per table.
Output is plain .dt by default; use --compress for .dtz or --passphrase for
encrypted .dtzx. Use --import to load .dt files into the active database.

Flags --to, --export, and --import are mutually exclusive.

## Conflict Strategies

    fail     Abort on first primary key conflict (default)
    skip     Skip conflicting rows, continue transfer
    update   Update existing rows with source data
    replace  Delete and re-insert conflicting rows

## Examples

    # Transfer all tables from active config to backup
    noorm -H db transfer --to backup

    # Transfer specific tables
    noorm -H db transfer --to backup --tables users,posts,comments

    # Transfer with upsert behavior
    noorm -H db transfer --to backup --on-conflict update

    # Preview transfer plan
    noorm -H db transfer --to backup --dry-run

    # Clear destination tables before transfer
    noorm -H db transfer --to backup --truncate

    # Export single table (plain .dt)
    noorm -H db transfer --export ./backup/users.dt --tables users

    # Export single table compressed
    noorm -H db transfer --export ./backup/users --tables users --compress

    # Export all tables to directory (plain .dt per table)
    noorm -H db transfer --export ./backup/

    # Export all tables compressed
    noorm -H db transfer --export ./backup/ --compress

    # Export with encryption (implies compression)
    noorm -H db transfer --export ./backup/ --passphrase mySecret

    # Import from .dt file
    noorm -H db transfer --import ./backup/users.dt

    # Import encrypted file with conflict skipping
    noorm -H db transfer --import ./backup/users.dtzx --passphrase mySecret --on-conflict skip

## JSON Output

    {
        "success": true,
        "status": "success",
        "tables": [
            {
                "table": "users",
                "status": "success",
                "rowsTransferred": 1500,
                "rowsSkipped": 0,
                "durationMs": 234
            }
        ],
        "totalRows": 1500,
        "durationMs": 1234
    }
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    const destConfigName = flags['to'] as string | undefined;
    const exportPath = flags['export'] as string | undefined;
    const importPath = flags['import'] as string | undefined;
    const passphrase = flags['passphrase'] as string | undefined;
    const compress = flags['compress'] === true;

    // Validate --compress only valid with --export
    if (compress && !exportPath) {

        return outputError(flags, logger, '--compress is only valid with --export');

    }

    // Validate mutually exclusive modes
    const modeCount = [destConfigName, exportPath, importPath].filter(Boolean).length;

    if (modeCount > 1) {

        return outputError(flags, logger, 'Flags --to, --export, and --import are mutually exclusive');

    }

    if (modeCount === 0) {

        if (flags.json) {

            logger.result({
                success: false,
                error: 'One of --to, --export, or --import is required. Usage: noorm db transfer --to <config>',
            });

        }
        else {

            const output = formatHelp(help);
            process.stdout.write(output + '\n');

        }

        return 1;

    }

    // Validate .dtzx requires passphrase
    if (exportPath?.endsWith('.dtzx') && !passphrase) {

        return outputError(flags, logger, '--passphrase required for .dtzx encrypted export');

    }

    if (importPath?.endsWith('.dtzx') && !passphrase) {

        return outputError(flags, logger, '--passphrase required for .dtzx encrypted import');

    }

    const tables = flags['tables'] ? String(flags['tables']).split(',').map((t: string) => t.trim()) : undefined;
    const batchSize = flags['batch-size'] ? parseInt(String(flags['batch-size']), 10) : undefined;

    // -----------------------------------------------------------------------
    // Export mode — uses ctx.noorm.dt.exportTable
    // -----------------------------------------------------------------------

    if (exportPath) {

        return handleExport({
            exportPath,
            passphrase,
            compress,
            tables,
            batchSize,
            flags,
            logger,
        });

    }

    // -----------------------------------------------------------------------
    // Import mode — uses ctx.noorm.dt.importFile
    // -----------------------------------------------------------------------

    if (importPath) {

        return handleImport({
            importPath,
            passphrase,
            tables,
            batchSize,
            onConflict: (flags['on-conflict'] ?? 'fail') as ConflictStrategy,
            truncate: flags['truncate'] === true,
            flags,
            logger,
        });

    }

    // -----------------------------------------------------------------------
    // DB-to-DB transfer mode — uses ctx.noorm.transfer.to / transfer.plan
    // -----------------------------------------------------------------------

    // Load state to resolve dest config
    const stateManager = getStateManager(process.cwd());
    const [, loadErr] = await attempt(() => stateManager.load());

    if (loadErr) {

        return outputError(flags, logger, loadErr.message);

    }

    const destConfig = stateManager.getConfig(destConfigName!);

    if (!destConfig) {

        return outputError(flags, logger, `Destination config not found: ${destConfigName}`);

    }

    // Build options
    const options: TransferOptions = {
        tables,
        onConflict: (flags['on-conflict'] ?? 'fail') as ConflictStrategy,
        batchSize,
        disableForeignKeys: flags['no-fk'] !== true,
        preserveIdentity: flags['no-identity'] !== true,
        truncateFirst: flags['truncate'] === true,
        dryRun: flags.dryRun === true,
    };

    if (!flags.json) {

        logger.info(`Transferring to "${destConfigName}"...`);

    }

    // Dry run - just show plan
    if (options.dryRun) {

        const [plan, planError] = await withContext({
            flags,
            logger,
            fn: (ctx) => ctx.noorm.transfer.plan(destConfig, options),
        });

        if (planError) return 1;

        const [planResult, planErr] = plan;

        if (planErr) {

            return outputError(flags, logger, planErr.message);

        }

        if (flags.json) {

            logger.result({
                success: true,
                dryRun: true,
                sameServer: planResult?.sameServer,
                tableCount: planResult?.tables.length ?? 0,
                estimatedRows: planResult?.estimatedRows ?? 0,
                tables: planResult?.tables.map((t) => ({
                    name: t.name,
                    rowCount: t.rowCount,
                    hasIdentity: t.hasIdentity,
                    dependsOn: t.dependsOn,
                })),
                warnings: planResult?.warnings ?? [],
            });

        }
        else {

            logger.info('Dry run - transfer plan:');
            logger.info(`  Same server: ${planResult?.sameServer ? 'yes' : 'no'}`);
            logger.info(`  Tables: ${planResult?.tables.length ?? 0}`);
            logger.info(`  Estimated rows: ${planResult?.estimatedRows ?? 0}`);

            if (planResult?.tables.length) {

                logger.info('\n  Transfer order:');

                for (const t of planResult.tables) {

                    const deps = t.dependsOn.length > 0 ? ` (after: ${t.dependsOn.join(', ')})` : '';
                    logger.info(`    ${t.name} - ${t.rowCount} rows${deps}`);

                }

            }

            if (planResult?.warnings.length) {

                logger.info('\n  Warnings:');

                for (const w of planResult.warnings) {

                    logger.info(`    - ${w}`);

                }

            }

        }

        return 0;

    }

    // Execute transfer
    const [transferResult, transferError] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.noorm.transfer.to(destConfig, options),
    });

    if (transferError) return 1;

    const [result, transferErr] = transferResult;

    if (transferErr) {

        return outputError(flags, logger, transferErr.message);

    }

    if (flags.json) {

        logger.result({
            success: result?.status === 'success',
            status: result?.status,
            tables: result?.tables,
            totalRows: result?.totalRows,
            durationMs: result?.durationMs,
        });

    }
    else {

        const successCount = result?.tables.filter((t) => t.status === 'success').length ?? 0;
        const failedCount = result?.tables.filter((t) => t.status === 'failed').length ?? 0;

        logger.info(`Transfer complete: ${result?.status}`);
        logger.info(`  Total rows: ${result?.totalRows}`);
        logger.info(`  Tables: ${successCount} success, ${failedCount} failed`);
        logger.info(`  Duration: ${((result?.durationMs ?? 0) / 1000).toFixed(2)}s`);

        // Show failures
        const failures = result?.tables.filter((t) => t.status === 'failed') ?? [];

        for (const f of failures) {

            logger.error(`  ${f.table}: ${f.error}`);

        }

    }

    return result?.status === 'success' ? 0 : 2;

};

// ---------------------------------------------------------------------------
// Export handler — uses ctx.noorm.dt.exportTable
// ---------------------------------------------------------------------------

/**
 * Handle --export flag: export tables to .dt/.dtz/.dtzx file.
 *
 * Path resolution:
 * - Single table: use exportPath as file path, append extension if missing
 * - Multiple tables: treat exportPath as directory, generate <table>.<ext> per table
 */
async function handleExport(opts: {
    exportPath: string;
    passphrase?: string;
    compress: boolean;
    tables?: string[];
    batchSize?: number;
    flags: Record<string, unknown>;
    logger: Logger;
}): Promise<number> {

    const { exportPath, passphrase, compress, tables, batchSize, flags, logger } = opts;

    // Determine export extension
    const ext = resolveExportExtension(compress, passphrase);
    const tableList = tables ?? [];
    const tableCount = tableList.length;

    // Ensure export directory exists
    ensureExportDirectory(exportPath, tableCount);

    if (!flags['json']) {

        logger.info(`Exporting to ${exportPath}...`);

    }

    const [exportResults, error] = await withContext({
        flags: flags as never,
        logger,
        fn: async (ctx) => {

            let totalRows = 0;
            let totalBytes = 0;
            const tableResults: Array<{ table: string; filepath: string; rows: number; bytes: number }> = [];

            for (const tableName of tableList) {

                const filepath = resolveExportPath({
                    exportPath,
                    tableName,
                    tableCount,
                    ext,
                });

                const [result, err] = await ctx.noorm.dt.exportTable(tableName, filepath, {
                    passphrase,
                    batchSize,
                });

                if (err) {

                    throw err;

                }

                totalRows += result?.rowsWritten ?? 0;
                totalBytes += result?.bytesWritten ?? 0;
                tableResults.push({
                    table: tableName,
                    filepath,
                    rows: result?.rowsWritten ?? 0,
                    bytes: result?.bytesWritten ?? 0,
                });

            }

            return { totalRows, totalBytes, tableResults };

        },
    });

    if (error) {

        if (flags['json']) {

            logger.result({ success: false, error: error.message });

        }

        return 1;

    }

    const { totalRows, totalBytes, tableResults } = exportResults;

    if (flags['json']) {

        const output: Record<string, unknown> = {
            success: true,
            mode: 'export',
            tables: tableResults.map((t) => ({
                table: t.table,
                filepath: t.filepath,
                rowsExported: t.rows,
                bytesWritten: t.bytes,
            })),
            totalRows,
            totalBytes,
        };

        // Include directory for multi-table, filepath for single-table
        if (tableCount === 1 && tableResults[0]) {

            output['filepath'] = tableResults[0].filepath;

        }
        else {

            output['directory'] = exportPath;

        }

        logger.result(output);

    }
    else {

        logger.info(`Export complete: ${totalRows} rows, ${totalBytes} bytes`);

        for (const t of tableResults) {

            logger.info(`  ${t.table}: ${t.rows} rows → ${t.filepath}`);

        }

    }

    return 0;

}

// ---------------------------------------------------------------------------
// Import handler — uses ctx.noorm.dt.importFile
// ---------------------------------------------------------------------------

/**
 * Handle --import flag: import .dt/.dtz/.dtzx file into database.
 */
async function handleImport(opts: {
    importPath: string;
    passphrase?: string;
    tables?: string[];
    batchSize?: number;
    onConflict: ConflictStrategy;
    truncate: boolean;
    flags: Record<string, unknown>;
    logger: Logger;
}): Promise<number> {

    const { importPath, passphrase, batchSize, onConflict, truncate, flags, logger } = opts;

    if (!flags['json']) {

        logger.info(`Importing ${importPath}...`);

    }

    const [importResult, error] = await withContext({
        flags: flags as never,
        logger,
        fn: async (ctx) => {

            const [result, err] = await ctx.noorm.dt.importFile(importPath, {
                passphrase,
                batchSize,
                onConflict,
                truncate,
            });

            if (err) {

                throw err;

            }

            return result;

        },
    });

    if (error) {

        if (flags['json']) {

            logger.result({ success: false, error: error.message });

        }

        return 1;

    }

    if (flags['json']) {

        logger.result({
            success: true,
            mode: 'import',
            filepath: importPath,
            rowsImported: importResult?.rowsImported ?? 0,
            rowsSkipped: importResult?.rowsSkipped ?? 0,
        });

    }
    else {

        logger.info(`Import complete: ${importResult?.rowsImported ?? 0} rows imported, ${importResult?.rowsSkipped ?? 0} skipped`);

    }

    return 0;

}
