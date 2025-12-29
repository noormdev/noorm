/**
 * Logger
 *
 * Simple stream-based logger using observer.queue() for non-blocking
 * event processing. Writes to console (stdout) and/or file streams.
 *
 * @example
 * ```typescript
 * import { createWriteStream } from 'fs'
 *
 * const logger = new Logger({
 *     settings,
 *     level: 'info',
 *     file: createWriteStream('.noorm/noorm.log', { flags: 'a' }),
 * })
 *
 * // Logger automatically captures all observer events
 * // and writes them with appropriate formatting and redaction
 * ```
 */
import type { Writable } from 'node:stream';
import { join } from 'node:path';

import { observer, type NoormEvents } from '../observer.js';
import { isCi } from '../environment.js';
import { classifyEvent, shouldLog } from './classifier.js';
import { generateMessage, serializeEntry, formatEntry } from './formatter.js';
import { filterData } from './redact.js';
import { checkAndRotate } from './rotation.js';
import type { LogLevel, LoggerConfig, LoggerState, EntryLevel } from './types.js';
import { DEFAULT_LOGGER_CONFIG } from './types.js';
import type { Settings } from '../settings/types.js';
import type { EventQueue, QueueOpts } from '@logosdx/observer';

/**
 * Options for Logger construction.
 */
export interface LoggerOptions {
    /** Project root directory */
    projectRoot: string;

    /** Settings object (for secret detection) */
    settings: Settings;

    /** Logger configuration */
    config?: Partial<LoggerConfig>;

    /** Context to include with every entry */
    context?: Record<string, unknown>;

    /** File stream to write to (null for console-only) */
    file?: Writable;

    /** Console stream to write to (defaults to stdout in CI mode) */
    console?: Writable;
}

/**
 * Logger that captures observer events and writes to streams.
 *
 * Uses observer.queue() for non-blocking processing.
 * Automatically detects CI mode and writes to stdout.
 */
export class Logger {

    #projectRoot: string;

    #config: LoggerConfig;
    #context: Record<string, unknown>;
    #file: Writable | null = null;
    #console: Writable | null = null;
    #queue: EventQueue<NoormEvents, RegExp> | null = null;
    #state: LoggerState = 'idle';
    #rotationInterval: ReturnType<typeof setInterval> | null = null;
    #shutdownCleanup: (() => void) | null = null;

    constructor(options: LoggerOptions) {

        this.#projectRoot = options.projectRoot;
        this.#settings = options.settings;
        this.#config = { ...DEFAULT_LOGGER_CONFIG, ...options.config };
        this.#context = options.context ?? {};

        // Set up streams
        if (options.console) {

            this.#console = options.console;

        }
        else if (isCi()) {

            this.#console = process.stdout;

        }

        if (options.file) {

            this.#file = options.file;

        }

        // Listen for app shutdown
        this.#shutdownCleanup = observer.on('app:shutdown', async () => {

            await this.stop();

        });

    }

    /**
     * Get the current logger state.
     */
    get state(): LoggerState {

        return this.#state;

    }

    /**
     * Get the current log level.
     */
    get level(): LogLevel {

        return this.#config.level;

    }

    /**
     * Get the log file path.
     */
    get filepath(): string {

        return join(this.#projectRoot, this.#config.file);

    }

    /**
     * Check if logging is enabled.
     */
    get isEnabled(): boolean {

        return this.#config.enabled && this.#config.level !== 'silent';

    }

    /**
     * Update the logging context.
     *
     * Context is included with every log entry.
     */
    setContext(context: Record<string, unknown>): void {

        this.#context = { ...this.#context, ...context };

    }

    /**
     * Clear the logging context.
     */
    clearContext(): void {

        this.#context = {};

    }

    /**
     * Start the logger.
     *
     * Sets up the observer queue and begins capturing events.
     */
    async start(): Promise<void> {

        if (this.#state !== 'idle') {

            return;

        }

        if (!this.isEnabled) {

            return;

        }

        // Check rotation before starting (if file logging)
        if (this.#file) {

            const rotationResult = await checkAndRotate(
                this.filepath,
                this.#config.maxSize,
                this.#config.maxFiles,
            );

            if (rotationResult.rotated) {

                observer.emit('logger:rotated', {
                    oldFile: rotationResult.oldFile!,
                    newFile: rotationResult.newFile!,
                });

            }

            // Start rotation check interval (every minute)
            this.#rotationInterval = setInterval(() => {

                this.#checkRotation();

            }, 60_000);

        }

        // Create observer queue for non-blocking event processing
        this.#queue = observer.queue(
            /./,
            (payload) => {

                const { event, data } = payload as {
                    event: string;
                    data: Record<string, unknown>;
                };

                this.#handleEvent(event, data);

            },
            {
                name: 'logger',
                autoStart: true,
                concurrency: 1,
                type: 'fifo',
                debug: process.env['NOORM_LOGGER_DEBUG'] === 'true',
            } as QueueOpts,
        );

        this.#state = 'running';

        observer.emit('logger:started', {
            file: this.filepath,
            level: this.#config.level,
        });

    }

    /**
     * Stop the logger.
     *
     * Stops the queue and flushes pending entries.
     */
    async stop(): Promise<void> {

        if (this.#state !== 'running') {

            return;

        }

        this.#state = 'flushing';

        // Stop rotation interval
        if (this.#rotationInterval) {

            clearInterval(this.#rotationInterval);
            this.#rotationInterval = null;

        }

        // Stop the queue (will flush pending items)
        if (this.#queue) {

            await this.#queue.stop();
            this.#queue = null;

        }

        // Close file stream if we own it
        if (this.#file && this.#file !== process.stdout && this.#file !== process.stderr) {

            await new Promise<void>((resolve) => {

                this.#file!.end(() => resolve());

            });

        }

        // Remove shutdown listener
        if (this.#shutdownCleanup) {

            this.#shutdownCleanup();
            this.#shutdownCleanup = null;

        }

        this.#state = 'stopped';

    }

    /**
     * Handle an observer event.
     */
    #handleEvent(event: string, data: Record<string, unknown>): void {

        // Skip logger's own events to avoid loops
        if (event.startsWith('logger:')) {

            return;

        }

        // Check if event should be logged at current level
        if (!shouldLog(event, this.#config.level)) {

            return;

        }

        // Get event level for filtering
        const entryLevel = classifyEvent(event);

        // Filter sensitive data
        const filteredData = filterData({ ...data }, this.#config.level);

        // Format for output
        if (isCi()) {

            // CI mode: compact line format
            this.#writeLine(entryLevel, event, filteredData);

        }
        else {

            // File mode: JSON entries
            this.#writeEntry(event, filteredData);

        }

    }

    /**
     * Write a compact log line (CI mode).
     */
    #writeLine(level: EntryLevel, event: string, data: Record<string, unknown>): void {

        const timestamp = new Date().toISOString();
        const message = generateMessage(event, data);
        const levelLabel = level.toUpperCase().padEnd(5);

        let line = `[${timestamp}] [${levelLabel}] [${event}] ${message}`;

        // Add data in verbose mode
        if (this.#config.level === 'verbose' && Object.keys(data).length > 0) {

            line += ` ${JSON.stringify(data)}`;

        }

        line += '\n';

        if (this.#console) {

            this.#console.write(line);

        }

        if (this.#file) {

            this.#file.write(line);

        }

    }

    /**
     * Write a JSON log entry (file mode).
     */
    #writeEntry(event: string, data: Record<string, unknown>): void {

        const includeData = this.#config.level === 'verbose';
        const entry = formatEntry(event, data, this.#context, includeData);
        const line = serializeEntry(entry);

        if (this.#console) {

            this.#console.write(line);

        }

        if (this.#file) {

            this.#file.write(line);

        }

    }

    /**
     * Check if rotation is needed and perform it.
     */
    async #checkRotation(): Promise<void> {

        if (!this.#file || this.#state !== 'running') {

            return;

        }

        const result = await checkAndRotate(
            this.filepath,
            this.#config.maxSize,
            this.#config.maxFiles,
        );

        if (result.rotated) {

            observer.emit('logger:rotated', {
                oldFile: result.oldFile!,
                newFile: result.newFile!,
            });

        }

    }

    // ─────────────────────────────────────────────────────────────
    // Direct logging methods
    // ─────────────────────────────────────────────────────────────

    /**
     * Log an info message directly.
     */
    info(message: string, data?: Record<string, unknown>): void {

        this.#log('info', message, data);

    }

    /**
     * Log a warning message directly.
     */
    warn(message: string, data?: Record<string, unknown>): void {

        this.#log('warn', message, data);

    }

    /**
     * Log an error message directly.
     */
    error(message: string, data?: Record<string, unknown>): void {

        this.#log('error', message, data);

    }

    /**
     * Log a debug message directly.
     */
    debug(message: string, data?: Record<string, unknown>): void {

        this.#log('debug', message, data);

    }

    /**
     * Internal log method.
     */
    #log(level: EntryLevel, message: string, data?: Record<string, unknown>): void {

        if (!this.isEnabled || this.#state !== 'running') {

            return;

        }

        // Check if level should be logged
        const levelPriority = { error: 1, warn: 2, info: 3, debug: 4 };
        const configPriority = { silent: 0, error: 1, warn: 2, info: 3, verbose: 4 };

        if (levelPriority[level] > configPriority[this.#config.level]) {

            return;

        }

        const filteredData = data ? filterData({ ...data }, this.#config.level) : {};

        const timestamp = new Date().toISOString();
        const levelLabel = level.toUpperCase().padEnd(5);

        let line = `[${timestamp}] [${levelLabel}] ${message}`;

        if (this.#config.level === 'verbose' && data && Object.keys(data).length > 0) {

            line += ` ${JSON.stringify(filteredData)}`;

        }

        line += '\n';

        if (this.#console) {

            this.#console.write(line);

        }

        if (this.#file) {

            this.#file.write(line);

        }

    }

}

// ─────────────────────────────────────────────────────────────
// Singleton / Factory
// ─────────────────────────────────────────────────────────────

let loggerInstance: Logger | null = null;

/**
 * Get or create a Logger instance.
 *
 * @param options - Logger options
 * @returns Logger instance
 */
export function getLogger(options?: LoggerOptions): Logger | null {

    if (!loggerInstance && options) {

        loggerInstance = new Logger(options);

    }

    return loggerInstance;

}

/**
 * Reset the logger singleton.
 *
 * Useful for testing to ensure clean state between tests.
 */
export async function resetLogger(): Promise<void> {

    if (loggerInstance) {

        await loggerInstance.stop();
        loggerInstance = null;

    }

}
