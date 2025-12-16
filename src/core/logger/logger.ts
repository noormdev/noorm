/**
 * Logger
 *
 * Captures observer events and streams them to a log file.
 * Uses a queue-based write system for non-blocking operation.
 *
 * @example
 * ```typescript
 * const logger = new Logger({
 *     projectRoot: process.cwd(),
 *     config: {
 *         enabled: true,
 *         level: 'info',
 *         file: '.noorm/noorm.log',
 *         maxSize: '10mb',
 *         maxFiles: 5,
 *     }
 * })
 *
 * await logger.start()
 *
 * // Logger now captures all observer events...
 *
 * await logger.stop()
 * ```
 */
import { join } from 'node:path'

import { observer, type NoormEvents } from '../observer.js'
import { WriteQueue } from './queue.js'
import { formatEntry, serializeEntry } from './formatter.js'
import { shouldLog } from './classifier.js'
import { checkAndRotate, parseSize } from './rotation.js'
import type {
    LoggerConfig,
    LoggerOptions,
    LoggerState,
    LogLevel,
    QueueStats,
} from './types.js'
import { DEFAULT_LOGGER_CONFIG } from './types.js'


/**
 * Logger that captures observer events and writes to a log file.
 *
 * Features:
 * - Non-blocking writes via queue
 * - Configurable verbosity levels
 * - Automatic log rotation
 * - Context injection (config name, etc.)
 */
export class Logger {

    #projectRoot: string
    #config: LoggerConfig
    #context: Record<string, unknown>
    #queue: WriteQueue | null = null
    #state: LoggerState = 'idle'
    #cleanup: (() => void) | null = null
    #rotationInterval: ReturnType<typeof setInterval> | null = null

    constructor(options: LoggerOptions) {

        this.#projectRoot = options.projectRoot
        this.#config = { ...DEFAULT_LOGGER_CONFIG, ...options.config }
        this.#context = options.context ?? {}
    }


    /**
     * Get the current logger state.
     */
    get state(): LoggerState {

        return this.#state
    }


    /**
     * Get the current log level.
     */
    get level(): LogLevel {

        return this.#config.level
    }


    /**
     * Get the log file path.
     */
    get filepath(): string {

        return join(this.#projectRoot, this.#config.file)
    }


    /**
     * Check if logging is enabled.
     */
    get isEnabled(): boolean {

        return this.#config.enabled && this.#config.level !== 'silent'
    }


    /**
     * Get queue statistics.
     */
    get stats(): QueueStats | null {

        return this.#queue?.stats ?? null
    }


    /**
     * Update the logging context.
     *
     * Context is included with every log entry.
     *
     * @example
     * ```typescript
     * logger.setContext({ config: 'dev', identity: 'alice' })
     * ```
     */
    setContext(context: Record<string, unknown>): void {

        this.#context = { ...this.#context, ...context }
    }


    /**
     * Clear the logging context.
     */
    clearContext(): void {

        this.#context = {}
    }


    /**
     * Start the logger.
     *
     * Subscribes to all observer events and begins logging.
     */
    async start(): Promise<void> {

        if (this.#state !== 'idle') {

            return
        }

        if (!this.isEnabled) {

            return
        }

        // Check rotation before starting
        const rotationResult = await checkAndRotate(
            this.filepath,
            this.#config.maxSize,
            this.#config.maxFiles
        )

        if (rotationResult.rotated) {

            observer.emit('logger:rotated', {
                oldFile: rotationResult.oldFile!,
                newFile: rotationResult.newFile!,
            })
        }

        // Create and start write queue
        this.#queue = new WriteQueue(this.filepath)
        await this.#queue.start()

        // Subscribe to all observer events
        this.#cleanup = observer.on(/./, (payload) => {

            const { event, data } = payload as { event: string; data: Record<string, unknown> }

            this.#handleEvent(event, data)
        })

        // Start rotation check interval (every minute)
        this.#rotationInterval = setInterval(() => {

            this.#checkRotation()
        }, 60_000)

        this.#state = 'running'

        observer.emit('logger:started', {
            file: this.filepath,
            level: this.#config.level,
        })
    }


    /**
     * Stop the logger.
     *
     * Flushes pending entries and unsubscribes from events.
     */
    async stop(): Promise<void> {

        if (this.#state !== 'running') {

            return
        }

        this.#state = 'flushing'

        // Stop rotation interval
        if (this.#rotationInterval) {

            clearInterval(this.#rotationInterval)
            this.#rotationInterval = null
        }

        // Unsubscribe from events
        if (this.#cleanup) {

            this.#cleanup()
            this.#cleanup = null
        }

        // Flush and stop queue
        if (this.#queue) {

            const entriesWritten = this.#queue.stats.totalWritten
            await this.#queue.stop()
            this.#queue = null

            observer.emit('logger:flushed', { entriesWritten })
        }

        this.#state = 'stopped'
    }


    /**
     * Flush pending log entries.
     *
     * Useful before shutdown or when you need entries written immediately.
     */
    async flush(): Promise<void> {

        if (this.#queue) {

            await this.#queue.flush()
        }
    }


    /**
     * Handle an observer event.
     */
    #handleEvent(event: string, data: Record<string, unknown>): void {

        // Skip logger's own events to avoid loops
        if (event.startsWith('logger:')) {

            return
        }

        // Check if event should be logged at current level
        if (!shouldLog(event, this.#config.level)) {

            return
        }

        // Format and enqueue
        const includeData = this.#config.level === 'verbose'
        const entry = formatEntry(event, data, this.#context, includeData)
        const line = serializeEntry(entry)

        this.#queue?.enqueue(line)
    }


    /**
     * Check if rotation is needed and perform it.
     */
    async #checkRotation(): Promise<void> {

        if (!this.#queue || this.#state !== 'running') {

            return
        }

        const result = await checkAndRotate(
            this.filepath,
            this.#config.maxSize,
            this.#config.maxFiles
        )

        if (result.rotated) {

            observer.emit('logger:rotated', {
                oldFile: result.oldFile!,
                newFile: result.newFile!,
            })
        }
    }
}


// ─────────────────────────────────────────────────────────────
// Singleton / Factory
// ─────────────────────────────────────────────────────────────

let loggerInstance: Logger | null = null


/**
 * Get or create a Logger instance.
 *
 * @param projectRoot - Project root directory
 * @param config - Logger configuration
 * @returns Logger instance
 *
 * @example
 * ```typescript
 * const logger = getLogger(process.cwd(), settings.getLogging())
 * await logger.start()
 * ```
 */
export function getLogger(
    projectRoot: string,
    config?: Partial<LoggerConfig>
): Logger {

    if (!loggerInstance) {

        loggerInstance = new Logger({
            projectRoot,
            config: { ...DEFAULT_LOGGER_CONFIG, ...config },
        })
    }

    return loggerInstance
}


/**
 * Reset the logger singleton.
 *
 * Useful for testing to ensure clean state between tests.
 */
export async function resetLogger(): Promise<void> {

    if (loggerInstance) {

        await loggerInstance.stop()
        loggerInstance = null
    }
}
