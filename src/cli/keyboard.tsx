/**
 * Global keyboard handler for consistent hotkeys.
 *
 * Handles universal keys (Esc, Ctrl+C, ?) that work across all screens,
 * while respecting the focus stack for input routing.
 *
 * @example
 * ```tsx
 * <FocusProvider>
 *     <RouterProvider>
 *         <GlobalKeyboard>
 *             <App />
 *         </GlobalKeyboard>
 *     </RouterProvider>
 * </FocusProvider>
 * ```
 */
import { useInput } from 'ink';
import { useCallback, useState } from 'react';

import type { ReactNode, ReactElement } from 'react';

import { useFocusContext } from './focus.js';
import { useShutdown } from './shutdown.js';

/**
 * Props for GlobalKeyboard component.
 */
export interface GlobalKeyboardProps {
    /** Child components */
    children: ReactNode;

    /**
     * Callback when help overlay should be shown.
     * The parent component handles rendering the overlay.
     */
    onHelp?: () => void;

    /**
     * Callback when Esc is pressed and no focus handling occurred.
     * Allows parent to implement ESC cascade behavior.
     */
    onEscape?: () => boolean | void;

    /**
     * Callback when dry-run mode should be toggled.
     * Triggered by 'D' (uppercase) key.
     */
    onToggleDryRun?: () => void;

    /**
     * Callback when force mode should be toggled.
     * Triggered by 'F' (uppercase) key.
     */
    onToggleForce?: () => void;

    /**
     * Callback when log viewer should be toggled.
     * Triggered by Shift+L from anywhere.
     */
    onToggleLogViewer?: () => void;

    /**
     * Callback when SQL terminal should be opened.
     * Triggered by Shift+Q from anywhere.
     */
    onOpenSqlTerminal?: () => void;
}

/**
 * Global keyboard handler component.
 *
 * Wraps the app and handles:
 * - Ctrl+C: Exit application
 * - ?: Show help overlay (when not in text input)
 * - D: Toggle dry-run mode (when not in text input)
 * - F: Toggle force mode (when not in text input)
 * - Esc: Navigate back (when nothing else handles it)
 *
 * Individual screens/components register their own handlers
 * via useInput with focus-aware filtering.
 */
export function GlobalKeyboard({
    children,
    onHelp,
    onEscape,
    onToggleDryRun,
    onToggleForce,
    onToggleLogViewer,
    onOpenSqlTerminal,
}: GlobalKeyboardProps): ReactElement {

    const { gracefulExit } = useShutdown();
    const { stack } = useFocusContext();

    useInput((input, key) => {

        // Ctrl+C always exits gracefully
        if (key.ctrl && input === 'c') {

            gracefulExit();

            return;

        }

        // Shift+L toggles log viewer (works from anywhere, even in text input)
        if (key.shift && input === 'L') {

            onToggleLogViewer?.();

            return;

        }

        // Shift+Q opens SQL terminal (works from anywhere)
        if (key.shift && input === 'Q') {

            onOpenSqlTerminal?.();

            return;

        }

        // Global keys only work when not typing in a text input
        // (focus stack > 1 means we're likely in an input component)
        if (stack.length <= 1) {

            // ? shows help
            if (input === '?') {

                onHelp?.();

                return;

            }

            // D toggles dry-run mode
            if (input === 'D') {

                onToggleDryRun?.();

                return;

            }

            // F toggles force mode
            if (input === 'F') {

                onToggleForce?.();

                return;

            }

        }

        // Note: ESC is NOT handled here globally.
        // Individual screens handle ESC via their own useInput handlers.
        // Having a global ESC handler causes double-back issues since
        // both the screen handler and global handler would fire.
        // The onEscape callback is kept for special cases where the
        // parent needs to be notified.
        if (key.escape && onEscape) {

            onEscape();

        }

    });

    return <>{children}</>;

}

/**
 * Hook to create a keyboard handler that only fires when focused.
 *
 * Wraps Ink's useInput to integrate with the focus stack.
 *
 * @example
 * ```typescript
 * function ConfigList() {
 *     const { isFocused } = useFocusScope('config-list')
 *
 *     useFocusedInput(isFocused, (input, key) => {
 *         if (input === 'a') navigate('config/add')
 *         if (input === 'e') navigate('config/edit', { name: selectedConfig })
 *     })
 * }
 * ```
 */
export function useFocusedInput(
    isFocused: boolean,
    handler: (input: string, key: Parameters<Parameters<typeof useInput>[0]>[1]) => void,
): void {

    useInput(
        useCallback(
            (input, key) => {

                if (isFocused) {

                    handler(input, key);

                }

            },
            [isFocused, handler],
        ),
    );

}

/**
 * Hook for common list navigation keys.
 *
 * Returns handlers for up/down navigation with wrapping.
 *
 * @example
 * ```typescript
 * const { handleKey, selectedIndex, setSelectedIndex } = useListKeys({
 *     items: configs,
 *     isFocused,
 *     onSelect: (config) => navigate('config/edit', { name: config.name })
 * })
 * ```
 */
export interface UseListKeysOptions<T> {
    /** Array of items to navigate */
    items: T[];

    /** Whether this list has focus */
    isFocused: boolean;

    /** Callback when Enter is pressed on selected item */
    onSelect?: (item: T, index: number) => void;

    /** Initial selected index */
    initialIndex?: number;
}

export interface UseListKeysResult {
    /** Currently selected index */
    selectedIndex: number;

    /** Set selected index manually */
    setSelectedIndex: (index: number) => void;

    /** Move selection up */
    selectPrevious: () => void;

    /** Move selection down */
    selectNext: () => void;
}

export function useListKeys<T>({
    items,
    isFocused,
    onSelect,
    initialIndex = 0,
}: UseListKeysOptions<T>): UseListKeysResult {

    const [selectedIndex, setSelectedIndex] = useState(initialIndex);

    const selectPrevious = useCallback(() => {

        setSelectedIndex((current) => {

            if (items.length === 0) return 0;

            return current > 0 ? current - 1 : items.length - 1;

        });

    }, [items.length]);

    const selectNext = useCallback(() => {

        setSelectedIndex((current) => {

            if (items.length === 0) return 0;

            return current < items.length - 1 ? current + 1 : 0;

        });

    }, [items.length]);

    useFocusedInput(isFocused, (input, key) => {

        if (key.upArrow) {

            selectPrevious();

        }
        else if (key.downArrow) {

            selectNext();

        }
        else if (key.return && items[selectedIndex]) {

            onSelect?.(items[selectedIndex], selectedIndex);

        }

    });

    return {
        selectedIndex,
        setSelectedIndex,
        selectPrevious,
        selectNext,
    };

}

/**
 * Hook to handle quit confirmation from home screen.
 *
 * Uses graceful shutdown to ensure all resources are cleaned up.
 *
 * @example
 * ```typescript
 * const { handleQuit } = useQuitHandler()
 *
 * useFocusedInput(isFocused, (input) => {
 *     if (input === 'q') handleQuit()
 * })
 * ```
 */
export function useQuitHandler(): { handleQuit: () => void } {

    const { gracefulExit } = useShutdown();

    const handleQuit = useCallback(() => {

        gracefulExit();

    }, [gracefulExit]);

    return { handleQuit };

}
