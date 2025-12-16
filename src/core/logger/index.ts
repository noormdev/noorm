/**
 * Logger Module
 *
 * Captures observer events and streams them to a log file.
 * Uses a queue-based write system that guarantees delivery
 * and supports automatic log rotation.
 */

// Types
export type {
    LogLevel,
    EntryLevel,
    LogEntry,
    LoggerConfig,
    QueueEntry,
    QueueStats,
    RotationResult,
    LoggerState,
    LoggerOptions,
} from './types.js'

export {
    LOG_LEVEL_PRIORITY,
    DEFAULT_LOGGER_CONFIG,
} from './types.js'

// Classifier
export {
    classifyEvent,
    shouldLog,
} from './classifier.js'

// Formatter
export {
    generateMessage,
    formatEntry,
    serializeEntry,
} from './formatter.js'

// Write Queue
export { WriteQueue } from './queue.js'

// Rotation
export {
    parseSize,
    generateRotatedName,
    needsRotation,
    rotateFile,
    listRotatedFiles,
    cleanupRotatedFiles,
    checkAndRotate,
} from './rotation.js'

// Logger
export {
    Logger,
    getLogger,
    resetLogger,
} from './logger.js'
