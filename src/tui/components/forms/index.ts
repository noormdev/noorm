/**
 * Form components.
 *
 * TextInput is ours rather than @inkjs/ui's, because upstream's handler types
 * a mouse report into the field. Display-only when isDisabled, same as before.
 * Select from @inkjs/ui uses ink's internal focus - don't use it.
 */
export { Form } from './Form.js';
export { TextInput } from './TextInput.js';

export type { TextInputProps } from './TextInput.js';

export type {
    FormProps,
    FormField,
    FormFieldType,
    FormValues,
    FormErrors,
    SelectOption,
} from './Form.js';
