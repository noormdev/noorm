/**
 * Form components.
 *
 * TextInput from @inkjs/ui is display-only when isDisabled, so it's compatible.
 * Select from @inkjs/ui uses ink's internal focus - don't use it.
 */
export { Form } from './Form.js'
export { TextInput } from '@inkjs/ui'

export type {
    FormProps,
    FormField,
    FormFieldType,
    FormValues,
    FormErrors,
    SelectOption,
} from './Form.js'
