/**
 * Log Formatter
 *
 * Converts observer events into LogEntry objects and serializes them
 * for file output. Each entry is a single JSON line.
 */
import type { LogEntry } from './types.js'
import { classifyEvent } from './classifier.js'


/**
 * Human-readable message templates for common events.
 * Keys are event names, values are functions that generate messages from event data.
 */
const MESSAGE_TEMPLATES: Record<string, (data: Record<string, unknown>) => string> = {

    // File execution
    'file:before': (d) => `Executing ${d['filepath']}`,
    'file:after': (d) => d['status'] === 'success'
        ? `Executed ${d['filepath']} (${d['durationMs']}ms)`
        : `Failed ${d['filepath']}: ${d['error']}`,
    'file:skip': (d) => `Skipped ${d['filepath']} (${d['reason']})`,

    // Changeset
    'changeset:start': (d) => `Starting ${d['direction']} for ${d['name']} (${(d['files'] as string[])?.length ?? 0} files)`,
    'changeset:file': (d) => `${d['changeset']}: ${d['filepath']} (${d['index']}/${d['total']})`,
    'changeset:complete': (d) => `${d['direction']} ${d['name']}: ${d['status']} (${d['durationMs']}ms)`,

    // Build/Run
    'build:start': (d) => `Starting schema build (${d['fileCount']} files)`,
    'build:complete': (d) => d['status'] === 'success'
        ? `Build complete: ${d['filesRun']} run, ${d['filesSkipped']} skipped (${d['durationMs']}ms)`
        : `Build failed after ${d['filesRun']} files (${d['durationMs']}ms)`,
    'run:file': (d) => `Running ${d['filepath']} on ${d['configName']}`,
    'run:dir': (d) => `Running directory ${d['dirpath']} (${d['fileCount']} files) on ${d['configName']}`,

    // Lock
    'lock:acquiring': (d) => `Acquiring lock for ${d['configName']} as ${d['identity']}`,
    'lock:acquired': (d) => `Lock acquired for ${d['configName']}`,
    'lock:released': (d) => `Lock released for ${d['configName']}`,
    'lock:blocked': (d) => `Lock blocked: ${d['configName']} held by ${d['holder']}`,
    'lock:expired': (d) => `Lock expired for ${d['configName']} (was held by ${d['previousHolder']})`,

    // State
    'state:loaded': (d) => `State loaded: ${d['configCount']} configs, version ${d['version']}`,
    'state:persisted': (d) => `State saved: ${d['configCount']} configs`,
    'state:migrated': (d) => `State migrated from ${d['from']} to ${d['to']}`,

    // Config
    'config:created': (d) => `Created config: ${d['name']}`,
    'config:updated': (d) => `Updated config ${d['name']}: ${(d['fields'] as string[])?.join(', ')}`,
    'config:deleted': (d) => `Deleted config: ${d['name']}`,
    'config:activated': (d) => `Activated config: ${d['name']}${d['previous'] ? ` (was ${d['previous']})` : ''}`,

    // Secrets
    'secret:set': (d) => `Set secret ${d['key']} for ${d['configName']}`,
    'secret:deleted': (d) => `Deleted secret ${d['key']} from ${d['configName']}`,
    'global-secret:set': (d) => `Set global secret: ${d['key']}`,
    'global-secret:deleted': (d) => `Deleted global secret: ${d['key']}`,

    // DB lifecycle
    'db:creating': (d) => `Creating database ${d['database']} for ${d['configName']}`,
    'db:created': (d) => `Created database ${d['database']} (${d['durationMs']}ms)`,
    'db:destroying': (d) => `Destroying database ${d['database']} for ${d['configName']}`,
    'db:destroyed': (d) => `Destroyed database ${d['database']}`,
    'db:bootstrap': (d) => `Bootstrapped ${(d['tables'] as string[])?.length ?? 0} tables for ${d['configName']}`,

    // Template
    'template:render': (d) => `Rendered template ${d['filepath']} (${d['durationMs']}ms)`,
    'template:load': (d) => `Loaded ${d['format']} data from ${d['filepath']}`,

    // Identity
    'identity:resolved': (d) => `Identity resolved: ${d['name']} (${d['source']})`,
    'identity:created': (d) => `Created identity: ${d['name']} <${d['email']}>`,
    'identity:synced': (d) => `Synced ${d['discovered']} identities for ${d['configName']}`,
    'identity:registered': (d) => `Registered identity for ${d['configName']}`,

    // Config sharing
    'config:exported': (d) => `Exported ${d['configName']} to ${d['recipient']}`,
    'config:imported': (d) => `Imported ${d['configName']} from ${d['from']}`,

    // Connection
    'connection:open': (d) => `Connected to ${d['configName']} (${d['dialect']})`,
    'connection:close': (d) => `Disconnected from ${d['configName']}`,
    'connection:error': (d) => `Connection error for ${d['configName']}: ${d['error']}`,

    // Logger lifecycle
    'logger:started': (d) => `Logger started: ${d['file']} at ${d['level']} level`,
    'logger:rotated': (d) => `Rotated log: ${d['oldFile']} -> ${d['newFile']}`,
    'logger:error': (d) => `Logger error: ${(d['error'] as Error)?.message ?? d['error']}`,
    'logger:flushed': (d) => `Flushed ${d['entriesWritten']} log entries`,

    // Settings
    'settings:loaded': (d) => `Settings loaded from ${d['path']}`,
    'settings:saved': (d) => `Settings saved to ${d['path']}`,
    'settings:initialized': (d) => `Settings initialized at ${d['path']}${d['force'] ? ' (forced)' : ''}`,

    // Generic error
    'error': (d) => `Error in ${d['source']}: ${(d['error'] as Error)?.message ?? d['error']}`,
}


/**
 * Generate a human-readable message for an event.
 *
 * Uses templates for known events, falls back to generic format.
 *
 * @param event - Observer event name
 * @param data - Event payload
 * @returns Human-readable message
 */
export function generateMessage(event: string, data: Record<string, unknown>): string {

    const template = MESSAGE_TEMPLATES[event]

    if (template) {

        try {

            return template(data)
        }
        catch {

            // Fall through to generic format
        }
    }

    // Generic format: "Event occurred" or "Event: key=value, ..."
    const parts = Object.entries(data)
        .slice(0, 3)
        .map(([k, v]) => `${k}=${summarizeValue(v)}`)

    if (parts.length === 0) {

        return event.replace(/:/g, ' ')
    }

    return `${event.replace(/:/g, ' ')}: ${parts.join(', ')}`
}


/**
 * Summarize a value for log message display.
 * Truncates long strings and formats objects.
 */
function summarizeValue(value: unknown): string {

    if (value === null || value === undefined) {

        return String(value)
    }

    if (typeof value === 'string') {

        if (value.length > 50) {

            return `"${value.slice(0, 47)}..."`
        }

        return `"${value}"`
    }

    if (typeof value === 'number' || typeof value === 'boolean') {

        return String(value)
    }

    if (Array.isArray(value)) {

        return `[${value.length} items]`
    }

    if (typeof value === 'object') {

        return `{${Object.keys(value).length} keys}`
    }

    return String(value)
}


/**
 * Format an event into a LogEntry.
 *
 * @param event - Observer event name
 * @param data - Event payload
 * @param context - Additional context (config name, etc.)
 * @param includeData - Whether to include full payload (verbose mode)
 * @returns Formatted log entry
 *
 * @example
 * ```typescript
 * const entry = formatEntry('build:start', { fileCount: 10 }, { config: 'dev' }, true)
 * // {
 * //     timestamp: '2024-01-15T10:30:00.000Z',
 * //     level: 'info',
 * //     event: 'build:start',
 * //     message: 'Starting schema build (10 files)',
 * //     data: { fileCount: 10 },
 * //     context: { config: 'dev' }
 * // }
 * ```
 */
export function formatEntry(
    event: string,
    data: Record<string, unknown>,
    context?: Record<string, unknown>,
    includeData = false
): LogEntry {

    const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: classifyEvent(event),
        event,
        message: generateMessage(event, data),
    }

    // Include full data at verbose level
    if (includeData && Object.keys(data).length > 0) {

        entry.data = sanitizeData(data)
    }

    // Include context if provided
    if (context && Object.keys(context).length > 0) {

        entry.context = context
    }

    return entry
}


/**
 * Sanitize data for logging.
 * Removes sensitive fields and handles non-serializable values.
 */
function sanitizeData(data: Record<string, unknown>): Record<string, unknown> {

    const SENSITIVE_KEYS = ['password', 'secret', 'key', 'token', 'credential', 'auth']
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(data)) {

        // Redact sensitive fields
        const lowerKey = key.toLowerCase()

        if (SENSITIVE_KEYS.some((s) => lowerKey.includes(s))) {

            result[key] = '[REDACTED]'
            continue
        }

        // Handle Error objects
        if (value instanceof Error) {

            result[key] = {
                name: value.name,
                message: value.message,
                stack: value.stack?.split('\n').slice(0, 3).join('\n'),
            }
            continue
        }

        // Handle Date objects
        if (value instanceof Date) {

            result[key] = value.toISOString()
            continue
        }

        // Handle circular references / non-serializable
        try {

            JSON.stringify(value)
            result[key] = value
        }
        catch {

            result[key] = String(value)
        }
    }

    return result
}


/**
 * Serialize a LogEntry to a JSON line for file output.
 *
 * @param entry - Log entry to serialize
 * @returns JSON string with newline
 */
export function serializeEntry(entry: LogEntry): string {

    return JSON.stringify(entry) + '\n'
}
