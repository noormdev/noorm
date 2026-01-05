/**
 * Graceful shutdown context for the TUI.
 *
 * Provides a `gracefulExit` function that ensures all resources (database
 * connections, observers, etc.) are properly cleaned up before the app exits.
 *
 * @example
 * ```tsx
 * // In a component
 * const { gracefulExit } = useShutdown()
 *
 * // Instead of exit() from useApp()
 * gracefulExit()
 * ```
 */
import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, ReactElement } from 'react';
import { useApp, Box } from 'ink';
import { Spinner } from '@inkjs/ui';

import { getLifecycleManager } from '../core/lifecycle/manager.js';
import type { LifecycleManager } from '../core/lifecycle/manager.js';

/**
 * Shutdown context value.
 */
export interface ShutdownContextValue {
    /**
     * Exit the app gracefully, cleaning up all resources.
     *
     * This should be used instead of Ink's `exit()` to ensure
     * database connections and other resources are properly closed.
     */
    gracefulExit: () => Promise<void>;

    /**
     * Whether shutdown is in progress.
     */
    isShuttingDown: boolean;
}

const ShutdownContext = createContext<ShutdownContextValue | null>(null);

/**
 * Shutdown screen component.
 *
 * Displays a clean, minimal screen during graceful shutdown.
 * This replaces the full TUI to prevent terminal corruption.
 */
function ShutdownScreen(): ReactElement {

    return (
        <Box flexDirection="column" padding={1}>
            <Box>
                <Spinner label="Gracefully shutting down..." />
            </Box>
        </Box>
    );

}

/**
 * Props for ShutdownProvider.
 */
export interface ShutdownProviderProps {
    /** Child components */
    children: ReactNode;

    /** Project root directory */
    projectRoot: string;
}

/**
 * Provider for graceful shutdown functionality.
 *
 * Must wrap the app to enable graceful exit. Initializes the
 * LifecycleManager and provides the `gracefulExit` function.
 *
 * @example
 * ```tsx
 * <ShutdownProvider projectRoot={process.cwd()}>
 *     <App />
 * </ShutdownProvider>
 * ```
 */
export function ShutdownProvider({ children, projectRoot }: ShutdownProviderProps): ReactElement {

    const { exit } = useApp();
    const lifecycleRef = useRef<LifecycleManager | null>(null);
    const isShuttingDownRef = useRef(false);
    const isReadyRef = useRef(false);
    const [isShuttingDown, setIsShuttingDown] = useState(false);

    // Initialize lifecycle manager on mount
    useEffect(() => {

        const lifecycle = getLifecycleManager(projectRoot, { mode: 'tui' });
        lifecycleRef.current = lifecycle;

        // Start lifecycle (registers signal handlers, etc.)
        lifecycle
            .start()
            .then(() => {

                isReadyRef.current = true;

                if (process.env['NOORM_DEBUG']) {

                    console.error(
                        '[ShutdownProvider] LifecycleManager started, state:',
                        lifecycle.state,
                    );

                }

            })
            .catch((err) => {

                console.error('Failed to start lifecycle manager:', err);

            });

        // Cleanup on unmount - this runs when Ink exits
        return () => {

            if (lifecycleRef.current && !isShuttingDownRef.current) {

                // Perform shutdown if not already done
                lifecycleRef.current.shutdown('programmatic').catch(() => {
                    // Ignore errors during cleanup
                });

            }

        };

    }, [projectRoot]);

    const gracefulExit = useCallback(async () => {

        if (isShuttingDownRef.current) {

            // Already shutting down
            return;

        }

        isShuttingDownRef.current = true;

        // Show shutdown screen immediately before any cleanup
        setIsShuttingDown(true);

        // Wait a tick for React to re-render the shutdown screen
        // This ensures the TUI shows "shutting down" before any console output
        await new Promise((resolve) => setTimeout(resolve, 50));

        if (process.env['NOORM_DEBUG']) {

            console.error(
                '[ShutdownProvider] gracefulExit called, lifecycle state:',
                lifecycleRef.current?.state,
                'ready:',
                isReadyRef.current,
            );

        }

        // Wait for lifecycle to be ready (should be almost instant)
        let waitAttempts = 0;
        while (!isReadyRef.current && waitAttempts < 50) {

            await new Promise((resolve) => setTimeout(resolve, 10));
            waitAttempts++;

        }

        // Perform graceful shutdown
        if (lifecycleRef.current) {

            await lifecycleRef.current.shutdown('user');

            if (process.env['NOORM_DEBUG']) {

                console.error('[ShutdownProvider] shutdown complete, calling exit()');

            }

        }

        // Then tell Ink to exit
        exit();

    }, [exit]);

    const value: ShutdownContextValue = {
        gracefulExit,
        isShuttingDown,
    };

    // Render shutdown screen when shutting down, otherwise render children
    return (
        <ShutdownContext.Provider value={value}>
            {isShuttingDown ? <ShutdownScreen /> : children}
        </ShutdownContext.Provider>
    );

}

/**
 * Hook to access graceful shutdown functionality.
 *
 * Use `gracefulExit()` instead of Ink's `exit()` to ensure
 * all resources are properly cleaned up.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *     const { gracefulExit } = useShutdown()
 *
 *     useInput((input) => {
 *         if (input === 'q') {
 *             gracefulExit()
 *         }
 *     })
 * }
 * ```
 */
export function useShutdown(): ShutdownContextValue {

    const context = useContext(ShutdownContext);

    if (!context) {

        throw new Error('useShutdown must be used within a ShutdownProvider');

    }

    return context;

}

/**
 * Hook that provides a quit handler using graceful exit.
 *
 * Convenience hook that returns a `handleQuit` function
 * using graceful shutdown.
 *
 * @example
 * ```tsx
 * const { handleQuit } = useGracefulQuit()
 *
 * useInput((input) => {
 *     if (input === 'q') handleQuit()
 * })
 * ```
 */
export function useGracefulQuit(): { handleQuit: () => void } {

    const { gracefulExit } = useShutdown();

    const handleQuit = useCallback(() => {

        gracefulExit();

    }, [gracefulExit]);

    return { handleQuit };

}
