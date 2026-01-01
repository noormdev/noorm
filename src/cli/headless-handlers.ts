/**
 * Headless Handlers.
 *
 * CLI handlers for headless/CI mode that use the SDK for database operations.
 * Each handler corresponds to a CLI route and returns an exit code.
 *
 * Uses `attempt` for control flow. All output goes through Logger.
 */
import { attempt } from '@logosdx/utils';

import { createContext, type Context } from '../sdk/index.js';
import { initState, getStateManager } from '../core/state/index.js';
import { Logger, STATUS_ICONS, formatDuration } from '../core/logger/index.js';
import { getHelp, getHelpMatch, listHelpTopics } from './help.js';

import type { RouteParams, CliFlags } from './types.js';

// ─────────────────────────────────────────────────────────────
// Output Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Output JSON result (JSON mode only).
 */
function outputJson(data: unknown, json: boolean): void {

    if (json) {

        console.log(JSON.stringify(data, null, 2));

    }

}

// ─────────────────────────────────────────────────────────────
// Context Helper
// ─────────────────────────────────────────────────────────────

/**
 * Execute an operation with SDK context.
 *
 * Handles connection lifecycle and error reporting.
 * Returns exit code (0 = success, 1 = failure).
 */
async function withContext<T>(
    flags: CliFlags,
    logger: Logger,
    operation: (ctx: Context) => Promise<T>,
    onSuccess: (result: T) => number,
): Promise<number> {

    // Let createContext handle config resolution:
    // flags.config → NOORM_CONFIG env var → active config from state
    const [ctx, ctxError] = await attempt(() => createContext({ config: flags.config }));

    if (ctxError) {

        logger.error(`Failed to load config: ${ctxError.message}`);
        return 1;

    }

    const [, connectError] = await attempt(() => ctx.connect());

    if (connectError) {

        logger.error(`Failed to connect: ${connectError.message}`);
        return 1;

    }

    const [result, opError] = await attempt(() => operation(ctx));

    // Always disconnect
    await attempt(() => ctx.disconnect());

    if (opError) {

        logger.error(opError.message);
        return 1;

    }

    return onSuccess(result);

}

// ─────────────────────────────────────────────────────────────
// Schema Operations
// ─────────────────────────────────────────────────────────────

/**
 * Build schema: Execute all SQL files in schema directory.
 */
export async function handleRunBuild(
    params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    return withContext(flags, logger, async (ctx) => {

        return ctx.build({ force: params.force ?? flags.force });

    }, (result) => {

        outputJson({
            status: result.status,
            filesRun: result.filesRun,
            filesSkipped: result.filesSkipped,
            filesFailed: result.filesFailed,
            durationMs: result.durationMs,
        }, flags.json);

        const icon = result.status === 'success'
            ? STATUS_ICONS.success
            : result.status === 'partial'
                ? STATUS_ICONS.partial
                : STATUS_ICONS.failed;

        logger.info( `${icon} Build ${result.status}`, {
            filesRun: result.filesRun,
            filesSkipped: result.filesSkipped,
            filesFailed: result.filesFailed,
            durationMs: result.durationMs,
        });

        return result.status === 'success' ? 0 : 1;

    });

}

/**
 * Truncate: Wipe all data, keep schema.
 */
export async function handleDbTruncate(
    _params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    return withContext(flags, logger, async (ctx) => {

        return ctx.truncate();

    }, (result) => {

        outputJson({
            truncated: result.truncated,
            count: result.truncated.length,
        }, flags.json);

        logger.info( `${STATUS_ICONS.success} Truncated ${result.truncated.length} tables`, {
            tables: result.truncated,
        });

        return 0;

    });

}

/**
 * Teardown: Drop all database objects.
 */
export async function handleDbTeardown(
    _params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    return withContext(flags, logger, async (ctx) => {

        return ctx.teardown();

    }, (result) => {

        const droppedCount = result.dropped.tables.length +
            result.dropped.views.length +
            result.dropped.functions.length +
            result.dropped.types.length;

        outputJson({
            dropped: result.dropped,
            count: droppedCount,
        }, flags.json);

        logger.info( `${STATUS_ICONS.success} Dropped ${droppedCount} objects`, {
            tables: result.dropped.tables.length,
            views: result.dropped.views.length,
            functions: result.dropped.functions.length,
            types: result.dropped.types.length,
        });

        return 0;

    });

}

// ─────────────────────────────────────────────────────────────
// Changeset Operations
// ─────────────────────────────────────────────────────────────

/**
 * Fast-forward: Apply all pending changesets.
 */
export async function handleChangeFf(
    _params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    return withContext(flags, logger, async (ctx) => {

        return ctx.fastForward();

    }, (result) => {

        outputJson({
            status: result.status,
            executed: result.executed,
            skipped: result.skipped,
            failed: result.failed,
            changesets: result.changesets.map((r) => ({
                name: r.name,
                status: r.status,
                direction: r.direction,
                durationMs: r.durationMs,
            })),
        }, flags.json);

        const icon = result.status === 'success'
            ? STATUS_ICONS.success
            : result.status === 'partial'
                ? STATUS_ICONS.partial
                : STATUS_ICONS.failed;

        logger.info( `${icon} Fast-forward ${result.status}`, {
            executed: result.executed,
            skipped: result.skipped,
            failed: result.failed,
        });

        for (const r of result.changesets) {

            const csIcon = r.status === 'success' ? STATUS_ICONS.success : STATUS_ICONS.failed;

            logger.info( `  ${csIcon} ${r.name} ${formatDuration(r.durationMs)}`);

        }

        return result.status === 'success' ? 0 : 1;

    });

}

/**
 * Apply a single changeset.
 */
export async function handleChangeRun(
    params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    if (!params.name) {

        logger.error('Changeset name required. Use --name <changeset>');

        return 1;

    }

    return withContext(flags, logger, async (ctx) => {

        return ctx.applyChangeset(params.name!);

    }, (result) => {

        outputJson({
            name: result.name,
            status: result.status,
            direction: result.direction,
            durationMs: result.durationMs,
        }, flags.json);

        const icon = result.status === 'success' ? STATUS_ICONS.success : STATUS_ICONS.failed;

        logger.info( `${icon} ${result.name} ${result.status} ${formatDuration(result.durationMs)}`);

        return result.status === 'success' ? 0 : 1;

    });

}

/**
 * Revert a single changeset.
 */
export async function handleChangeRevert(
    params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    if (!params.name) {

        logger.error('Changeset name required. Use --name <changeset>');

        return 1;

    }

    return withContext(flags, logger, async (ctx) => {

        return ctx.revertChangeset(params.name!);

    }, (result) => {

        outputJson({
            name: result.name,
            status: result.status,
            direction: result.direction,
            durationMs: result.durationMs,
        }, flags.json);

        const icon = result.status === 'success' ? STATUS_ICONS.success : STATUS_ICONS.failed;

        logger.info( `${icon} ${result.name} reverted ${result.status} ${formatDuration(result.durationMs)}`);

        return result.status === 'success' ? 0 : 1;

    });

}

/**
 * List changeset status.
 */
export async function handleChangeList(
    _params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    return withContext(flags, logger, async (ctx) => {

        return ctx.getChangesetStatus();

    }, (changesets) => {

        outputJson(changesets, flags.json);

        for (const cs of changesets) {

            const icon = cs.status === 'success'
                ? STATUS_ICONS.success
                : cs.status === 'pending'
                    ? STATUS_ICONS.pending
                    : cs.status === 'reverted'
                        ? STATUS_ICONS.reverted
                        : STATUS_ICONS.failed;

            logger.info( `${icon} ${cs.name} (${cs.status})`);

        }

        const pending = changesets.filter((c) => c.status === 'pending').length;

        if (pending > 0) {

            logger.info( `${pending} pending changeset(s)`);

        }

        return 0;

    });

}

// ─────────────────────────────────────────────────────────────
// File Operations
// ─────────────────────────────────────────────────────────────

/**
 * Run a single SQL file.
 */
export async function handleRunFile(
    params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    if (!params.path) {

        logger.error('File path required. Use --path <file.sql>');

        return 1;

    }

    return withContext(flags, logger, async (ctx) => {

        return ctx.runFile(params.path!);

    }, (result) => {

        const isSkipped = result.status === 'skipped';

        outputJson({
            filepath: result.filepath,
            status: result.status,
            skipReason: result.skipReason,
            durationMs: result.durationMs,
        }, flags.json);

        const icon = result.status === 'success'
            ? STATUS_ICONS.success
            : isSkipped
                ? STATUS_ICONS.skipped
                : STATUS_ICONS.failed;

        logger.info( `${icon} ${result.filepath} ${formatDuration(result.durationMs ?? 0)}`);

        return result.status === 'success' || isSkipped ? 0 : 1;

    });

}

/**
 * Run all SQL files in a directory.
 */
export async function handleRunDir(
    params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    if (!params.path) {

        logger.error('Directory path required. Use --path <dir>');

        return 1;

    }

    return withContext(flags, logger, async (ctx) => {

        return ctx.runDir(params.path!);

    }, (result) => {

        outputJson({
            status: result.status,
            filesRun: result.filesRun,
            filesSkipped: result.filesSkipped,
            filesFailed: result.filesFailed,
            durationMs: result.durationMs,
        }, flags.json);

        const icon = result.status === 'success'
            ? STATUS_ICONS.success
            : result.status === 'partial'
                ? STATUS_ICONS.partial
                : STATUS_ICONS.failed;

        logger.info( `${icon} Run directory ${result.status}`, {
            filesRun: result.filesRun,
            filesSkipped: result.filesSkipped,
            filesFailed: result.filesFailed,
        });

        return result.status === 'success' ? 0 : 1;

    });

}

// ─────────────────────────────────────────────────────────────
// Explore Operations
// ─────────────────────────────────────────────────────────────

/**
 * Database overview.
 */
export async function handleDbExplore(
    _params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    return withContext(flags, logger, async (ctx) => {

        return ctx.overview();

    }, (overview) => {

        outputJson(overview, flags.json);

        logger.info( 'Database Overview', {
            tables: overview.tables,
            views: overview.views,
            functions: overview.functions,
            procedures: overview.procedures,
            types: overview.types,
        });

        return 0;

    });

}

/**
 * List tables.
 */
export async function handleDbExploreTables(
    _params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    return withContext(flags, logger, async (ctx) => {

        return ctx.listTables();

    }, (tables) => {

        outputJson(tables, flags.json);

        logger.info( `Tables: ${tables.length}`, {
            tables: tables.map((t) => `${t.name} (${t.columnCount} cols)`),
        });

        return 0;

    });

}

/**
 * Describe a table.
 */
export async function handleDbExploreTablesDetail(
    params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    if (!params.name) {

        logger.error('Table name required. Use --name <table>');

        return 1;

    }

    return withContext(flags, logger, async (ctx) => {

        return ctx.describeTable(params.name!, params.schema);

    }, (detail) => {

        if (!detail) {

            logger.error(`Table not found: ${params.name}`);

            return 1;

        }

        outputJson(detail, flags.json);

        logger.info( `Table: ${detail.name}`, {
            columns: detail.columns.map((c) => `${c.name}: ${c.dataType}`),
        });

        return 0;

    });

}

// ─────────────────────────────────────────────────────────────
// Lock Operations
// ─────────────────────────────────────────────────────────────

/**
 * Get lock status.
 */
export async function handleLockStatus(
    _params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    return withContext(flags, logger, async (ctx) => {

        return ctx.getLockStatus();

    }, (status) => {

        outputJson(status, flags.json);

        if (status.isLocked && status.lock) {

            logger.info( `🔒 Locked by ${status.lock.lockedBy}`, {
                since: status.lock.lockedAt.toISOString(),
                expires: status.lock.expiresAt.toISOString(),
            });

        }
        else {

            logger.info( '🔓 No active lock');

        }

        return 0;

    });

}

/**
 * Acquire lock.
 */
export async function handleLockAcquire(
    _params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    return withContext(flags, logger, async (ctx) => {

        return ctx.acquireLock();

    }, (lock) => {

        outputJson({
            acquired: true,
            lockedBy: lock.lockedBy,
            expiresAt: lock.expiresAt.toISOString(),
        }, flags.json);

        logger.info( `🔒 Lock acquired`, {
            lockedBy: lock.lockedBy,
            expiresAt: lock.expiresAt.toISOString(),
        });

        return 0;

    });

}

/**
 * Release lock.
 */
export async function handleLockRelease(
    _params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    return withContext(flags, logger, async (ctx) => {

        await ctx.releaseLock();

        return true;

    }, () => {

        outputJson({ released: true }, flags.json);

        logger.info( '🔓 Lock released');

        return 0;

    });

}

// ─────────────────────────────────────────────────────────────
// History Operations
// ─────────────────────────────────────────────────────────────

/**
 * Get execution history.
 */
export async function handleChangeHistory(
    params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    return withContext(flags, logger, async (ctx) => {

        return ctx.getHistory(params.count ?? 20);

    }, (history) => {

        outputJson(history, flags.json);

        logger.info( `Execution History: ${history.length} records`);

        for (const record of history) {

            const icon = record.status === 'success' ? STATUS_ICONS.success : STATUS_ICONS.failed;
            const date = new Date(record.executedAt).toLocaleString();

            logger.info( `  ${icon} ${record.name} - ${record.status} (${date})`);

        }

        return 0;

    });

}

// ─────────────────────────────────────────────────────────────
// Help
// ─────────────────────────────────────────────────────────────

/**
 * Show help for a command.
 *
 * Uses hierarchical fallback to find the most specific help.
 * If no topic provided, lists available help topics.
 */
export async function handleHelp(
    params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    // If a topic was provided via params.topic (multi-part) or params.name (single)
    const topic = params.topic ?? params.name;

    if (!topic) {

        // List all help topics
        const topics = listHelpTopics();

        if (flags.json) {

            outputJson({ topics }, true);

        }
        else {

            console.log('Available help topics:\n');

            for (const t of topics) {

                console.log(`  noorm help ${t.replace(/\//g, ' ')}`);

            }

            console.log('\nRun "noorm help <topic>" for detailed help on a topic.');

        }

        return 0;

    }

    // Convert space-separated topic to route format
    const route = topic.replace(/ /g, '/');
    const help = await getHelp(route);

    if (!help) {

        logger.error(`No help available for: ${topic}`);
        logger.info('Run "noorm help" to see available topics.');
        return 1;

    }

    if (flags.json) {

        const match = getHelpMatch(route);
        outputJson({ topic: match, content: help }, true);

    }
    else {

        console.log(help);

    }

    return 0;

}

// ─────────────────────────────────────────────────────────────
// Config Operations
// ─────────────────────────────────────────────────────────────

/**
 * Set the active config.
 */
export async function handleConfigUse(
    params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    const configName = params.name;

    if (!configName) {

        logger.error('Config name required. Usage: noorm -H config use <name>');
        return 1;

    }

    const projectRoot = process.cwd();

    const [, initErr] = await attempt(() => initState(projectRoot));

    if (initErr) {

        logger.error(`Failed to load state: ${initErr.message}`);
        return 1;

    }

    const stateManager = getStateManager(projectRoot);

    const [, setErr] = await attempt(() => stateManager.setActiveConfig(configName));

    if (setErr) {

        logger.error(setErr.message);
        return 1;

    }

    outputJson({ activeConfig: configName }, flags.json);
    logger.info(`${STATUS_ICONS.success} Active config set to: ${configName}`);

    return 0;

}

// ─────────────────────────────────────────────────────────────
// Export all handlers
// ─────────────────────────────────────────────────────────────

export const HEADLESS_HANDLERS = {
    'help': handleHelp,
    'config/use': handleConfigUse,
    'run/build': handleRunBuild,
    'db/truncate': handleDbTruncate,
    'db/teardown': handleDbTeardown,
    'change': handleChangeList,
    'change/ff': handleChangeFf,
    'change/run': handleChangeRun,
    'change/revert': handleChangeRevert,
    'change/history': handleChangeHistory,
    'run/file': handleRunFile,
    'run/dir': handleRunDir,
    'db/explore': handleDbExplore,
    'db/explore/tables': handleDbExploreTables,
    'db/explore/tables/detail': handleDbExploreTablesDetail,
    'lock/status': handleLockStatus,
    'lock/acquire': handleLockAcquire,
    'lock/release': handleLockRelease,
} as const;
