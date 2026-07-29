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
 *     file: createWriteStream('.noorm/state/noorm.log', { flags: 'a' }),
 * })
 *
 * // Logger automatically captures all observer events
 * // and writes them with appropriate formatting and redaction
 * ```
 */
import type { Writable } from 'node:stream';
import { join, dirname } from 'node:path';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir } from 'node:fs/promises';

import { observer, type NoormEvents } from '../observer.js';
import { isCi } from '../environment.js';
import { classifyEvent, shouldLog } from './classifier.js';
import { generateMessage } from './formatter.js';
import { formatColorLine } from './color.js';
import { filterData } from './redact.js';
import { checkAndRotate } from './rotation.js';
import { formatLogTimestamp, formatLogTimestampIso } from './timestamp.js';
import type { LogLevel, LoggerConfig, LoggerState, EntryLevel } from './types.js';
import { DEFAULT_LOGGER_CONFIG } from './types.js';
import type { Settings } from '../settings/types.js';
import type { EventQueue, QueueOpts } from '@logosdx/observer';
import { attempt, merge } from '@logosdx/utils';

/**
 * Log files are owner-only: they carry redacted-but-not-guaranteed-clean event
 * data, and sit in the same directory as `state.enc`, which is already 0600.
 */
const LOG_FILE_MODE = 0o600;

/**
 * Flatten object for JSON output with dot-notation keys.
 *
 * Different from color.ts flattenData which formats for display.
 * This flattens one level deep for observability tools.
 */
function flattenToJson(
    source: Record<string, unknown>,
    target: Record<string, unknown>,
): void {

    for (const [key, value] of Object.entries(source)) {

        if (key in target) continue; // Preserve core fields

        if (value === null || value === undefined) {

            target[key] = value;

        }
        else if (Array.isArray(value)) {

            target[key] = JSON.stringify(value);

        }
        else if (typeof value === 'object') {

            // Flatten one level with dot-notation
            for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {

                const nestedKey = `${key}.${subKey}`;
                if (!(nestedKey in target)) {

                    target[nestedKey] = typeof subValue === 'object' && subValue !== null
                        ? JSON.stringify(subValue)
                        : subValue;

                }

            }

        }
        else {

            target[key] = value;

        }

    }

}

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

    /** Error stream to write to (defaults to stderr) */
    diagnostics?: Writable;

    /** Enable colored output for console (default: true if console provided) */
    color?: boolean;

    /** Enable JSON output (overrides color) */
    json?: boolean;
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
    #writers: {
        file: Writable | null;
        console: Writable;
        diagnostics: Writable;
    } = {
            file: null,
            console: process.stdout,
            diagnostics: process.stderr,
        };

    #color: boolean = false;
    #json: boolean = false;
    #queue: EventQueue<NoormEvents, RegExp> | null = null;
    #state: LoggerState = 'idle';
    #rotationInterval: ReturnType<typeof setInterval> | null = null;
    #shutdownCleanup: (() => void) | null = null;

    constructor(options: LoggerOptions) {

        this.#projectRoot = options.projectRoot;
        this.#config = { ...DEFAULT_LOGGER_CONFIG, ...options.config };
        this.#context = options.context ?? {};
        this.#json = options.json ?? isCi();

        // JSON mode disables color
        if (this.#json) {

            this.#color = false;

        }

        if (options.color) {

            this.#color = options.color;

        }

        // Set up streams
        if (options.console) {

            this.#writers.console = options.console;

        }

        if (options.diagnostics) {

            this.#writers.diagnostics = options.diagnostics;

        }

        if (options.file) {

            this.#writers.file = options.file;

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
     * Get logger statistics.
     *
     * Returns null when logger is not running.
     */
    get stats(): { pending: number; totalWritten: number } | null {

        if (this.#state !== 'running' || !this.#queue) {

            return null;

        }

        return {
            pending: this.#queue.pending,
            totalWritten: this.#queue.stats.processed,
        };

    }

    /**
     * Flush pending log entries.
     *
     * Waits for all queued entries to be processed.
     */
    async flush(): Promise<void> {

        if (!this.#queue || this.#state !== 'running') {

            return;

        }

        await this.#queue.flush();

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

        if (this.#config.file) {

            // Rotate before opening, not after: rotation renames the log file,
            // so a stream opened first would already be bound to the rotated
            // inode by the time the rename lands.
            const rotationResult = await checkAndRotate(
                this.filepath,
                this.#config.maxSize,
                this.#config.maxFiles,
            );

            // A caller-supplied stream is kept as-is unless rotation just moved
            // the file out from under it, in which case it points at the wrong
            // inode and has to be replaced.
            if (!this.#writers.file || rotationResult.rotated) {

                await this.#openFileStream();

            }

            if (rotationResult.rotated) {

                observer.emit('logger:rotated', {
                    oldFile: rotationResult.oldFile!,
                    newFile: rotationResult.newFile!,
                });

            }

            // Start rotation check interval (every minute)
            this.#rotationInterval = setInterval(() => {

                this.checkRotation();

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
        if (this.#writers.file && this.#writers.file !== process.stdout && this.#writers.file !== process.stderr) {

            await new Promise<void>((resolve) => {

                this.#writers.file!.end(() => resolve());

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

        // Get event level, with override for non-success status
        let entryLevel = classifyEvent(event);

        // Override to error for failed/partial completions and file executions
        // Only apply if the event actually has a status field
        if (
            (event.endsWith(':complete') || event.endsWith(':after')) &&
            'status' in data &&
            data['status'] !== 'success' &&
            data['status'] !== 'skipped'
        ) {

            entryLevel = 'error';

        }

        if (data['error']) {

            entryLevel = 'error';

        }

        // Filter sensitive data
        const filteredData = filterData({ ...data }, this.#config.level);

        // Generate human-readable message
        const message = generateMessage(event, filteredData);

        // Console output: based on user settings
        this.#writeConsole(entryLevel, event, message, filteredData);

        // File output: always JSON
        this.#writeFile(entryLevel, event, message, filteredData);

    }

    /**
     * Write to console stream.
     *
     * Format depends on user settings:
     * - JSON mode: NDJSON with time, type, level, message
     * - Color mode: Colored inline format
     * - Plain mode: Bracketed timestamp format
     */
    #writeConsole(
        level: EntryLevel,
        event: string,
        message: string,
        data: Record<string, unknown>,
    ): void {

        const hasData = data && Object.keys(data).length > 0;

        if (this.#json) {

            // Event stream, not a command result — stays on diagnostics even in
            // JSON mode, so `result()`'s payload is the only thing on stdout.
            const entry = this.#buildJsonEntry(level, event, message, data, hasData);
            this.#writers.diagnostics.write(JSON.stringify(entry) + '\n');

        }
        else if (this.#color) {

            // Colored format: [timestamp] icon event  message  key=value key=value
            const timestamp = formatLogTimestamp(new Date());
            const colorLine = formatColorLine(
                level,
                event,
                message,
                hasData ? data : undefined,
            );
            this.#writers.diagnostics.write(`[${timestamp}] ${colorLine}\n`);

        }
        else {

            // Plain format: [timestamp] [LEVEL] [event] message
            const timestamp = formatLogTimestamp(new Date());
            const levelLabel = level.toUpperCase().padEnd(5);
            let line = `[${timestamp}] [${levelLabel}] [${event}] ${message}`;

            if (hasData) {

                line += ` ${JSON.stringify(data)}`;

            }

            this.#writers.diagnostics.write(line + '\n');

        }

    }

    /**
     * Write to file stream.
     *
     * Always outputs JSON format for parseability by observability tools.
     */
    #writeFile(
        level: EntryLevel,
        event: string,
        message: string,
        data: Record<string, unknown>,
    ): void {

        if (!this.#writers.file) {

            return;

        }

        const hasData = data && Object.keys(data).length > 0;
        const entry = this.#buildJsonEntry(level, event, message, data, hasData);
        this.#writers.file.write(JSON.stringify(entry) + '\n');

    }

    /**
     * Build a JSON entry for observability tools.
     *
     * Uses field names compatible with Grafana, GitHub Actions:
     * - time: ISO 8601 with local timezone
     * - type: event type (observer event name)
     * - level: log level
     * - message: human-readable message
     * - Plus flattened data fields with dot-notation
     */
    #buildJsonEntry(
        level: EntryLevel,
        event: string,
        message: string,
        data: Record<string, unknown>,
        includeData: boolean,
    ): Record<string, unknown> {

        const entry: Record<string, unknown> = {
            time: formatLogTimestampIso(new Date()),
            type: event,
            level,
            message,
        };

        if (includeData && Object.keys(data).length > 0) {

            flattenToJson(data, entry);

        }

        // Add context fields
        if (this.#context && Object.keys(this.#context).length > 0) {

            flattenToJson(this.#context, entry);

        }

        return entry;

    }

    /**
     * Open (or re-open) the file writer at the current log path.
     *
     * The new stream is installed before the old one is closed so no entry can
     * be written to a writer that is already gone.
     */
    async #openFileStream(): Promise<void> {

        const filePath = this.filepath;
        const previous = this.#writers.file;

        await mkdir(dirname(filePath), { recursive: true });

        const stream = createWriteStream(filePath, { flags: 'a', mode: LOG_FILE_MODE });

        stream.on('error', () => {}); // best-effort file logging

        this.#writers.file = stream;

        // `mode` only applies when the file is created, so a log left behind by
        // an older build stays 0644 until it is explicitly narrowed.
        await attempt(() => chmod(filePath, LOG_FILE_MODE));

        if (previous && previous !== process.stdout && previous !== process.stderr) {

            await new Promise<void>((resolve) => previous.end(() => resolve()));

        }

    }

    /**
     * Check if rotation is needed and perform it, re-opening the file writer
     * when it fires.
     *
     * Rotation renames the live file. Without re-opening, the still-open fd
     * follows the renamed inode: every later entry lands in the rotated file,
     * the log path stays missing, and `needsRotation` on a missing path reports
     * false forever — so rotation would fire exactly once per process and the
     * rotated file would then grow unbounded.
     *
     * Public because the 60s interval is far too coarse to drive from a test,
     * and callers that write in bursts may want to force the check.
     *
     * @example
     * ```typescript
     * await logger.checkRotation();
     * ```
     */
    async checkRotation(): Promise<void> {

        if (!this.#writers.file || this.#state !== 'running' || !this.#config.file) {

            return;

        }

        const result = await checkAndRotate(
            this.filepath,
            this.#config.maxSize,
            this.#config.maxFiles,
        );

        if (!result.rotated) {

            return;

        }

        await this.#openFileStream();

        observer.emit('logger:rotated', {
            oldFile: result.oldFile!,
            newFile: result.newFile!,
        });

    }

    // ─────────────────────────────────────────────────────────────
    // Direct logging methods
    // ─────────────────────────────────────────────────────────────

    /**
     * Log an info message directly.
     */
    info(message: string, data?: object): void {

        this.#log('info', message, data);

    }

    /**
     * Log a warning message directly.
     */
    warn(message: string, data?: object): void {

        this.#log('warn', message, data);

    }

    /**
     * Log an error message directly.
     */
    error(message: string, data?: unknown): void {

        this.#log('error', message, data as never);

    }

    /**
     * Log a debug message directly.
     */
    debug(message: string, data?: object): void {

        this.#log('debug', message, data);

    }

    /**
     * Internal log method.
     *
     * Uses the same output methods as observer events for consistent formatting.
     */
    #log(level: EntryLevel, message: string, data?: object): void {

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

        // Use same output methods as observer events
        this.#writeConsole(level, 'log', message, filteredData);
        this.#writeFile(level, 'log', message, filteredData);

    }

    // ─────────────────────────────────────────────────────────────
    // Result output (for headless commands)
    // ─────────────────────────────────────────────────────────────

    /**
     * Output a command result as JSON.
     *
     * Used by headless commands to output their final result.
     * Writes raw JSON to stdout (for scripting) and to log file.
     *
     * @example
     * ```typescript
     * logger.result({ success: true, tables: [...], totalRows: 100 });
     * // stdout: {"success":true,"tables":[...],"totalRows":100}
     * ```
     */
    result(data: unknown): void {

        const json = JSON.stringify(data) + '\n';

        if (this.#writers.console) {

            this.#writers.console.write(json);

        }

        if (this.#writers.file) {

            this.#writers.file.write(json);

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
 * @param optionsOrProjectRoot - Logger options or just the project root path
 * @returns Logger instance
 */
export function getLogger(optionsOrProjectRoot?: LoggerOptions | string): Logger | null {

    if (!loggerInstance && optionsOrProjectRoot) {

        let options: LoggerOptions = {
            projectRoot: '',
            settings: {} as Settings,
        };

        if (typeof optionsOrProjectRoot === 'string') {

            options.projectRoot = optionsOrProjectRoot;

        }
        else {

            options = merge(options, optionsOrProjectRoot) as LoggerOptions;

        }

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
