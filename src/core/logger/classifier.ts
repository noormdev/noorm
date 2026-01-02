/**
 * Event Classifier
 *
 * Classifies observer events by log level based on naming patterns.
 *
 * Classification rules:
 * - 'error' or '*:error', '*:failed' -> error
 * - '*:warning' -> warn
 * - '*:start', '*:complete', '*:created', etc. -> info
 * - Everything else -> debug
 */
import type { EntryLevel, LogLevel } from './types.js';
import { LOG_LEVEL_PRIORITY } from './types.js';

/**
 * Patterns that classify an event as error level.
 */
const ERROR_PATTERNS = [/^error$/, /:error$/, /:failed$/];

/**
 * Patterns that classify an event as warn level.
 */
const WARN_PATTERNS = [/:warning$/, /:blocked$/, /:expired$/];

/**
 * Patterns that classify an event as info level.
 * These are significant lifecycle events worth logging at default verbosity.
 */
const INFO_PATTERNS = [
    /:start$/,
    /:complete$/,
    /:created$/,
    /:deleted$/,
    /:updated$/,
    /:activated$/,
    /:loaded$/,
    /:persisted$/,
    /:migrated$/,
    /:acquired$/,
    /:released$/,
    /:resolved$/,
    /:open$/,
    /:close$/,
    /:set$/,
    /:rotated$/,
    /:flushed$/,
    /:started$/,
    /:initialized$/,
    // File execution events - important for tracking build progress
    /:after$/,
    /:skip$/,
    /:dry-run$/,
];

/**
 * Classify an event name to determine its log level.
 *
 * @param event - Observer event name
 * @returns The classified entry level
 *
 * @example
 * ```typescript
 * classifyEvent('error')           // 'error'
 * classifyEvent('connection:error') // 'error'
 * classifyEvent('build:start')     // 'info'
 * classifyEvent('file:before')     // 'debug'
 * ```
 */
export function classifyEvent(event: string): EntryLevel {

    // Check error patterns
    for (const pattern of ERROR_PATTERNS) {

        if (pattern.test(event)) {

            return 'error';

        }

    }

    // Check warn patterns
    for (const pattern of WARN_PATTERNS) {

        if (pattern.test(event)) {

            return 'warn';

        }

    }

    // Check info patterns
    for (const pattern of INFO_PATTERNS) {

        if (pattern.test(event)) {

            return 'info';

        }

    }

    // Default to debug
    return 'debug';

}

/**
 * Check if an event should be logged at the given verbosity level.
 *
 * @param event - Observer event name
 * @param configLevel - Configured minimum log level
 * @returns true if the event should be logged
 *
 * @example
 * ```typescript
 * shouldLog('error', 'warn')        // true (errors always logged)
 * shouldLog('build:start', 'info')  // true (info event at info level)
 * shouldLog('file:before', 'info')  // false (debug event at info level)
 * shouldLog('file:before', 'verbose') // true (everything at verbose)
 * ```
 */
export function shouldLog(event: string, configLevel: LogLevel): boolean {

    if (configLevel === 'silent') {

        return false;

    }

    if (configLevel === 'verbose') {

        return true;

    }

    const eventLevel = classifyEvent(event);
    const eventPriority = getEntryLevelPriority(eventLevel);
    const configPriority = LOG_LEVEL_PRIORITY[configLevel];

    return eventPriority <= configPriority;

}

/**
 * Map entry level to priority for comparison.
 * Lower priority = more severe/important.
 */
function getEntryLevelPriority(level: EntryLevel): number {

    switch (level) {

    case 'error':
        return 1;
    case 'warn':
        return 2;
    case 'info':
        return 3;
    case 'debug':
        return 4;

    }

}
