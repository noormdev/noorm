/**
 * Focus stack system for keyboard input management.
 *
 * Keyboard input flows through a focus stack - only the topmost component
 * receives input. This prevents parent screens from intercepting keys
 * meant for child components like modals or text inputs.
 *
 * @example
 * ```typescript
 * // In a screen component
 * const { push, pop, isActive } = useFocus()
 * const id = useId()
 *
 * useEffect(() => {
 *     push(id, 'MyScreen')
 *     return () => pop(id)
 * }, [])
 *
 * // Only handle input when focused
 * useInput((input, key) => {
 *     if (!isActive(id)) return
 *     // handle input...
 * })
 * ```
 */
import { createContext, useContext, useState, useCallback, useMemo, useId, useEffect } from 'react';

import type { ReactNode, ReactElement } from 'react';

import type { FocusEntry, FocusContextValue } from './types.js';

const FocusContext = createContext<FocusContextValue | null>(null);

/**
 * Props for FocusProvider.
 */
export interface FocusProviderProps {
    children: ReactNode;
}

/**
 * Focus provider component.
 *
 * Manages the focus stack for keyboard input routing.
 * Components push/pop focus claims to control input flow.
 *
 * @example
 * ```tsx
 * <FocusProvider>
 *     <RouterProvider>
 *         <App />
 *     </RouterProvider>
 * </FocusProvider>
 * ```
 */
export function FocusProvider({ children }: FocusProviderProps): ReactElement {

    const [stack, setStack] = useState<FocusEntry[]>([]);

    const push = useCallback((id: string, label?: string) => {

        setStack((prev) => {

            // Don't add duplicates
            if (prev.some((entry) => entry.id === id)) {

                return prev;

            }

            return [...prev, { id, label }];

        });

    }, []);

    const pop = useCallback((id: string) => {

        setStack((prev) => {

            // Only remove if this ID is in the stack
            const index = prev.findIndex((entry) => entry.id === id);

            if (index === -1) {

                return prev;

            }

            // Remove from wherever it is in the stack
            return [...prev.slice(0, index), ...prev.slice(index + 1)];

        });

    }, []);

    const isActive = useCallback(
        (id: string): boolean => {

            if (stack.length === 0) {

                return false;

            }

            return stack[stack.length - 1]!.id === id;

        },
        [stack],
    );

    const activeId = useMemo(() => {

        if (stack.length === 0) {

            return null;

        }

        return stack[stack.length - 1]!.id;

    }, [stack]);

    const value = useMemo<FocusContextValue>(
        () => ({
            push,
            pop,
            isActive,
            activeId,
            stack,
        }),
        [push, pop, isActive, activeId, stack],
    );

    return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;

}

/**
 * Hook to access focus stack functionality.
 *
 * Must be used within a FocusProvider.
 *
 * @example
 * ```typescript
 * const { push, pop, isActive } = useFocus()
 * ```
 */
export function useFocusContext(): FocusContextValue {

    const context = useContext(FocusContext);

    if (!context) {

        throw new Error('useFocusContext must be used within a FocusProvider');

    }

    return context;

}

/**
 * Options for useFocusScope.
 */
export interface UseFocusScopeOptions {
    /** Label for debugging */
    label?: string;

    /** Skip registering with focus stack (use when parent manages focus) */
    skip?: boolean;
}

/**
 * Hook to manage focus for a component with automatic cleanup.
 *
 * Automatically pushes focus on mount and pops on unmount.
 * Returns whether this component is currently focused.
 *
 * @example
 * ```typescript
 * function MyModal() {
 *     const { isFocused, focusId } = useFocusScope('my-modal')
 *
 *     useInput((input, key) => {
 *         if (!isFocused) return
 *         // handle input...
 *     })
 *
 *     return <Box>...</Box>
 * }
 * ```
 */
export function useFocusScope(labelOrOptions?: string | UseFocusScopeOptions): {
    isFocused: boolean;
    focusId: string;
} {

    const options =
        typeof labelOrOptions === 'string' ? { label: labelOrOptions } : (labelOrOptions ?? {});

    const { label, skip = false } = options;

    const { push, pop, isActive } = useFocusContext();
    const focusId = useId();

    useEffect(() => {

        if (skip) return;

        push(focusId, label);

        return () => {

            pop(focusId);

        };

    }, [focusId, label, push, pop, skip]);

    return {
        isFocused: skip ? false : isActive(focusId),
        focusId,
    };

}

/**
 * Hook to check if a specific focus ID is active.
 *
 * Useful when you need to check focus without managing it.
 */
export function useIsFocused(id: string): boolean {

    const { isActive } = useFocusContext();

    return isActive(id);

}

/**
 * Hook to get the currently focused component ID.
 */
export function useActiveFocus(): string | null {

    const { activeId } = useFocusContext();

    return activeId;

}
