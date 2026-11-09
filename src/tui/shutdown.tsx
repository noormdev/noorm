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
import { useInput, Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { attempt } from '@logosdx/utils';

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
function ShutdownScreen({ onForceExit }: { onForceExit: () => void }): ReactElement {

    const [currentPhase, setCurrentPhase] = useState<string>('stopping');
    const [completedPhases, setCompletedPhases] = useState<Set<string>>(new Set());
    const [timedOutPhases, setTimedOutPhases] = useState<Set<string>>(new Set());

    useInput((input, key) => {

        if (key.ctrl && input === 'c') onForceExit();

    });

    useEffect(() => {

        const cleanup = observer.on('app:shutdown:phase', (data) => {

            if (data.status === 'running') {

                setCurrentPhase(data.phase);

            }
            else if (data.status === 'completed') {

                setCompletedPhases((prev) => new Set([...prev, data.phase]));

            }
            else if (data.status === 'timeout') {

                setTimedOutPhases((prev) => new Set([...prev, data.phase]));

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
                const timedOut = timedOutPhases.has(key);
                const isActive = currentPhase === key && !isDone && !timedOut;

                return (
                    <Box key={key} gap={1}>
                        {isDone && <Text color="green">✓</Text>}
                        {timedOut && <Text color="yellow">!</Text>}
                        {isActive && <Spinner />}
                        {!isDone && !isActive && !timedOut && <Text dimColor> </Text>}
                        <Text dimColor={!isActive && !isDone && !timedOut} color={timedOut ? 'yellow' : isDone ? 'green' : undefined}>
                            {label}{timedOut ? ' (timed out)' : ''}
                        </Text>
                    </Box>
                );

            })}
            {timedOutPhases.size > 0 && (
                <Box marginTop={1}>
                    <Text color="yellow">Shutdown incomplete. Running SQL or transaction cleanup may not have settled.</Text>
                </Box>
            )}
            <Box marginTop={1}>
                <Text dimColor>Ctrl+C again forces exit. Running SQL may continue.</Text>
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

    const exitEmittedRef = useRef(false);
    const lifecycleRef = useRef<LifecycleManager | null>(null);
    const isShuttingDownRef = useRef(false);
    const isReadyRef = useRef(false);
    const incompleteRef = useRef(false);

    const emitExit = useCallback((code: number) => {

        if (exitEmittedRef.current) return;
        exitEmittedRef.current = true;
        observer.emit('app:exit', { code });

    }, []);
    const [isShuttingDown, setIsShuttingDown] = useState(false);

    // Initialize lifecycle manager on mount
    useEffect(() => {

        const unsubscribePhase = observer.on('app:shutdown:phase', (event) => {

            if (event.status === 'timeout') incompleteRef.current = true;

        });

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

            unsubscribePhase();

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

            // Force does not establish that SQL or transaction cleanup settled.
            emitExit(1);

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

        const lifecycle = lifecycleRef.current;
        if (lifecycle && isReadyRef.current) {

            const [, shutdownError] = await attempt(() => lifecycle.shutdown('user'));
            if (shutdownError) incompleteRef.current = true;

        }
        else {

            incompleteRef.current = true;

        }

        // The CLI clears Ink before unmounting and preserves this exit code.
        emitExit(incompleteRef.current ? 1 : lifecycleRef.current?.exitCode ?? 1);

    }, [emitExit]);

    const value: ShutdownContextValue = {
        gracefulExit,
        isShuttingDown,
    };

    // Render shutdown screen when shutting down, otherwise render children
    return (
        <ShutdownContext.Provider value={value}>
            {isShuttingDown ? <ShutdownScreen onForceExit={() => {

                void gracefulExit();

            }} /> : children}
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
