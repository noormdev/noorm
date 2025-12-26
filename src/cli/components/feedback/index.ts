/**
 * Feedback components.
 *
 * Re-exports @inkjs/ui feedback components for convenience,
 * plus custom toast notification system.
 */
export {
    Spinner,
    ProgressBar,
    Alert,
    StatusMessage,
    Badge,
} from '@inkjs/ui'

export { ToastProvider, ToastRenderer, useToast } from './Toast.js'
export type { Toast, ToastVariant } from './Toast.js'
