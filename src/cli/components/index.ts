/**
 * CLI Components.
 *
 * Shared UI components for the noorm TUI.
 *
 * @example
 * ```tsx
 * import { Panel, SelectList, Form, Confirm } from './components/index.js'
 * ```
 */

// Layout
export { Panel, Divider } from './layout/index.js'
export type { PanelProps, DividerProps } from './layout/index.js'

// Lists
export { SelectList, ActionList, StatusList } from './lists/index.js'
export type {
    SelectListProps,
    SelectListItem,
    ActionListProps,
    ActionItem,
    StatusListProps,
    StatusListItem,
    StatusType,
} from './lists/index.js'

// Forms
export { Form, TextInput } from './forms/index.js'
export type {
    FormProps,
    FormField,
    FormFieldType,
    FormValues,
    FormErrors,
    SelectOption,
} from './forms/index.js'

// Feedback (re-exports from @inkjs/ui + custom toast)
export { Spinner, ProgressBar, Alert, StatusMessage, Badge } from './feedback/index.js'
export { ToastProvider, ToastRenderer, useToast } from './feedback/index.js'
export type { Toast, ToastVariant } from './feedback/index.js'

// Dialogs
export { Confirm, ProtectedConfirm, FilePicker } from './dialogs/index.js'
export type {
    ConfirmProps,
    ProtectedConfirmProps,
    FilePickerProps,
    FilePickerMode,
} from './dialogs/index.js'

// Status
export { LockStatus, ConnectionStatus } from './status/index.js'
export type {
    LockStatusProps,
    LockStatusType,
    ConnectionStatusProps,
    ConnectionStatusType,
} from './status/index.js'
