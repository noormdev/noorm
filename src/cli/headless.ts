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

import { Logger, type LoggerOptions } from '../core/logger/index.js';
import { getSettingsManager } from '../core/settings/index.js';

import type { Route, RouteParams, CliFlags } from './types.js';
import { HEADLESS_HANDLERS } from './headless-handlers.js';

/**
 * Headless command handler function signature.
 */
export type HeadlessHandler = (params: RouteParams, flags: CliFlags, logger: Logger) => Promise<number>;

/**
 * Registry of headless command handlers.
 *
 * Maps routes to their headless implementations.
 * Routes without handlers will print an error.
 */
const HANDLERS: Partial<Record<Route, HeadlessHandler>> = {
    ...HEADLESS_HANDLERS,
};

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

    // Environment variables
    if (process.env['NOORM_HEADLESS'] === 'true') {

        return true;

    }

    // CI environment detection
    const ciVars = [
        'CI',
        'CONTINUOUS_INTEGRATION',
        'GITHUB_ACTIONS',
        'GITLAB_CI',
        'CIRCLECI',
        'TRAVIS',
        'JENKINS_URL',
        'BUILDKITE',
    ];

    for (const varName of ciVars) {

        if (process.env[varName]) {

            return true;

        }

    }

    // No TTY
    if (!process.stdout.isTTY) {

        return true;

    }

    return false;

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

    const options: LoggerOptions = {
        projectRoot,
        settings,
        config: {
            enabled: true,
            level: 'info',
        },
        console: json ? undefined : process.stdout,
        file: fileStream ?? undefined,
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

    if (!handler) {

        logger.error(`Unknown command: ${route}`);
        await logger.stop();
        return 1;

    }

    // Run the handler
    const [exitCode, err] = await attempt(() => handler(params, flags, logger));

    if (err) {

        const error = err instanceof Error ? err : new Error(String(err));
        logger.error(error.message);
        await logger.stop();
        return 1;

    }

    await logger.stop();
    return exitCode;

}

/**
 * Register a headless handler for a route.
 *
 * Mainly useful for testing. In production, prefer static registration.
 */
export function registerHeadlessHandler(route: Route, handler: HeadlessHandler): void {

    HANDLERS[route] = handler;

}
