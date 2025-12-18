/**
 * Headless mode for CI/CD and non-interactive execution.
 *
 * When running without a TTY or with --headless flag, noorm executes
 * commands directly and outputs results as text or JSON.
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
import { observer, type NoormEvents, type NoormEventNames } from '../core/observer.js'

import type { Route, RouteParams, CliFlags } from './types.js'


/**
 * Headless command handler function signature.
 */
export type HeadlessHandler = (
    params: RouteParams,
    flags: CliFlags
) => Promise<number>


/**
 * Registry of headless command handlers.
 *
 * Maps routes to their headless implementations.
 * Routes without handlers will print an error.
 */
const HANDLERS: Partial<Record<Route, HeadlessHandler>> = {

    // TODO: Add handlers as core modules are integrated
    // 'run/build': handleRunBuild,
    // 'change/ff': handleChangeFf,
    // etc.
}


/**
 * Event logger for headless mode.
 *
 * Subscribes to observer events and logs them to stdout/stderr.
 */
export class HeadlessLogger {

    #json: boolean
    #cleanup: Array<() => void> = []

    constructor(json: boolean) {

        this.#json = json
    }

    /**
     * Start logging observer events.
     */
    start(): void {

        // Subscribe to all events using pattern matching
        const cleanup = observer.on(/.*/, ({ event, data }) => {

            this.#logEvent(event as NoormEventNames, data)
        })

        this.#cleanup.push(cleanup)
    }

    /**
     * Stop logging and clean up subscriptions.
     */
    stop(): void {

        for (const cleanup of this.#cleanup) {

            cleanup()
        }

        this.#cleanup = []
    }

    /**
     * Log a single event.
     */
    #logEvent<E extends NoormEventNames>(event: E, data: NoormEvents[E]): void {

        if (this.#json) {

            this.#logJson(event, data)
        }
        else {

            this.#logHuman(event, data)
        }
    }

    /**
     * JSON output format.
     */
    #logJson<E extends NoormEventNames>(event: E, data: NoormEvents[E]): void {

        const output = {
            event,
            timestamp: new Date().toISOString(),
            ...data
        }

        console.log(JSON.stringify(output))
    }

    /**
     * Human-readable output format.
     */
    #logHuman<E extends NoormEventNames>(event: E, data: NoormEvents[E]): void {

        const formatted = this.#formatEvent(event, data)

        if (formatted) {

            console.log(formatted)
        }
    }

    /**
     * Format an event for human-readable output.
     */
    #formatEvent<E extends NoormEventNames>(event: E, data: NoormEvents[E]): string | null {

        // Type-safe event formatting
        switch (event) {

            case 'build:start': {

                const d = data as NoormEvents['build:start']
                return `Building schema... (${d.fileCount} files)`
            }

            case 'build:complete': {

                const d = data as NoormEvents['build:complete']
                const status = d.status === 'success' ? '✓' : d.status === 'partial' ? '⚠' : '✗'
                return `${status} Build ${d.status}: ${d.filesRun} run, ${d.filesSkipped} skipped, ${d.filesFailed} failed (${d.durationMs}ms)`
            }

            case 'file:before': {

                const d = data as NoormEvents['file:before']
                return `  Running ${d.filepath}...`
            }

            case 'file:after': {

                const d = data as NoormEvents['file:after']
                const status = d.status === 'success' ? '✓' : '✗'
                return `  ${status} ${d.filepath} (${d.durationMs}ms)`
            }

            case 'file:skip': {

                const d = data as NoormEvents['file:skip']
                return `  ○ ${d.filepath} (${d.reason})`
            }

            case 'changeset:start': {

                const d = data as NoormEvents['changeset:start']
                return `${d.direction === 'change' ? 'Applying' : 'Reverting'} ${d.name}...`
            }

            case 'changeset:complete': {

                const d = data as NoormEvents['changeset:complete']
                const status = d.status === 'success' ? '✓' : '✗'
                return `${status} ${d.name} ${d.direction === 'change' ? 'applied' : 'reverted'} (${d.durationMs}ms)`
            }

            case 'lock:acquired': {

                const d = data as NoormEvents['lock:acquired']
                return `🔒 Lock acquired (expires ${d.expiresAt.toISOString()})`
            }

            case 'lock:released': {

                return `🔓 Lock released`
            }

            case 'lock:blocked': {

                const d = data as NoormEvents['lock:blocked']
                return `⚠ Lock held by ${d.holder} since ${d.heldSince.toISOString()}`
            }

            case 'error': {

                const d = data as NoormEvents['error']
                return `Error [${d.source}]: ${d.error.message}`
            }

            case 'connection:open': {

                const d = data as NoormEvents['connection:open']
                return `Connected to ${d.configName} (${d.dialect})`
            }

            case 'connection:error': {

                const d = data as NoormEvents['connection:error']
                return `Connection error: ${d.error}`
            }

            default:
                // Don't log events we don't have human formatting for
                return null
        }
    }
}


/**
 * Detect if we should run in headless mode.
 *
 * Headless mode is activated when:
 * - `--headless` or `-H` flag is passed
 * - `NOORM_HEADLESS=true` environment variable
 * - `CI=true` or common CI environment variables detected
 * - No TTY available (`!process.stdout.isTTY`)
 */
export function shouldRunHeadless(flags: CliFlags): boolean {

    // Explicit flag
    if (flags.headless) {

        return true
    }

    // Environment variables
    if (process.env['NOORM_HEADLESS'] === 'true') {

        return true
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
        'BUILDKITE'
    ]

    for (const varName of ciVars) {

        if (process.env[varName]) {

            return true
        }
    }

    // No TTY
    if (!process.stdout.isTTY) {

        return true
    }

    return false
}


/**
 * Run a command in headless mode.
 *
 * @returns Exit code (0 for success, non-zero for errors)
 */
export async function runHeadless(
    route: Route,
    params: RouteParams,
    flags: CliFlags
): Promise<number> {

    const handler = HANDLERS[route]

    if (!handler) {

        const message = flags.json
            ? JSON.stringify({ error: 'unknown_command', route })
            : `Error: Unknown command '${route}'`

        console.error(message)
        return 1
    }

    // Set up event logging
    const logger = new HeadlessLogger(flags.json)

    logger.start()

    try {

        const exitCode = await handler(params, flags)
        return exitCode
    }
    catch (error) {

        const err = error instanceof Error ? error : new Error(String(error))

        if (flags.json) {

            console.error(JSON.stringify({
                error: 'execution_failed',
                message: err.message
            }))
        }
        else {

            console.error(`Error: ${err.message}`)
        }

        return 1
    }
    finally {

        logger.stop()
    }
}


/**
 * Register a headless handler for a route.
 *
 * Mainly useful for testing. In production, prefer static registration.
 */
export function registerHeadlessHandler(route: Route, handler: HeadlessHandler): void {

    HANDLERS[route] = handler
}
