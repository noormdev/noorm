/**
 * Headless mode for CI/CD and non-interactive execution.
 *
 * When running without a TTY or with --headless flag, noorm executes
 * commands directly and outputs results as text or JSON.
 *
 * Uses the Logger for event output with optional colors.
 *
 * @example
 * ```bash
 * # Explicit headless mode
 * noorm -H run:build
 *
 * # JSON output for scripting
 * noorm -H --json change:ff | jq '.event'
 *
 * # Auto-detected in CI
 * CI=1 noorm change:ff
 * ```
 */
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';

import { attempt, attemptSync } from '@logosdx/utils';

import { Logger, type LoggerOptions, type LogLevel } from '../../core/logger/index.js';
import { getSettingsManager } from '../../core/settings/index.js';

import type { Route, RouteParams, CliFlags } from '../types.js';
import { isCi, isDev } from '../../core/environment.js';

import { type RouteHandler } from './_helpers.js';

import * as CmdChangeFf from './change-ff.js';
import * as CmdChangeHistory from './change-history.js';
import * as CmdChangeRevert from './change-revert.js';
import * as CmdChangeRun from './change-run.js';
import * as CmdChange from './change.js';
import * as CmdConfigAdd from './config-add.js';
import * as CmdConfigEdit from './config-edit.js';
import * as CmdConfigRm from './config-rm.js';
import * as CmdConfigUser from './config-use.js';
import * as CmdConfig from './config.js';
import * as CmdDbExploreTablesDetail from './db-explore-tables-detail.js';
import * as CmdDbExploreTables from './db-explore-tables.js';
import * as CmdDbExplore from './db-explore.js';
import * as CmdDbTeardown from './db-teardown.js';
import * as CmdDbTruncate from './db-truncate.js';
import * as CmdDb from './db.js';
import * as CmdIdentity from './identity.js';
import * as CmdLockAcquire from './lock-acquire.js';
import * as CmdLockForce from './lock-force.js';
import * as CmdLockRelease from './lock-release.js';
import * as CmdLockStatus from './lock-status.js';
import * as CmdLock from './lock.js';
import * as CmdRunBuild from './run-build.js';
import * as CmdRunDir from './run-dir.js';
import * as CmdRunFile from './run-file.js';
import * as CmdRun from './run.js';
import * as CmdSecret from './secret.js';
import * as CmdSettings from './settings.js';

import * as CmdHelp from './help.js';
import { getConfig } from '../../core/config/index.js';

/**
 * Registry of headless command handlers.
 *
 * Maps routes to their headless implementations.
 * Routes without handlers will print an error.
 */
const HANDLERS: Partial<Record<Route, RouteHandler>> = {

    'change': CmdChange,
    'change/ff': CmdChangeFf,
    'change/history': CmdChangeHistory,
    'change/revert': CmdChangeRevert,
    'change/run': CmdChangeRun,

    'config': CmdConfig,
    'config/add': CmdConfigAdd,
    'config/edit': CmdConfigEdit,
    'config/rm': CmdConfigRm,
    'config/use': CmdConfigUser,

    'db': CmdDb,
    'db/explore': CmdDbExplore,
    'db/explore/tables/detail': CmdDbExploreTablesDetail,
    'db/explore/tables': CmdDbExploreTables,
    'db/teardown': CmdDbTeardown,
    'db/truncate': CmdDbTruncate,

    'identity': CmdIdentity,

    'lock': CmdLock,
    'lock/acquire': CmdLockAcquire,
    'lock/force': CmdLockForce,
    'lock/release': CmdLockRelease,
    'lock/status': CmdLockStatus,

    'run': CmdRun,
    'run/build': CmdRunBuild,
    'run/dir': CmdRunDir,
    'run/file': CmdRunFile,

    'secret': CmdSecret,
    'settings': CmdSettings,
};

HANDLERS['help'] = CmdHelp.factory!(HANDLERS);

/**
 * Detect if we should run in headless mode.
 *
 * Headless mode is activated when:
 * - `--headless` or `-H` flag is passed
 * - `NOORM_HEADLESS=true` environment variable
 * - `CI=true` or common CI environment variables detected
 * - No TTY available (`!process.stdout.isTTY`)
 *
 * The `--tui` flag overrides all of the above and forces TUI mode.
 */
export function shouldRunHeadless(flags: CliFlags): boolean {

    // --tui flag overrides everything
    if (flags.tui) {

        return false;

    }

    // Explicit headless flag
    if (flags.headless) {

        return true;

    }

    return isCi();

}

/**
 * Create a logger for headless mode.
 *
 * Always returns a Logger. Uses colored console output unless JSON mode.
 * File logging attempted but not required.
 */
async function createHeadlessLogger(
    projectRoot: string,
    json: boolean,
): Promise<Logger> {

    const settingsManager = getSettingsManager(projectRoot);
    const [, settingsErr] = await attempt(() => settingsManager.load());

    // Use loaded settings or empty defaults
    const settings = settingsErr ? {} : settingsManager.settings;

    // Attempt file logging (optional)
    const logPath = join(projectRoot, '.noorm', 'noorm.log');
    const [fileStream] = attemptSync(() =>
        createWriteStream(logPath, { flags: 'a' }),
    );

    let defaultLevel: LogLevel = 'info';

    if (isDev()) {

        defaultLevel = 'verbose';

    }

    const options: LoggerOptions = {
        projectRoot,
        settings,
        config: {
            enabled: true,
            level: getConfig('log.level', defaultLevel)!,
        },
        console: process.stdout,
        file: fileStream ?? undefined,
        json,
        color: !json,
    };

    return new Logger(options);

}

/**
 * Run a command in headless mode.
 *
 * @returns Exit code (0 for success, non-zero for errors)
 */
export async function runHeadless(
    route: Route,
    params: RouteParams,
    flags: CliFlags,
): Promise<number> {

    const projectRoot = process.cwd();
    const logger = await createHeadlessLogger(projectRoot, flags.json);
    await logger.start();

    const handler = HANDLERS[route];
    const routeSpaced = route.replace('/', ' ');

    if (!handler) {

        logger.error(`Unknown command: ${routeSpaced}`);
        await logger.stop();

        return 1;

    }

    const { run } = handler;

    if (!run) {

        logger.error(`Command not implemented in headless mode: ${routeSpaced}`);
        await logger.stop();

        return 1;

    }

    // Run the handler
    const [exitCode, err] = await attempt(
        () => run(params, flags, logger),
    );

    if (err) {

        const error = err instanceof Error ? err : new Error(String(err));
        logger.error(error.message);
        await logger.stop();

        return 1;

    }

    await logger.stop();

    return exitCode;

}
