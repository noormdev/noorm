/**
 * Feedback components.
 *
 * Re-exports @inkjs/ui feedback components for convenience,
 * plus custom toast notification system.
 */
export { Spinner, ProgressBar, Alert, StatusMessage, Badge } from '@inkjs/ui';

export { ToastProvider, ToastRenderer, useToast } from './Toast.js';
export type { Toast, ToastVariant } from './Toast.js';

export { DismissableAlert } from './DismissableAlert.js';
export type { DismissableAlertProps } from './DismissableAlert.js';

export { useDismissableAlert } from './useDismissableAlert.js';
export type {
    AlertChoice,
    ShowAlertOptions,
    UseDismissableAlertResult,
} from './useDismissableAlert.js';
