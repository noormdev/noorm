/**
 * Core module exports.
 *
 * All business logic modules are exported from here.
 * CLI components should import from this barrel file.
 */

// Observer
export { observer } from './observer.js'
export type { NoormEvents, ObserverEngine } from './observer.js'

// State
export {
    StateManager,
    getStateManager,
    initState,
    resetStateManager,
    createEmptyState,
    migrateState,
    needsMigration,
    getPackageVersion,
} from './state/index.js'
export type {
    State,
    ConfigSummary,
    EncryptedPayload,
} from './state/index.js'

// Config types
export type {
    Config,
    ConfigInput,
    ConfigSummary as ConfigListSummary,
} from './config/types.js'

// Connection
export {
    createConnection,
    testConnection,
    getConnectionManager,
    resetConnectionManager,
} from './connection/index.js'
export type {
    Dialect,
    ConnectionConfig,
    ConnectionResult,
} from './connection/index.js'
