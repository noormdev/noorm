/**
 * Lifecycle Module
 *
 * Manages application startup and shutdown, ensuring clean initialization
 * and graceful cleanup of all subsystems. Handles signals (SIGINT, SIGTERM)
 * for graceful shutdown and fatal errors for emergency shutdown.
 */

// Types
export type {
    LifecycleState,
    ShutdownPhase,
    PhaseStatus,
    ShutdownReason,
    AppMode,
    ShutdownTimeouts,
    LifecycleConfig,
    ShutdownPhaseInfo,
    LifecycleResource,
    LifecycleManagerState,
} from './types.js'

export {
    DEFAULT_TIMEOUTS,
    createDefaultConfig,
} from './types.js'

// Handlers
export type {
    Signal,
    SignalCallback,
    ErrorCallback,
    CleanupFn,
} from './handlers.js'

export {
    registerSignalHandlers,
    registerExceptionHandlers,
    removeAllHandlers,
    hasSignalHandlers,
    hasExceptionHandlers,
} from './handlers.js'

// Manager
export {
    LifecycleManager,
    getLifecycleManager,
    resetLifecycleManager,
} from './manager.js'
