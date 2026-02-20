/**
 * Graceful shutdown context for the TUI.
 *
 * Provides a `gracefulExit` function that ensures all resources (database
 * connections, observers, etc.) are properly cleaned up before the app exits.
 * Shows a full-screen shutdown modal with phase progress while resources
 * are being released.
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
import { useApp, Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';

import { getLifecycleManager } from '../core/lifecycle/manager.js';
import type { LifecycleManager } from '../core/lifecycle/manager.js';
import { observer } from '../core/observer.js';

/**
 * Phase labels shown during shutdown.
 */
const PHASE_LABELS: Record<string, string> = {
    stopping: 'Stopping operations',
    completing: 'Completing tasks',
    releasing: 'Releasing connections',
    flushing: 'Flushing logs',
};

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
 * Full-screen modal showing shutdown progress with phase indicators.
 * Replaces the entire TUI during graceful shutdown.
 */
function ShutdownScreen(): ReactElement {

    const [currentPhase, setCurrentPhase] = useState<string>('stopping');
    const [completedPhases, setCompletedPhases] = useState<Set<string>>(new Set());

    useEffect(() => {

        const cleanup = observer.on('app:shutdown:phase', (data) => {

            if (data.status === 'running') {

                setCurrentPhase(data.phase);

            }
            else if (data.status === 'completed' || data.status === 'timeout') {

                setCompletedPhases((prev) => new Set([...prev, data.phase]));

            }

        });

        return cleanup;

    }, []);

    const phases = Object.entries(PHASE_LABELS);

    return (
        <Box flexDirection="column" paddingX={2} paddingY={1}>
            <Box marginBottom={1}>
                <Text bold>Shutting down</Text>
            </Box>
            {phases.map(([key, label]) => {

                const isDone = completedPhases.has(key);
                const isActive = currentPhase === key && !isDone;

                return (
                    <Box key={key} gap={1}>
                        {isDone && <Text color="green">✓</Text>}
                        {isActive && <Spinner />}
                        {!isDone && !isActive && <Text dimColor> </Text>}
                        <Text dimColor={!isActive && !isDone} color={isDone ? 'green' : undefined}>
                            {label}
                        </Text>
                    </Box>
                );

            })}
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
 * With exitOnCtrlC: false, Ctrl+C is handled by GlobalKeyboard
 * which calls gracefulExit(), showing the shutdown screen while
 * resources are released.
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

            // Already shutting down — force exit on second attempt
            exit();

            return;

        }

        isShuttingDownRef.current = true;

        // Show shutdown screen immediately before any cleanup
        setIsShuttingDown(true);

        // Wait a tick for React to render the shutdown screen
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Wait for lifecycle to be ready (should be almost instant)
        let waitAttempts = 0;
        while (!isReadyRef.current && waitAttempts < 50) {

            await new Promise((resolve) => setTimeout(resolve, 10));
            waitAttempts++;

        }

        // Perform graceful shutdown
        if (lifecycleRef.current) {

            await lifecycleRef.current.shutdown('user');

        }

        // Signal index.tsx to clear output and unmount Ink.
        // We emit an event instead of calling exit() directly so the
        // render instance can call clear() before unmount(), preventing
        // the shutdown screen from lingering in the terminal.
        observer.emit('app:exit', { code: 0 });

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
