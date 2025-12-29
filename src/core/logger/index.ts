/**
 * Logger Module
 *
 * Captures observer events and streams them to log outputs.
 * Uses observer.queue() for non-blocking event processing.
 *
 * Features:
 * - Automatic CI detection (stdout vs file)
 * - Smart redaction of sensitive fields
 * - Event-driven initialization
 * - Log rotation support
 */

// Types
export type {
    LogLevel,
    EntryLevel,
    LogEntry,
    LoggerConfig,
    RotationResult,
    LoggerState,
} from './types.js';

export { LOG_LEVEL_PRIORITY, DEFAULT_LOGGER_CONFIG } from './types.js';

// Classifier
export { classifyEvent, shouldLog } from './classifier.js';

// Formatter
export { generateMessage, formatEntry, serializeEntry } from './formatter.js';

// Rotation
export {
    parseSize,
    generateRotatedName,
    needsRotation,
    rotateFile,
    listRotatedFiles,
    cleanupRotatedFiles,
    checkAndRotate,
} from './rotation.js';

// Redaction
export {
    addMaskedFields,
    isMaskedField,
    maskValue,
    addSettingsSecrets,
    listenForSecrets,
    filterData,
} from './redact.js';

// Logger
export { Logger, getLogger, resetLogger, type LoggerOptions } from './logger.js';

// Initialization
export { enableAutoLoggerInit, disableAutoLoggerInit, getInitializedLogger } from './init.js';
