/**
 * Database transfer headless command.
 *
 * Transfers data between database configurations.
 */
import { attempt } from '@logosdx/utils';

import { type HeadlessCommand } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';
import { transferData, getTransferPlan, TRANSFER_SUPPORTED_DIALECTS } from '../../core/transfer/index.js';
import { getStateManager } from '../../core/state/index.js';
import type { TransferOptions, ConflictStrategy } from '../../core/transfer/index.js';

export const help = `
# DB TRANSFER

Transfer data between database configurations

## Usage

    noorm db transfer --to <config> [options]
    noorm db transfer <source> --to <destination> [options]

## Arguments

    source         Source config name (defaults to active config)

## Flags

    --to           Destination config name (required)
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

    if (!destConfigName) {

        if (flags.json) {

            process.stdout.write(JSON.stringify({
                success: false,
                error: '--to flag required. Usage: noorm db transfer --to <config>',
            }) + '\n');

        }
        else {

            const output = formatHelp(help);
            process.stdout.write(output + '\n');

        }

        return 1;

    }

    // Load state to get configs
    const stateManager = getStateManager(process.cwd());
    const [, loadErr] = await attempt(() => stateManager.load());

    if (loadErr) {

        if (flags.json) {

            process.stdout.write(JSON.stringify({ success: false, error: loadErr.message }) + '\n');

        }
        else {

            logger.error(loadErr.message);

        }

        return 1;

    }

    // Determine source config
    const sourceConfigName = params.name ?? flags.config ?? stateManager.getActiveConfigName();

    if (!sourceConfigName) {

        const msg = 'No source config specified and no active config set';

        if (flags.json) {

            process.stdout.write(JSON.stringify({ success: false, error: msg }) + '\n');

        }
        else {

            logger.error(msg);

        }

        return 1;

    }

    const sourceConfig = stateManager.getConfig(sourceConfigName);
    const destConfig = stateManager.getConfig(destConfigName);

    if (!sourceConfig) {

        const msg = `Source config not found: ${sourceConfigName}`;

        if (flags.json) {

            process.stdout.write(JSON.stringify({ success: false, error: msg }) + '\n');

        }
        else {

            logger.error(msg);

        }

        return 1;

    }

    if (!destConfig) {

        const msg = `Destination config not found: ${destConfigName}`;

        if (flags.json) {

            process.stdout.write(JSON.stringify({ success: false, error: msg }) + '\n');

        }
        else {

            logger.error(msg);

        }

        return 1;

    }

    // Validate dialect support
    if (!TRANSFER_SUPPORTED_DIALECTS.includes(sourceConfig.connection.dialect)) {

        const msg = `Dialect not supported: ${sourceConfig.connection.dialect}. Supported: ${TRANSFER_SUPPORTED_DIALECTS.join(', ')}`;

        if (flags.json) {

            process.stdout.write(JSON.stringify({ success: false, error: msg }) + '\n');

        }
        else {

            logger.error(msg);

        }

        return 1;

    }

    // Build options
    const options: TransferOptions = {
        tables: flags['tables'] ? String(flags['tables']).split(',').map((t: string) => t.trim()) : undefined,
        onConflict: (flags['on-conflict'] ?? 'fail') as ConflictStrategy,
        batchSize: flags['batch-size'] ? parseInt(String(flags['batch-size']), 10) : undefined,
        disableForeignKeys: flags['no-fk'] !== true,
        preserveIdentity: flags['no-identity'] !== true,
        truncateFirst: flags['truncate'] === true,
        dryRun: flags.dryRun === true,
    };

    if (!flags.json) {

        logger.info(`Transferring from "${sourceConfigName}" to "${destConfigName}"...`);

    }

    // Dry run - just show plan
    if (options.dryRun) {

        const [plan, planErr] = await getTransferPlan(sourceConfig, destConfig, options);

        if (planErr) {

            if (flags.json) {

                process.stdout.write(JSON.stringify({ success: false, error: planErr.message }) + '\n');

            }
            else {

                logger.error(planErr.message);

            }

            return 1;

        }

        if (flags.json) {

            process.stdout.write(JSON.stringify({
                success: true,
                dryRun: true,
                sameServer: plan?.sameServer,
                tableCount: plan?.tables.length ?? 0,
                estimatedRows: plan?.estimatedRows ?? 0,
                tables: plan?.tables.map((t) => ({
                    name: t.name,
                    rowCount: t.rowCount,
                    hasIdentity: t.hasIdentity,
                    dependsOn: t.dependsOn,
                })),
                warnings: plan?.warnings ?? [],
            }) + '\n');

        }
        else {

            logger.info('Dry run - transfer plan:');
            logger.info(`  Same server: ${plan?.sameServer ? 'yes' : 'no'}`);
            logger.info(`  Tables: ${plan?.tables.length ?? 0}`);
            logger.info(`  Estimated rows: ${plan?.estimatedRows ?? 0}`);

            if (plan?.tables.length) {

                logger.info('\n  Transfer order:');

                for (const t of plan.tables) {

                    const deps = t.dependsOn.length > 0 ? ` (after: ${t.dependsOn.join(', ')})` : '';
                    logger.info(`    ${t.name} - ${t.rowCount} rows${deps}`);

                }

            }

            if (plan?.warnings.length) {

                logger.info('\n  Warnings:');

                for (const w of plan.warnings) {

                    logger.info(`    - ${w}`);

                }

            }

        }

        return 0;

    }

    // Execute transfer
    const [result, transferErr] = await transferData(sourceConfig, destConfig, options);

    if (transferErr) {

        if (flags.json) {

            process.stdout.write(JSON.stringify({ success: false, error: transferErr.message }) + '\n');

        }
        else {

            logger.error(transferErr.message);

        }

        return 1;

    }

    if (flags.json) {

        process.stdout.write(JSON.stringify({
            success: result?.status === 'success',
            status: result?.status,
            tables: result?.tables,
            totalRows: result?.totalRows,
            durationMs: result?.durationMs,
        }) + '\n');

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

    return result?.status === 'success' ? 0 : 1;

};
