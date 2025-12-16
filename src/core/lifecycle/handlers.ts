/**
 * Process signal and exception handlers.
 *
 * Registers handlers for graceful shutdown on signals (SIGINT, SIGTERM, SIGHUP)
 * and emergency shutdown on uncaught exceptions.
 */
import { observer } from '../observer.js'


/**
 * Signal types we handle.
 */
export type Signal = 'SIGINT' | 'SIGTERM' | 'SIGHUP'


/**
 * Callback invoked when a shutdown signal is received.
 */
export type SignalCallback = (signal: Signal) => Promise<void>


/**
 * Callback invoked on uncaught exception or unhandled rejection.
 */
export type ErrorCallback = (error: Error, type: 'exception' | 'rejection') => Promise<void>


/**
 * Handler cleanup function.
 */
export type CleanupFn = () => void


/**
 * Active handlers tracking.
 */
interface ActiveHandlers {
    signals: Map<Signal, NodeJS.SignalsListener>
    exception: ((error: Error) => void) | null
    rejection: ((reason: unknown, promise: Promise<unknown>) => void) | null
}


// Track active handlers for cleanup
let activeHandlers: ActiveHandlers = {
    signals: new Map(),
    exception: null,
    rejection: null,
}


/**
 * Register signal handlers for graceful shutdown.
 *
 * @param callback - Called when a signal is received
 * @returns Cleanup function to remove handlers
 *
 * @example
 * ```typescript
 * const cleanup = registerSignalHandlers(async (signal) => {
 *     console.log(`Received ${signal}, shutting down...`)
 *     await gracefulShutdown()
 *     process.exit(0)
 * })
 *
 * // Later: remove handlers
 * cleanup()
 * ```
 */
export function registerSignalHandlers(callback: SignalCallback): CleanupFn {

    const signals: Signal[] = ['SIGINT', 'SIGTERM', 'SIGHUP']

    for (const signal of signals) {

        // Remove existing handler if any
        const existing = activeHandlers.signals.get(signal)
        if (existing) {

            process.removeListener(signal, existing)
        }

        // Create new handler
        const handler: NodeJS.SignalsListener = () => {

            observer.emit('app:signal', { signal })
            void callback(signal)
        }

        process.on(signal, handler)
        activeHandlers.signals.set(signal, handler)
    }

    return () => {

        for (const signal of signals) {

            const handler = activeHandlers.signals.get(signal)
            if (handler) {

                process.removeListener(signal, handler)
                activeHandlers.signals.delete(signal)
            }
        }
    }
}


/**
 * Register exception handlers for emergency shutdown.
 *
 * Handles both uncaughtException and unhandledRejection.
 *
 * @param callback - Called when an error occurs
 * @returns Cleanup function to remove handlers
 *
 * @example
 * ```typescript
 * const cleanup = registerExceptionHandlers(async (error, type) => {
 *     console.error(`${type}: ${error.message}`)
 *     await emergencyShutdown()
 *     process.exit(1)
 * })
 * ```
 */
export function registerExceptionHandlers(callback: ErrorCallback): CleanupFn {

    // Remove existing handlers
    if (activeHandlers.exception) {

        process.removeListener('uncaughtException', activeHandlers.exception)
    }
    if (activeHandlers.rejection) {

        process.removeListener('unhandledRejection', activeHandlers.rejection)
    }

    // Create new handlers
    const exceptionHandler = (error: Error) => {

        observer.emit('app:exception', { error, type: 'exception' })
        void callback(error, 'exception')
    }

    const rejectionHandler = (reason: unknown, _promise: Promise<unknown>) => {

        const error = reason instanceof Error
            ? reason
            : new Error(String(reason))

        observer.emit('app:exception', { error, type: 'rejection' })
        void callback(error, 'rejection')
    }

    process.on('uncaughtException', exceptionHandler)
    process.on('unhandledRejection', rejectionHandler)

    activeHandlers.exception = exceptionHandler
    activeHandlers.rejection = rejectionHandler

    return () => {

        if (activeHandlers.exception) {

            process.removeListener('uncaughtException', activeHandlers.exception)
            activeHandlers.exception = null
        }
        if (activeHandlers.rejection) {

            process.removeListener('unhandledRejection', activeHandlers.rejection)
            activeHandlers.rejection = null
        }
    }
}


/**
 * Remove all registered handlers.
 *
 * Call this to clean up all signal and exception handlers.
 */
export function removeAllHandlers(): void {

    // Remove signal handlers
    for (const [signal, handler] of activeHandlers.signals) {

        process.removeListener(signal, handler)
    }
    activeHandlers.signals.clear()

    // Remove exception handlers
    if (activeHandlers.exception) {

        process.removeListener('uncaughtException', activeHandlers.exception)
        activeHandlers.exception = null
    }
    if (activeHandlers.rejection) {

        process.removeListener('unhandledRejection', activeHandlers.rejection)
        activeHandlers.rejection = null
    }
}


/**
 * Check if signal handlers are registered.
 */
export function hasSignalHandlers(): boolean {

    return activeHandlers.signals.size > 0
}


/**
 * Check if exception handlers are registered.
 */
export function hasExceptionHandlers(): boolean {

    return activeHandlers.exception !== null || activeHandlers.rejection !== null
}
