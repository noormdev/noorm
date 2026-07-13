/**
 * noorm db transfer — transfer data between database configurations.
 *
 * Transfers data to another DB config, or exports/imports .dt files.
 */
import * as p from '@clack/prompts';
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { resolveExportExtension, resolveExportPath, ensureExportDirectory } from '../../core/dt/index.js';
import { MIN_PASSPHRASE_LENGTH } from '../../core/dt/crypto.js';
import { getStateManager } from '../../core/state/index.js';
import type { TransferOptions, ConflictStrategy } from '../../core/transfer/index.js';
import { withContext, outputResult, outputError, sharedArgs, type CliArgs } from '../_utils.js';

// ---------------------------------------------------------------------------
// Shared args type for this command
// ---------------------------------------------------------------------------

type TransferArgs = CliArgs & {
    to?: string;
    export?: string;
    import?: string;
    compress?: boolean;
    passphrase?: string;
    tables?: string;
    onConflict?: string;
    batchSize?: string;
    truncate?: boolean;
    noFk?: boolean;
    noIdentity?: boolean;
    dryRun?: boolean;
};

// ---------------------------------------------------------------------------
// ConflictStrategy validation
// ---------------------------------------------------------------------------

const VALID_CONFLICT_STRATEGIES = { fail: true, skip: true, update: true, replace: true } as const;

type ValidStrategy = keyof typeof VALID_CONFLICT_STRATEGIES;

function isConflictStrategy(value: unknown): value is ValidStrategy {

    return typeof value === 'string' && value in VALID_CONFLICT_STRATEGIES;

}

// ---------------------------------------------------------------------------
// Passphrase resolution — flag, masked prompt, or CI escape hatch
// ---------------------------------------------------------------------------

/**
 * Resolve the passphrase for a .dtzx export, enforcing MIN_PASSPHRASE_LENGTH.
 *
 * A bare `--passphrase` flag leaks via ps/shell history, so an interactive
 * TTY session (and no `--json`) prompts via a masked @clack/prompts input
 * instead. Non-interactive callers without the flag get an immediate,
 * actionable exit rather than hanging on a stdin read — the documented CI
 * escape hatch is still the flag.
 */
async function resolveExportPassphrase(passphrase: string | undefined, args: TransferArgs): Promise<string> {

    if (passphrase) {

        if (passphrase.length < MIN_PASSPHRASE_LENGTH) {

            outputError(args, `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
            process.exit(1);

        }

        return passphrase;

    }

    if (!process.stdin.isTTY || args.json) {

        outputError(args, '--passphrase required for .dtzx encrypted export (non-interactive session; pass --passphrase or run interactively for a masked prompt)');
        process.exit(1);

    }

    const result = await p.password({
        message: 'Passphrase for .dtzx encryption',
        validate: (value) => (
            value && value.length >= MIN_PASSPHRASE_LENGTH
                ? undefined
                : `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`
        ),
    });

    if (p.isCancel(result)) {

        p.cancel('Cancelled.');
        process.exit(0);

    }

    return result;

}

/**
 * Resolve the passphrase for a .dtzx import.
 *
 * No length floor — legacy archives may have been encrypted with a
 * passphrase shorter than MIN_PASSPHRASE_LENGTH, and a wrong passphrase
 * already fails via GCM auth tag verification. Same masked-prompt /
 * CI-escape-hatch idiom as the export path.
 */
async function resolveImportPassphrase(passphrase: string | undefined, args: TransferArgs): Promise<string> {

    if (passphrase) return passphrase;

    if (!process.stdin.isTTY || args.json) {

        outputError(args, '--passphrase required for .dtzx encrypted import (non-interactive session; pass --passphrase or run interactively for a masked prompt)');
        process.exit(1);

    }

    const result = await p.password({
        message: 'Passphrase for .dtzx decryption',
        validate: (value) => (value ? undefined : 'Passphrase is required'),
    });

    if (p.isCancel(result)) {

        p.cancel('Cancelled.');
        process.exit(0);

    }

    return result;

}

const transferCommand = defineCommand({
    meta: {
        name: 'transfer',
        description: 'Transfer data between database configurations',
    },
    args: {
        config: sharedArgs.config,
        force: sharedArgs.force,
        dryRun: sharedArgs.dryRun,
        json: sharedArgs.json,
        to: {
            type: 'string',
            description: 'Destination config name (required for db-to-db)',
        },
        export: {
            type: 'string',
            description: 'Export path: file (single table) or directory (multi-table)',
        },
        import: {
            type: 'string',
            description: 'Import from .dt/.dtz/.dtzx file path',
        },
        compress: {
            type: 'boolean',
            description: 'Compress export as .dtz (default: plain .dt)',
        },
        passphrase: {
            type: 'string',
            description: `Passphrase for .dtzx (implies compression, min ${MIN_PASSPHRASE_LENGTH} chars on export). Omit on TTY for masked prompt.`,
        },
        tables: {
            type: 'string',
            description: 'Comma-separated list of tables (default: all)',
        },
        onConflict: {
            type: 'string',
            description: 'Conflict strategy: fail, skip, update, replace (default: fail)',
        },
        batchSize: {
            type: 'string',
            description: 'Rows per batch for cross-server transfers (default: 1000)',
        },
        truncate: {
            type: 'boolean',
            description: 'Truncate destination tables before transfer',
        },
        noFk: {
            type: 'boolean',
            description: 'Do not disable foreign key checks',
        },
        noIdentity: {
            type: 'boolean',
            description: 'Do not preserve identity/auto-increment values',
        },
    },
    async run({ args }) {

        const destConfigName = args.to;
        const exportPath = args.export;
        const importPath = args.import;
        let passphrase = args.passphrase;
        const compress = args.compress === true;

        if (compress && !exportPath) {

            outputError(args, '--compress is only valid with --export');
            process.exit(1);

        }

        const modeCount = [destConfigName, exportPath, importPath].filter(Boolean).length;

        if (modeCount > 1) {

            outputError(args, 'Flags --to, --export, and --import are mutually exclusive');
            process.exit(1);

        }

        if (modeCount === 0) {

            outputError(args, 'One of --to, --export, or --import is required. Usage: noorm db transfer --to <config>');
            process.exit(1);

        }

        if (exportPath?.endsWith('.dtzx')) {

            passphrase = await resolveExportPassphrase(passphrase, args);

        }

        if (importPath?.endsWith('.dtzx')) {

            passphrase = await resolveImportPassphrase(passphrase, args);

        }

        // Validate --on-conflict once before mode dispatch
        const rawConflict = args.onConflict ?? 'fail';

        if (!isConflictStrategy(rawConflict)) {

            outputError(args, `Invalid --on-conflict value: "${rawConflict}". Must be one of: fail, skip, update, replace`);
            process.exit(1);

        }

        const onConflict: ConflictStrategy = rawConflict;

        const tableList = args.tables ? String(args.tables).split(',').map((t) => t.trim()) : undefined;
        const batchSize = args.batchSize ? parseInt(String(args.batchSize), 10) : undefined;

        if (exportPath) {

            const code = await handleExport({
                exportPath,
                passphrase,
                compress,
                tables: tableList,
                batchSize,
                args,
            });
            process.exit(code);

        }

        if (importPath) {

            const code = await handleImport({
                importPath,
                passphrase,
                tables: tableList,
                batchSize,
                onConflict,
                truncate: args.truncate === true,
                args,
            });
            process.exit(code);

        }

        // DB-to-DB transfer
        const stateManager = getStateManager(process.cwd());
        const [, loadErr] = await attempt(() => stateManager.load());

        if (loadErr) {

            outputError(args, loadErr.message);
            process.exit(1);

        }

        const destConfig = stateManager.getConfig(destConfigName!);

        if (!destConfig) {

            outputError(args, `Destination config not found: ${destConfigName}`);
            process.exit(1);

        }

        const options: TransferOptions = {
            tables: tableList,
            onConflict,
            batchSize,
            disableForeignKeys: args.noFk !== true,
            preserveIdentity: args.noIdentity !== true,
            truncateFirst: args.truncate === true,
            dryRun: args.dryRun === true,
        };

        if (options.dryRun) {

            const [plan, planError] = await withContext({
                args,
                fn: async (ctx, logger) => {

                    if (!args.json) {

                        logger.info(`Planning transfer to "${destConfigName}"...`);

                    }

                    const result = await ctx.noorm.transfer.plan(destConfig, options);

                    return result;

                },
            });

            if (planError) process.exit(1);

            const planResult = plan;

            if (args.json) {

                outputResult(args, {
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
                }, '');

            }
            else {

                // Human-readable dry-run plan summary
                process.stdout.write('Dry run - transfer plan:\n');
                process.stdout.write(`  Same server: ${planResult?.sameServer ? 'yes' : 'no'}\n`);
                process.stdout.write(`  Tables: ${planResult?.tables.length ?? 0}\n`);
                process.stdout.write(`  Estimated rows: ${planResult?.estimatedRows ?? 0}\n`);

                if (planResult?.tables.length) {

                    process.stdout.write('\n  Transfer order:\n');

                    for (const t of planResult.tables) {

                        const deps = t.dependsOn.length > 0 ? ` (after: ${t.dependsOn.join(', ')})` : '';
                        process.stdout.write(`    ${t.name} - ${t.rowCount} rows${deps}\n`);

                    }

                }

                if (planResult?.warnings.length) {

                    process.stdout.write('\n  Warnings:\n');

                    for (const w of planResult.warnings) {

                        process.stdout.write(`    - ${w}\n`);

                    }

                }

            }

            process.exit(0);

        }

        const [transferResult, transferError] = await withContext({
            args,
            fn: (ctx, logger) => {

                if (!args.json) {

                    logger.info(`Transferring to "${destConfigName}"...`);

                }

                return ctx.noorm.transfer.to(destConfig, options);

            },
        });

        if (transferError) process.exit(1);

        const result = transferResult;

        if (args.json) {

            outputResult(args, {
                success: result?.status === 'success',
                status: result?.status,
                tables: result?.tables,
                totalRows: result?.totalRows,
                durationMs: result?.durationMs,
                fkChecksRestored: result?.fkChecksRestored,
            }, '');

        }
        else {

            const successCount = result?.tables.filter((t) => t.status === 'success').length ?? 0;
            const failedCount = result?.tables.filter((t) => t.status === 'failed').length ?? 0;

            process.stdout.write(`Transfer complete: ${result?.status}\n`);
            process.stdout.write(`  Total rows: ${result?.totalRows}\n`);
            process.stdout.write(`  Tables: ${successCount} success, ${failedCount} failed\n`);
            process.stdout.write(`  Duration: ${((result?.durationMs ?? 0) / 1000).toFixed(2)}s\n`);

            if (result?.fkChecksRestored === false) {

                process.stderr.write(
                    'WARNING: foreign key checks were NOT restored on the destination — '
                    + 'referential integrity may be disabled. Re-enable manually.\n',
                );

            }

            const failures = result?.tables.filter((t) => t.status === 'failed') ?? [];

            for (const f of failures) {

                process.stderr.write(`  ${f.table}: ${f.error}\n`);

            }

        }

        process.exit(result?.status === 'success' ? 0 : 2);

    },
});

(transferCommand as typeof transferCommand & { examples: string[] }).examples = [
    'noorm db transfer --to backup',
    'noorm db transfer --to prod --tables users,posts',
    'noorm db transfer --to backup --on-conflict update',
    'noorm db transfer --to backup --dry-run',
    'noorm db transfer --export ./backup/ --compress',
    'noorm db transfer --export ./backup/users.dt --tables users',
    'noorm db transfer --import ./backup/users.dt',
    'noorm db transfer --import ./backup/users.dtzx --passphrase correct-horse-battery',
    'noorm db transfer --export ./backup/users.dtzx  # omits --passphrase, prompts interactively',
];

export default transferCommand;

// ---------------------------------------------------------------------------
// Export handler
// ---------------------------------------------------------------------------

/**
 * Handle --export flag: export tables to .dt/.dtz/.dtzx file.
 */
async function handleExport(opts: {
    exportPath: string;
    passphrase?: string;
    compress: boolean;
    tables?: string[];
    batchSize?: number;
    args: TransferArgs;
}): Promise<number> {

    const { exportPath, passphrase, compress, tables, batchSize, args } = opts;

    const ext = resolveExportExtension(compress, passphrase);
    const tableList = tables ?? [];
    const tableCount = tableList.length;

    ensureExportDirectory(exportPath, tableCount);

    const [exportResults, error] = await withContext({
        args,
        fn: async (ctx, logger) => {

            if (!args.json) {

                logger.info(`Exporting to ${exportPath}...`);

            }

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

                const result = await ctx.noorm.dt.exportTable(tableName, filepath, {
                    passphrase,
                    batchSize,
                });

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

        if (args.json) {

            outputResult(args, { success: false, error: error.message }, '');

        }

        return 1;

    }

    const { totalRows, totalBytes, tableResults } = exportResults;

    if (args.json) {

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

        if (tableCount === 1 && tableResults[0]) {

            output['filepath'] = tableResults[0].filepath;

        }
        else {

            output['directory'] = exportPath;

        }

        outputResult(args, output, '');

    }
    else {

        process.stdout.write(`Export complete: ${totalRows} rows, ${totalBytes} bytes\n`);

        for (const t of tableResults) {

            process.stdout.write(`  ${t.table}: ${t.rows} rows → ${t.filepath}\n`);

        }

    }

    return 0;

}

// ---------------------------------------------------------------------------
// Import handler
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
    args: TransferArgs;
}): Promise<number> {

    const { importPath, passphrase, batchSize, onConflict, truncate, args } = opts;

    const [importResult, error] = await withContext({
        args,
        fn: async (ctx, logger) => {

            if (!args.json) {

                logger.info(`Importing ${importPath}...`);

            }

            const result = await ctx.noorm.dt.importFile(importPath, {
                passphrase,
                batchSize,
                onConflict,
                truncate,
            });

            return result;

        },
    });

    if (error) {

        if (args.json) {

            outputResult(args, { success: false, error: error.message }, '');

        }

        return 1;

    }

    if (args.json) {

        outputResult(args, {
            success: true,
            mode: 'import',
            filepath: importPath,
            rowsImported: importResult?.rowsImported ?? 0,
            rowsSkipped: importResult?.rowsSkipped ?? 0,
        }, '');

    }
    else {

        process.stdout.write(`Import complete: ${importResult?.rowsImported ?? 0} rows imported, ${importResult?.rowsSkipped ?? 0} skipped\n`);

    }

    return 0;

}
