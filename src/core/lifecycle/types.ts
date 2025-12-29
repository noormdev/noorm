/**
 * Lifecycle type definitions.
 *
 * Types for managing application startup, shutdown, and lifecycle events.
 */

/**
 * Application lifecycle states.
 *
 * - `idle`: Not yet started
 * - `starting`: Initialization in progress
 * - `running`: Application is running normally
 * - `shutting_down`: Shutdown in progress
 * - `stopped`: Clean shutdown completed
 * - `failed`: Startup or shutdown failed
 */
export type LifecycleState =
    | 'idle'
    | 'starting'
    | 'running'
    | 'shutting_down'
    | 'stopped'
    | 'failed';

/**
 * Shutdown phases in order of execution.
 *
 * Each phase has a specific purpose in the graceful shutdown sequence.
 */
export type ShutdownPhase =
    | 'stopping' // Stop accepting new work
    | 'completing' // Wait for in-flight work
    | 'releasing' // Release locks, close connections
    | 'flushing' // Flush pending writes
    | 'exiting'; // Exit the process

/**
 * Shutdown phase status.
 */
export type PhaseStatus = 'pending' | 'running' | 'completed' | 'timeout' | 'skipped';

/**
 * Reasons for shutdown.
 */
export type ShutdownReason =
    | 'signal' // SIGINT, SIGTERM, SIGHUP
    | 'user' // User requested quit
    | 'error' // Fatal error
    | 'programmatic'; // Code called shutdown

/**
 * Application mode.
 */
export type AppMode = 'tui' | 'headless';

/**
 * Timeout configuration for shutdown phases.
 *
 * All values in milliseconds.
 */
export interface ShutdownTimeouts {
    /** Time to wait for in-flight operations */
    operations: number;
    /** Time to wait for lock release */
    locks: number;
    /** Time to wait for connection close */
    connections: number;
    /** Time to wait for logger flush */
    logger: number;
}

/**
 * Lifecycle manager configuration.
 */
export interface LifecycleConfig {
    /** Project root directory */
    projectRoot: string;
    /** Application mode */
    mode: AppMode;
    /** Shutdown phase timeouts */
    timeouts: ShutdownTimeouts;
    /** Whether to register process signal handlers */
    registerSignalHandlers: boolean;
}

/**
 * Default timeout configuration.
 */
export const DEFAULT_TIMEOUTS: ShutdownTimeouts = {
    operations: 30000, // 30 seconds
    locks: 5000, // 5 seconds
    connections: 10000, // 10 seconds
    logger: 10000, // 10 seconds
};

/**
 * Default lifecycle configuration factory.
 *
 * Requires projectRoot to be specified.
 */
export function createDefaultConfig(projectRoot: string): LifecycleConfig {

    return {
        projectRoot,
        mode: 'tui',
        timeouts: { ...DEFAULT_TIMEOUTS },
        registerSignalHandlers: true,
    };

}

/**
 * Shutdown phase information.
 */
export interface ShutdownPhaseInfo {
    phase: ShutdownPhase;
    status: PhaseStatus;
    durationMs?: number;
    error?: Error;
}

/**
 * Resource to be cleaned up during shutdown.
 *
 * @example
 * ```typescript
 * lifecycle.registerResource({
 *     name: 'database',
 *     phase: 'releasing',
 *     cleanup: async () => manager.closeAll(),
 * })
 * ```
 */
export interface LifecycleResource {
    /** Unique resource name */
    name: string;
    /** Shutdown phase when this resource should be cleaned up */
    phase: ShutdownPhase;
    /** Cleanup function */
    cleanup: () => Promise<void>;
    /** Priority within phase (lower = earlier, default 0) */
    priority?: number;
}

/**
 * Lifecycle manager state.
 */
export interface LifecycleManagerState {
    state: LifecycleState;
    mode: AppMode;
    startedAt?: Date;
    shuttingDownAt?: Date;
    shutdownReason?: ShutdownReason;
    exitCode: number;
}
