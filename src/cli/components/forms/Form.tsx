/**
 * Form component - multi-field form with validation.
 *
 * Orchestrates multiple input fields with keyboard navigation:
 * - ↑/↓ navigate between fields (Tab also advances)
 * - Enter submits the form (or selects option in select fields)
 * - Esc clears current field or cancels if empty
 *
 * @example
 * ```tsx
 * <Form
 *     fields={[
 *         { key: 'name', label: 'Name', type: 'text', required: true },
 *         { key: 'host', label: 'Host', type: 'text', defaultValue: 'localhost' },
 *         { key: 'password', label: 'Password', type: 'password' },
 *         { key: 'ssl', label: 'Use SSL', type: 'checkbox' },
 *     ]}
 *     onSubmit={(values) => console.log(values)}
 *     onCancel={() => navigate('back')}
 * />
 * ```
 */
import { useState, useCallback, useMemo, useId, useEffect, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { TextInput } from '@inkjs/ui'

import type { ReactElement } from 'react'

import { useFocusScope } from '../../focus.js'


/**
 * Form field types.
 */
export type FormFieldType = 'text' | 'password' | 'select' | 'checkbox'


/**
 * Select option for select fields.
 */
export interface SelectOption {

    label: string
    value: string
}


/**
 * Props for inline SelectField component.
 */
interface SelectFieldProps {

    options: SelectOption[]
    value: string
    onChange: (value: string) => void
    isActive: boolean
    onConfirm: () => void
}


/**
 * Inline SelectField component with proper keyboard handling.
 *
 * Manages its own highlighted index and keyboard navigation.
 * Enter confirms selection and moves to next field.
 */
function SelectField({
    options,
    value,
    onChange,
    isActive,
    onConfirm,
}: SelectFieldProps): ReactElement {

    // Find current index from value
    const currentIndex = useMemo(() => {

        const idx = options.findIndex(opt => opt.value === value)

        return idx >= 0 ? idx : 0
    }, [options, value])

    // Track highlighted index (what user is hovering over)
    const [highlightedIndex, setHighlightedIndex] = useState(currentIndex)

    // Sync highlighted index when value changes externally
    useEffect(() => {

        setHighlightedIndex(currentIndex)
    }, [currentIndex])

    // Handle keyboard navigation for select
    useInput((input, key) => {

        if (!isActive) return

        // Up arrow - move highlight up
        if (key.upArrow) {

            setHighlightedIndex(i => i > 0 ? i - 1 : options.length - 1)
            return
        }

        // Down arrow - move highlight down
        if (key.downArrow) {

            setHighlightedIndex(i => i < options.length - 1 ? i + 1 : 0)
            return
        }

        // Enter - confirm selection
        if (key.return) {

            const selected = options[highlightedIndex]

            if (selected) {

                onChange(selected.value)
                onConfirm()
            }
        }
    })

    // Calculate visible window (show 4 options max)
    const visibleCount = 4
    const startIndex = useMemo(() => {

        if (options.length <= visibleCount) return 0

        const halfVisible = Math.floor(visibleCount / 2)
        let start = highlightedIndex - halfVisible

        if (start < 0) start = 0
        if (start > options.length - visibleCount) {

            start = options.length - visibleCount
        }

        return start
    }, [highlightedIndex, options.length])

    const visibleOptions = options.slice(startIndex, startIndex + visibleCount)
    const hasMoreAbove = startIndex > 0
    const hasMoreBelow = startIndex + visibleCount < options.length

    return (
        <Box flexDirection="column">
            {hasMoreAbove && (
                <Text dimColor>  ↑ more</Text>
            )}

            {visibleOptions.map((option, visibleIdx) => {

                const actualIndex = startIndex + visibleIdx
                const isHighlighted = actualIndex === highlightedIndex
                const isSelected = option.value === value

                return (
                    <Box key={option.value}>
                        <Text
                            color={isHighlighted && isActive ? 'cyan' : undefined}
                            bold={isHighlighted && isActive}
                        >
                            {isHighlighted ? '❯ ' : '  '}
                            {option.label}
                            {isSelected && !isHighlighted && ' ✓'}
                        </Text>
                    </Box>
                )
            })}

            {hasMoreBelow && (
                <Text dimColor>  ↓ more</Text>
            )}
        </Box>
    )
}


/**
 * Form field definition.
 */
export interface FormField {

    /** Unique field identifier */
    key: string

    /** Display label */
    label: string

    /** Field type */
    type: FormFieldType

    /** Whether field is required */
    required?: boolean

    /** Options for select type */
    options?: SelectOption[]

    /** Default value */
    defaultValue?: string | boolean

    /** Placeholder text for text/password */
    placeholder?: string

    /** Custom validation function */
    validate?: (value: string | boolean) => string | undefined
}


/**
 * Form values as key-value pairs.
 */
export type FormValues = Record<string, string | boolean>


/**
 * Form field errors.
 */
export type FormErrors = Record<string, string>


/**
 * Props for Form component.
 */
export interface FormProps {

    /** Form field definitions */
    fields: FormField[]

    /** Callback when form is submitted with valid values */
    onSubmit: (values: FormValues) => void

    /** Callback when form is cancelled */
    onCancel?: () => void

    /** Submit button label */
    submitLabel?: string

    /** Focus scope label */
    focusLabel?: string

    /** Whether form is busy (disables submission) */
    busy?: boolean

    /** Busy label to show while busy */
    busyLabel?: string

    /** Error message to show in toolbar (right side) */
    statusError?: string
}


/**
 * Form component.
 *
 * A multi-field form with keyboard navigation and validation.
 * Pushes to the focus stack on mount.
 */
export function Form({
    fields,
    onSubmit,
    onCancel,
    submitLabel = 'Submit',
    focusLabel = 'Form',
    busy = false,
    busyLabel = 'Working...',
    statusError,
}: FormProps): ReactElement {

    const { isFocused } = useFocusScope(focusLabel)
    const formId = useId()

    // Form state
    const [activeIndex, setActiveIndex] = useState(0)
    const [values, setValues] = useState<FormValues>(() => {

        const initial: FormValues = {}

        for (const field of fields) {

            if (field.defaultValue !== undefined) {

                initial[field.key] = field.defaultValue
            }
            else if (field.type === 'checkbox') {

                initial[field.key] = false
            }
            else {

                initial[field.key] = ''
            }
        }

        return initial
    })
    const [errors, setErrors] = useState<FormErrors>({})
    const [submitted, setSubmitted] = useState(false)

    // Get current field
    const currentField = fields[activeIndex]

    // Navigate fields
    const nextField = useCallback(() => {

        setActiveIndex(i => (i + 1) % fields.length)
    }, [fields.length])

    const prevField = useCallback(() => {

        setActiveIndex(i => (i - 1 + fields.length) % fields.length)
    }, [fields.length])

    // Update field value - stable reference (no dependencies)
    const updateValue = useCallback((key: string, value: string | boolean) => {

        setValues(prev => ({ ...prev, [key]: value }))

        // Clear error when value changes
        setErrors(prev => {

            if (!prev[key]) return prev // No change needed
            const next = { ...prev }
            delete next[key]
            return next
        })
    }, [])

    // Create stable onChange handlers for each field (memoized by field key)
    const onChangeHandlers = useRef<Record<string, (value: string) => void>>({})

    const getOnChangeHandler = useCallback((key: string) => {

        if (!onChangeHandlers.current[key]) {

            onChangeHandlers.current[key] = (value: string) => updateValue(key, value)
        }

        return onChangeHandlers.current[key]
    }, [updateValue])

    // Validate all fields
    const validateAll = useCallback((): boolean => {

        const newErrors: FormErrors = {}

        for (const field of fields) {

            const value = values[field.key]

            // Required check
            if (field.required) {

                if (value === '' || value === undefined) {

                    newErrors[field.key] = 'Required'
                    continue
                }
            }

            // Custom validation
            if (field.validate) {

                const error = field.validate(value ?? '')

                if (error) {

                    newErrors[field.key] = error
                }
            }
        }

        setErrors(newErrors)
        return Object.keys(newErrors).length === 0
    }, [fields, values])

    // Handle submit
    const handleSubmit = useCallback(() => {

        if (busy) return

        setSubmitted(true)

        if (validateAll()) {

            onSubmit(values)
        }
    }, [busy, validateAll, values, onSubmit])

    // Handle escape - clear field or cancel
    const handleEscape = useCallback(() => {

        const field = fields[activeIndex]

        if (!field) return

        const value = values[field.key]

        // Check if field has content to clear
        const hasContent = field.type === 'checkbox'
            ? value === true
            : typeof value === 'string' && value !== ''

        if (hasContent) {

            // Clear the field
            updateValue(field.key, field.type === 'checkbox' ? false : '')
        }
        else {

            // Field is empty, cancel form
            onCancel?.()
        }
    }, [activeIndex, fields, values, updateValue, onCancel])

    // Keyboard handling for navigation
    // Note: Select fields handle their own up/down/enter, so we skip those here
    useInput((input, key) => {

        if (!isFocused) return

        const isSelectField = currentField?.type === 'select'

        // Tab - always moves to next field
        if (key.tab) {

            nextField()
            return
        }

        // Arrow keys - only handle if NOT on a select field
        // (select fields handle their own arrow navigation)
        if (!isSelectField) {

            if (key.downArrow) {

                nextField()
                return
            }

            if (key.upArrow) {

                prevField()
                return
            }
        }

        // Enter - submit form (unless in select which needs Enter to select)
        if (key.return && !isSelectField) {

            handleSubmit()
            return
        }

        // Escape
        if (key.escape) {

            handleEscape()
            return
        }

        // Space toggles checkbox
        if (input === ' ' && currentField?.type === 'checkbox') {

            updateValue(currentField.key, !values[currentField.key])
        }
    })

    return (
        <Box flexDirection="column" gap={1}>
            {fields.map((field, index) => {

                const isActive = index === activeIndex && isFocused
                const error = errors[field.key]
                const value = values[field.key]

                return (
                    <Box key={field.key} flexDirection="column">
                        <Box gap={1}>
                            <Text color={isActive ? 'cyan' : 'white'}>
                                {isActive ? '› ' : '  '}
                                {field.label}
                                {field.required && <Text color="red">*</Text>}
                            </Text>
                        </Box>

                        <Box marginLeft={2}>
                            {field.type === 'text' && (
                                <TextInput
                                    placeholder={field.placeholder ?? ''}
                                    defaultValue={String(field.defaultValue ?? '')}
                                    onChange={getOnChangeHandler(field.key)}
                                    isDisabled={!isActive}
                                />
                            )}

                            {field.type === 'password' && (
                                <TextInput
                                    placeholder={field.placeholder ?? ''}
                                    defaultValue={String(field.defaultValue ?? '')}
                                    onChange={getOnChangeHandler(field.key)}
                                    isDisabled={!isActive}
                                />
                            )}

                            {field.type === 'select' && field.options && (
                                <SelectField
                                    options={field.options}
                                    value={String(value ?? '')}
                                    onChange={getOnChangeHandler(field.key)}
                                    isActive={isActive}
                                    onConfirm={nextField}
                                />
                            )}

                            {field.type === 'checkbox' && (
                                <Text>
                                    {value ? '☑' : '☐'} {value ? 'Yes' : 'No'}
                                </Text>
                            )}
                        </Box>

                        {error && submitted && (
                            <Box marginLeft={2}>
                                <Text color="red">{error}</Text>
                            </Box>
                        )}
                    </Box>
                )
            })}

            <Box marginTop={1} justifyContent="space-between">
                <Box gap={2}>
                    {busy ? (
                        <Text dimColor>{busyLabel}</Text>
                    ) : (
                        <>
                            <Text dimColor>[Enter] {submitLabel}</Text>
                            <Text dimColor>[Esc] Cancel</Text>
                            <Text dimColor>[↑↓] Navigate</Text>
                        </>
                    )}
                </Box>

                {statusError && (
                    <Text color="red">✘ {statusError}</Text>
                )}
            </Box>
        </Box>
    )
}
