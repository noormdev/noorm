/**
 * Logger Types
 *
 * Type definitions for the noorm logging system.
 * The logger captures observer events and streams them
 * to a log file with configurable verbosity.
 */

/**
 * Log verbosity levels.
 *
 * - silent: No logging
 * - error: Errors only
 * - warn: Errors + warnings
 * - info: Errors + warnings + info (default)
 * - verbose: All events including debug
 */
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'verbose';

/**
 * Numeric priority for log levels.
 * Higher numbers = more verbose.
 */
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    verbose: 4,
};

/**
 * Entry level in the log file.
 * Maps to standard logging conventions.
 */
export type EntryLevel = 'error' | 'warn' | 'info' | 'debug';

/**
 * A single log entry.
 *
 * Entries are JSON-serialized, one per line in the log file.
 *
 * @example
 * ```json
 * {
 *     "timestamp": "2024-01-15T10:30:00.000Z",
 *     "level": "info",
 *     "event": "build:start",
 *     "message": "Starting schema build",
 *     "context": { "config": "dev" }
 * }
 * ```
 */
export interface LogEntry {
    /** ISO 8601 timestamp */
    timestamp: string;

    /** Entry severity level */
    level: EntryLevel;

    /** Observer event name */
    event: string;

    /** Human-readable summary */
    message: string;

    /** Event payload (included at verbose level) */
    data?: Record<string, unknown>;

    /** Additional context (config name, identity, etc.) */
    context?: Record<string, unknown>;
}

/**
 * Logger configuration from settings.
 *
 * These values come from .noorm/settings.yml logging section.
 */
export interface LoggerConfig {
    /** Enable file logging */
    enabled: boolean;

    /** Minimum level to capture */
    level: LogLevel;

    /** Log file path (relative to project root) */
    file: string;

    /** Rotate log when size exceeded (e.g., '10mb') */
    maxSize: string;

    /** Number of rotated files to keep */
    maxFiles: number;
}

/**
 * Default logger configuration.
 */
export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
    enabled: true,
    level: 'info',
    file: '.noorm/noorm.log',
    maxSize: '10mb',
    maxFiles: 5,
};

/**
 * Log rotation result.
 */
export interface RotationResult {
    /** Whether rotation occurred */
    rotated: boolean;

    /** Old file path (if rotated) */
    oldFile?: string;

    /** New rotated file path (if rotated) */
    newFile?: string;

    /** Files deleted during cleanup (if maxFiles exceeded) */
    deletedFiles?: string[];
}

/**
 * Logger state for lifecycle management.
 */
export type LoggerState = 'idle' | 'running' | 'flushing' | 'stopped';
