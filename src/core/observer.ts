/**
 * Central event system for noorm.
 *
 * Core modules emit events, CLI subscribes. This creates a clean separation
 * between business logic and UI concerns.
 *
 * @example
 * ```typescript
 * // In core module - emit events at key points
 * observer.emit('file:before', { filepath, checksum, configName })
 *
 * // In CLI - subscribe to events
 * const cleanup = observer.on('file:after', (data) => updateProgress(data))
 *
 * // Pattern matching for multiple events
 * observer.on(/^file:/, ({ event, data }) => logFileEvent(event, data))
 * ```
 */
import {
    ObserverEngine,
    type Events
} from '@logosdx/observer'


/**
 * All events emitted by noorm core modules.
 *
 * Events are namespaced by module:
 * - `file:*` - Individual SQL file execution
 * - `build:*` - Schema build operations
 * - `run:*` - Ad-hoc file/dir execution
 * - `changeset:*` - Changeset execution
 * - `lock:*` - Lock acquisition/release
 * - `state:*` - State load/persist
 * - `config:*` - Config CRUD
 * - `secret:*` - Secret CRUD
 * - `db:*` - Database lifecycle
 * - `template:*` - Template rendering
 * - `identity:*` - Identity resolution
 * - `connection:*` - Database connections
 * - `error` - Catch-all errors
 */
export interface NoormEvents {

    // File execution
    'file:before': { filepath: string; checksum: string; configName: string }
    'file:after': { filepath: string; status: 'success' | 'failed'; durationMs: number; error?: string }
    'file:skip': { filepath: string; reason: 'unchanged' | 'already-run' }
    'file:dry-run': { filepath: string; outputPath: string }

    // Changeset lifecycle
    'changeset:start': { name: string; direction: 'change' | 'revert'; files: string[] }
    'changeset:file': { changeset: string; filepath: string; index: number; total: number }
    'changeset:complete': { name: string; direction: 'change' | 'revert'; status: 'success' | 'failed'; durationMs: number }

    // Build/Run
    'build:start': { schemaPath: string; fileCount: number }
    'build:complete': { status: 'success' | 'failed' | 'partial'; filesRun: number; filesSkipped: number; filesFailed: number; durationMs: number }
    'run:file': { filepath: string; configName: string }
    'run:dir': { dirpath: string; fileCount: number; configName: string }

    // Lock
    'lock:acquiring': { configName: string; identity: string }
    'lock:acquired': { configName: string; identity: string; expiresAt: Date }
    'lock:released': { configName: string; identity: string }
    'lock:blocked': { configName: string; holder: string; heldSince: Date }
    'lock:expired': { configName: string; previousHolder: string }

    // State
    'state:loaded': { configCount: number; activeConfig: string | null; version: string }
    'state:persisted': { configCount: number }
    'state:migrated': { from: string; to: string }

    // Config
    'config:created': { name: string }
    'config:updated': { name: string; fields: string[] }
    'config:deleted': { name: string }
    'config:activated': { name: string; previous: string | null }

    // Secrets (config-scoped)
    'secret:set': { configName: string; key: string }
    'secret:deleted': { configName: string; key: string }

    // Global secrets (app-level)
    'global-secret:set': { key: string }
    'global-secret:deleted': { key: string }

    // Known users
    'known-user:added': { email: string; source: string }

    // DB lifecycle
    'db:creating': { configName: string; database: string }
    'db:created': { configName: string; database: string; durationMs: number }
    'db:destroying': { configName: string; database: string }
    'db:destroyed': { configName: string; database: string }
    'db:bootstrap': { configName: string; tables: string[] }

    // Template
    'template:render': { filepath: string; durationMs: number }
    'template:load': { filepath: string; format: string }
    'template:helpers': { filepath: string; count: number }

    // Identity (audit)
    'identity:resolved': { name: string; email?: string; source: 'state' | 'git' | 'system' | 'config' | 'env' }

    // Identity (cryptographic)
    'identity:created': { identityHash: string; name: string; email: string; machine: string }
    'identity:synced': { discovered: number; configName: string }
    'identity:registered': { configName: string }

    // Config sharing
    'config:exported': { configName: string; recipient: string }
    'config:imported': { configName: string; from: string }

    // Connection
    'connection:open': { configName: string; dialect: string }
    'connection:close': { configName: string }
    'connection:error': { configName: string; error: string }

    // Errors
    'error': { source: string; error: Error; context?: Record<string, unknown> }
}

export type NoormEventNames = Events<NoormEvents>;
export type NoormEventCallback<E extends NoormEventNames> = ObserverEngine.EventCallback<NoormEvents[E]>

/**
 * Global observer instance for noorm.
 *
 * Enable debug mode with `NOORM_DEBUG=1` to see all events as they occur.
 *
 * @example
 * ```typescript
 * import { observer } from './observer'
 *
 * // Emit an event
 * observer.emit('file:before', { filepath, checksum, configName })
 *
 * // Subscribe to an event
 * const cleanup = observer.on('file:after', (data) => {
 *     console.log(`File ${data.filepath}: ${data.status}`)
 * })
 *
 * // Clean up when done
 * cleanup()
 * ```
 */
export const observer = new ObserverEngine<NoormEvents>({
    name: 'noorm',
    spy: process.env['NOORM_DEBUG']
        ? (action) => console.error(`[noorm:${action.fn}] ${String(action.event)}`)
        : undefined
});

// ? Not against this, but why are we re-exporting? convenience
export type { ObserverEngine }
