/**
 * Lifecycle Manager.
 *
 * Coordinates application startup and shutdown, ensuring all subsystems
 * are properly initialized and cleaned up. Handles graceful shutdown
 * on signals and emergency shutdown on fatal errors.
 *
 * @example
 * ```typescript
 * const lifecycle = new LifecycleManager({
 *     projectRoot: process.cwd(),
 *     mode: 'tui',
 *     timeouts: DEFAULT_TIMEOUTS,
 *     registerSignalHandlers: true,
 * })
 *
 * await lifecycle.start()
 * // App is now running...
 *
 * // On exit:
 * await lifecycle.shutdown('user')
 * ```
 */
import { attempt } from '@logosdx/utils'

import { observer } from '../observer.js'
import { getConnectionManager } from '../connection/manager.js'
import type {
    LifecycleConfig,
    LifecycleState,
    LifecycleResource,
    ShutdownPhase,
    ShutdownReason,
    LifecycleManagerState,
    AppMode,
    PhaseStatus,
} from './types.js'
import { createDefaultConfig, DEFAULT_TIMEOUTS } from './types.js'
import {
    registerSignalHandlers,
    registerExceptionHandlers,
    removeAllHandlers,
    type Signal,
} from './handlers.js'


/**
 * Shutdown phase order.
 */
const SHUTDOWN_PHASES: ShutdownPhase[] = [
    'stopping',
    'completing',
    'releasing',
    'flushing',
    'exiting',
]


/**
 * Manages application lifecycle including startup and shutdown.
 */
export class LifecycleManager {

    #config: LifecycleConfig
    #state: LifecycleState = 'idle'
    #startedAt: Date | null = null
    #shuttingDownAt: Date | null = null
    #shutdownReason: ShutdownReason | null = null
    #exitCode = 0
    #resources = new Map<string, LifecycleResource>()
    #signalCleanup: (() => void) | null = null
    #exceptionCleanup: (() => void) | null = null
    #shutdownPromise: Promise<void> | null = null

    /**
     * Create a new LifecycleManager.
     *
     * @param config - Configuration options
     */
    constructor(config: Partial<LifecycleConfig> & { projectRoot: string }) {

        const defaults = createDefaultConfig(config.projectRoot)
        this.#config = {
            ...defaults,
            ...config,
            timeouts: { ...defaults.timeouts, ...config.timeouts },
        }
    }

    /**
     * Current lifecycle state.
     */
    get state(): LifecycleState {

        return this.#state
    }

    /**
     * Application mode (tui or headless).
     */
    get mode(): AppMode {

        return this.#config.mode
    }

    /**
     * When the application started.
     */
    get startedAt(): Date | null {

        return this.#startedAt
    }

    /**
     * Exit code that will be used on shutdown.
     */
    get exitCode(): number {

        return this.#exitCode
    }

    /**
     * Check if running.
     */
    get isRunning(): boolean {

        return this.#state === 'running'
    }

    /**
     * Check if shutting down.
     */
    get isShuttingDown(): boolean {

        return this.#state === 'shutting_down'
    }

    /**
     * Get full manager state.
     */
    getState(): LifecycleManagerState {

        return {
            state: this.#state,
            mode: this.#config.mode,
            startedAt: this.#startedAt ?? undefined,
            shuttingDownAt: this.#shuttingDownAt ?? undefined,
            shutdownReason: this.#shutdownReason ?? undefined,
            exitCode: this.#exitCode,
        }
    }

    /**
     * Register a resource for cleanup during shutdown.
     *
     * @param resource - Resource to register
     *
     * @example
     * ```typescript
     * lifecycle.registerResource({
     *     name: 'database',
     *     phase: 'releasing',
     *     cleanup: async () => connectionManager.closeAll(),
     * })
     * ```
     */
    registerResource(resource: LifecycleResource): void {

        this.#resources.set(resource.name, {
            ...resource,
            priority: resource.priority ?? 0,
        })
    }

    /**
     * Unregister a resource.
     */
    unregisterResource(name: string): boolean {

        return this.#resources.delete(name)
    }

    /**
     * Start the application lifecycle.
     *
     * Registers signal handlers and transitions to running state.
     *
     * @throws If already started or in invalid state
     */
    async start(): Promise<void> {

        if (this.#state !== 'idle') {

            throw new Error(`Cannot start from state: ${this.#state}`)
        }

        this.#state = 'starting'
        observer.emit('app:starting', { mode: this.#config.mode })

        // Register signal handlers
        if (this.#config.registerSignalHandlers) {

            this.#signalCleanup = registerSignalHandlers(
                async (signal: Signal) => this.#handleSignal(signal)
            )

            this.#exceptionCleanup = registerExceptionHandlers(
                async (error: Error, type: 'exception' | 'rejection') => {

                    await this.#handleFatalError(error, type)
                }
            )
        }

        // Register default resources
        this.#registerDefaultResources()

        this.#state = 'running'
        this.#startedAt = new Date()

        observer.emit('app:ready', {
            mode: this.#config.mode,
            startedAt: this.#startedAt,
        })
    }

    /**
     * Initiate graceful shutdown.
     *
     * @param reason - Why shutdown was initiated
     * @param exitCode - Exit code to use (default 0)
     * @returns Promise that resolves when shutdown is complete
     */
    async shutdown(reason: ShutdownReason = 'programmatic', exitCode = 0): Promise<void> {

        // Prevent multiple concurrent shutdowns
        if (this.#shutdownPromise) {

            return this.#shutdownPromise
        }

        if (this.#state !== 'running') {

            return
        }

        this.#shutdownPromise = this.#performShutdown(reason, exitCode)
        return this.#shutdownPromise
    }

    /**
     * Set exit code without triggering shutdown.
     */
    setExitCode(code: number): void {

        this.#exitCode = code
    }

    /**
     * Internal shutdown implementation.
     */
    async #performShutdown(reason: ShutdownReason, exitCode: number): Promise<void> {

        this.#state = 'shutting_down'
        this.#shuttingDownAt = new Date()
        this.#shutdownReason = reason
        this.#exitCode = exitCode

        observer.emit('app:shutdown', { reason, exitCode })

        // Execute each phase in order
        for (const phase of SHUTDOWN_PHASES) {

            if (phase === 'exiting') {

                // Skip exiting phase in shutdown - handled by caller
                continue
            }

            const [, err] = await attempt(() => this.#executePhase(phase))
            if (err) {

                observer.emit('app:shutdown:phase', {
                    phase,
                    status: 'timeout' as PhaseStatus,
                    error: err,
                })
            }
        }

        // Remove signal handlers
        this.#cleanup()

        this.#state = 'stopped'

        observer.emit('app:exit', { code: this.#exitCode })
    }

    /**
     * Execute a single shutdown phase.
     */
    async #executePhase(phase: ShutdownPhase): Promise<void> {

        observer.emit('app:shutdown:phase', {
            phase,
            status: 'running' as PhaseStatus,
        })

        const start = Date.now()

        // Get resources for this phase, sorted by priority
        const resources = Array.from(this.#resources.values())
            .filter(r => r.phase === phase)
            .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))

        // Get timeout for this phase
        const timeout = this.#getPhaseTimeout(phase)

        // Execute all resources with timeout
        const [, err] = await attempt(() =>
            this.#executeWithTimeout(
                () => this.#executePhaseResources(resources),
                timeout
            )
        )

        const durationMs = Date.now() - start
        const status: PhaseStatus = err ? 'timeout' : 'completed'

        observer.emit('app:shutdown:phase', {
            phase,
            status,
            durationMs,
            error: err ?? undefined,
        })
    }

    /**
     * Execute resources for a phase.
     */
    async #executePhaseResources(resources: LifecycleResource[]): Promise<void> {

        for (const resource of resources) {

            const [, err] = await attempt(() => resource.cleanup())
            if (err) {

                observer.emit('error', {
                    source: 'lifecycle',
                    error: err,
                    context: { resource: resource.name },
                })
            }
        }
    }

    /**
     * Execute a function with a timeout.
     */
    async #executeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {

        return new Promise((resolve, reject) => {

            const timer = setTimeout(() => {

                reject(new Error(`Timeout after ${timeoutMs}ms`))
            }, timeoutMs)

            fn()
                .then(result => {

                    clearTimeout(timer)
                    resolve(result)
                })
                .catch(error => {

                    clearTimeout(timer)
                    reject(error)
                })
        })
    }

    /**
     * Get timeout for a phase.
     */
    #getPhaseTimeout(phase: ShutdownPhase): number {

        switch (phase) {

            case 'stopping':
                return 1000 // 1 second
            case 'completing':
                return this.#config.timeouts.operations
            case 'releasing':
                return Math.max(
                    this.#config.timeouts.locks,
                    this.#config.timeouts.connections
                )
            case 'flushing':
                return this.#config.timeouts.logger
            case 'exiting':
                return 1000 // 1 second
            default:
                return 5000
        }
    }

    /**
     * Handle shutdown signal.
     */
    async #handleSignal(signal: Signal): Promise<void> {

        if (this.#state === 'shutting_down') {

            // Second signal - force exit
            observer.emit('app:fatal', {
                error: new Error(`Forced exit on second ${signal}`),
            })
            process.exit(128 + this.#getSignalCode(signal))
        }

        await this.shutdown('signal', 0)
    }

    /**
     * Handle fatal error (uncaught exception / unhandled rejection).
     */
    async #handleFatalError(error: Error, type: 'exception' | 'rejection'): Promise<void> {

        observer.emit('app:fatal', { error, type })

        // Try to do minimal cleanup
        this.#cleanup()

        this.#state = 'failed'
        this.#exitCode = 1

        // Don't await full shutdown - just exit
        observer.emit('app:exit', { code: 1 })
    }

    /**
     * Get signal code for exit status.
     */
    #getSignalCode(signal: Signal): number {

        switch (signal) {

            case 'SIGINT':
                return 2
            case 'SIGTERM':
                return 15
            case 'SIGHUP':
                return 1
            default:
                return 0
        }
    }

    /**
     * Register default resources.
     */
    #registerDefaultResources(): void {

        // Connection cleanup
        this.registerResource({
            name: 'connections',
            phase: 'releasing',
            priority: 10,
            cleanup: async () => {

                const manager = getConnectionManager()
                await manager.closeAll()
            },
        })
    }

    /**
     * Cleanup handlers.
     */
    #cleanup(): void {

        if (this.#signalCleanup) {

            this.#signalCleanup()
            this.#signalCleanup = null
        }

        if (this.#exceptionCleanup) {

            this.#exceptionCleanup()
            this.#exceptionCleanup = null
        }
    }
}


// Singleton instance
let instance: LifecycleManager | null = null


/**
 * Get the global LifecycleManager instance.
 *
 * Creates one if it doesn't exist.
 *
 * @param projectRoot - Project root directory (required on first call)
 * @param config - Optional configuration overrides
 *
 * @example
 * ```typescript
 * const lifecycle = getLifecycleManager(process.cwd())
 * await lifecycle.start()
 * ```
 */
export function getLifecycleManager(
    projectRoot?: string,
    config?: Partial<Omit<LifecycleConfig, 'projectRoot'>>
): LifecycleManager {

    if (!instance) {

        if (!projectRoot) {

            throw new Error('projectRoot is required when creating LifecycleManager')
        }

        instance = new LifecycleManager({
            projectRoot,
            ...config,
        })
    }

    return instance
}


/**
 * Reset the global LifecycleManager.
 *
 * Shuts down if running, then clears the instance.
 * Primarily for testing.
 *
 * @example
 * ```typescript
 * afterEach(async () => {
 *     await resetLifecycleManager()
 * })
 * ```
 */
export async function resetLifecycleManager(): Promise<void> {

    if (instance) {

        if (instance.isRunning) {

            await instance.shutdown('programmatic')
        }

        removeAllHandlers()
        instance = null
    }
}
