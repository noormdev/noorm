/**
 * Toast notification system.
 *
 * Provides temporary flash messages that auto-dismiss.
 * Use the ToastProvider at the app root and useToast() hook to show messages.
 *
 * @example
 * ```tsx
 * // In app root
 * <ToastProvider>
 *     <App />
 * </ToastProvider>
 *
 * // In any component
 * const { showToast } = useToast()
 * showToast({ message: 'Config saved!', variant: 'success' })
 * ```
 */
import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { Box, Text } from 'ink'

import type { ReactElement, ReactNode } from 'react'


/**
 * Toast variant determines styling.
 */
export type ToastVariant = 'success' | 'error' | 'info' | 'warning'


/**
 * Toast configuration.
 */
export interface Toast {

    /** Unique identifier */
    id: string

    /** Message to display */
    message: string

    /** Visual variant */
    variant: ToastVariant

    /** Duration in ms before auto-dismiss (default: 3000) */
    duration?: number
}


/**
 * Toast context value.
 */
interface ToastContextValue {

    /** Currently visible toast (only one at a time) */
    toast: Toast | null

    /** Show a new toast */
    showToast: (options: Omit<Toast, 'id'>) => void

    /** Dismiss current toast */
    dismissToast: () => void
}


const ToastContext = createContext<ToastContextValue | null>(null)


/**
 * Variant styling.
 */
const VARIANT_STYLES: Record<ToastVariant, { icon: string; color: string }> = {
    success: { icon: '✓', color: 'green' },
    error: { icon: '✘', color: 'red' },
    info: { icon: 'ℹ', color: 'blue' },
    warning: { icon: '⚠', color: 'yellow' },
}


/**
 * Toast display component.
 */
function ToastDisplay({ toast }: { toast: Toast }): ReactElement {

    const style = VARIANT_STYLES[toast.variant]

    return (
        <Box>
            <Text color={style.color}>
                {style.icon} {toast.message}
            </Text>
        </Box>
    )
}


/**
 * Props for ToastProvider.
 */
interface ToastProviderProps {

    children: ReactNode
}


/**
 * Toast provider component.
 *
 * Manages toast state and auto-dismissal.
 */
export function ToastProvider({ children }: ToastProviderProps): ReactElement {

    const [toast, setToast] = useState<Toast | null>(null)

    // Auto-dismiss timer
    useEffect(() => {

        if (!toast) return

        const duration = toast.duration ?? 3000
        const timer = setTimeout(() => {

            setToast(null)
        }, duration)

        return () => clearTimeout(timer)
    }, [toast])

    const showToast = useCallback((options: Omit<Toast, 'id'>) => {

        const id = `toast-${Date.now()}`
        setToast({ id, ...options })
    }, [])

    const dismissToast = useCallback(() => {

        setToast(null)
    }, [])

    return (
        <ToastContext.Provider value={{ toast, showToast, dismissToast }}>
            {children}
        </ToastContext.Provider>
    )
}


/**
 * Hook to access toast functionality.
 *
 * @example
 * ```tsx
 * const { showToast } = useToast()
 *
 * const handleSave = async () => {
 *     await save()
 *     showToast({ message: 'Saved!', variant: 'success' })
 * }
 * ```
 */
export function useToast(): ToastContextValue {

    const context = useContext(ToastContext)

    if (!context) {

        throw new Error('useToast must be used within a ToastProvider')
    }

    return context
}


/**
 * Toast renderer component.
 *
 * Place this where you want toasts to appear in your layout.
 */
export function ToastRenderer(): ReactElement | null {

    const { toast } = useToast()

    if (!toast) return null

    return <ToastDisplay toast={toast} />
}
