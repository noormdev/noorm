/**
 * Form component - multi-field form with a browse/edit navigation model.
 *
 * Layout is two aligned columns: a label gutter sized from the longest label,
 * then the value. One row per field, no spacer rows, and a select collapses to
 * its current value until it is being edited. A 10-field config form fits on a
 * short terminal instead of running off the bottom.
 *
 * Navigation has two modes, because a single mode cannot serve both "move
 * around the form" and "change this value" with the same arrow keys:
 *
 * - Browse (default): ↑/↓ and Tab move between fields on EVERY field type,
 *   Enter opens the active field for editing, Esc cancels the form. Past the
 *   last field the cursor lands on the action row, where Enter submits.
 * - Edit: the field owns input. Enter commits and returns to browse, Esc puts
 *   back the value the field had when edit mode opened.
 *
 * Enter is therefore the mode switch, not the submit key - submission lives on
 * the action row so "down, then enter" is the only model to learn.
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
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { TextInput } from './TextInput.js';

import type { ReactElement } from 'react';

import { useFocusScope } from '../../focus.js';

/** Options an expanded select shows before it starts scrolling. */
const SELECT_VISIBLE_OPTIONS = 4;

/** Widest label gutter. Anything longer truncates instead of moving the value column. */
const LABEL_GUTTER_MAX = 22;

/** Columns the `›` active marker occupies. */
const MARKER_WIDTH = 2;

/** Columns between the label gutter and the value column. */
const LABEL_VALUE_GAP = 2;

/**
 * Rows the form spends on chrome rather than fields: two scroll indicators, the
 * spacer above the action row, the action row, and the hint row.
 */
const FORM_CHROME_ROWS = 5;

/**
 * Rows the app shell and its Panel claim before a Form sees the terminal:
 * breadcrumb header (2), status bar (2), panel border (2), title + spacer (2),
 * vertical padding (2). Only used when a consumer does not pass `height`.
 */
const SCREEN_CHROME_ROWS = 10;

/** Floor for the derived budget, so a tiny terminal still renders something usable. */
const MIN_FORM_ROWS = 8;

/**
 * Form field types.
 */
export type FormFieldType = 'text' | 'password' | 'select' | 'checkbox';

/**
 * Select option for select fields.
 */
export interface SelectOption {
    label: string;
    value: string;
}

/**
 * Props for inline SelectField component.
 */
interface SelectFieldProps {
    options: SelectOption[];
    value: string;
    onChange: (value: string) => void;
    isActive: boolean;
    onConfirm: () => void;
}

/**
 * Inline SelectField component with proper keyboard handling.
 *
 * Only mounted while its field is in edit mode, so it owns up/down/enter
 * without ever competing with the Form's own field navigation.
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

        const idx = options.findIndex((opt) => opt.value === value);

        return idx >= 0 ? idx : 0;

    }, [options, value]);

    // Track highlighted index (what user is hovering over)
    const [highlightedIndex, setHighlightedIndex] = useState(currentIndex);

    // Sync highlighted index when value changes externally
    useEffect(() => {

        setHighlightedIndex(currentIndex);

    }, [currentIndex]);

    // Handle keyboard navigation for select
    useInput((input, key) => {

        if (!isActive) return;

        // Up arrow - move highlight up
        if (key.upArrow) {

            setHighlightedIndex((i) => (i > 0 ? i - 1 : options.length - 1));

            return;

        }

        // Down arrow - move highlight down
        if (key.downArrow) {

            setHighlightedIndex((i) => (i < options.length - 1 ? i + 1 : 0));

            return;

        }

        // Enter - confirm selection
        if (key.return) {

            const selected = options[highlightedIndex];

            if (selected) {

                onChange(selected.value);
                onConfirm();

            }

        }

    });

    const startIndex = useMemo(() => {

        if (options.length <= SELECT_VISIBLE_OPTIONS) return 0;

        const halfVisible = Math.floor(SELECT_VISIBLE_OPTIONS / 2);
        let start = highlightedIndex - halfVisible;

        if (start < 0) start = 0;
        if (start > options.length - SELECT_VISIBLE_OPTIONS) {

            start = options.length - SELECT_VISIBLE_OPTIONS;

        }

        return start;

    }, [highlightedIndex, options.length]);

    const visibleOptions = options.slice(startIndex, startIndex + SELECT_VISIBLE_OPTIONS);
    const hasMoreAbove = startIndex > 0;
    const hasMoreBelow = startIndex + SELECT_VISIBLE_OPTIONS < options.length;

    return (
        <Box flexDirection="column">
            {hasMoreAbove && <Text dimColor>↑ more</Text>}

            {visibleOptions.map((option, visibleIdx) => {

                const actualIndex = startIndex + visibleIdx;
                const isHighlighted = actualIndex === highlightedIndex;
                const isSelected = option.value === value;

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
                );

            })}

            {hasMoreBelow && <Text dimColor>↓ more</Text>}
        </Box>
    );

}

/**
 * Form field definition.
 */
export interface FormField {
    /** Unique field identifier */
    key: string;

    /** Display label. Truncated in the gutter if longer than the cap. */
    label: string;

    /** Field type */
    type: FormFieldType;

    /** Whether field is required */
    required?: boolean;

    /** Options for select type */
    options?: SelectOption[];

    /** Default value */
    defaultValue?: string | boolean;

    /** Placeholder text for text/password */
    placeholder?: string;

    /**
     * Short qualifier rendered dim after the value, e.g. `(locked)`.
     * Keeps the label short enough to survive the gutter cap.
     */
    hint?: string;

    /** Custom validation function */
    validate?: (value: string | boolean) => string | undefined;
}

/**
 * Form values as key-value pairs.
 */
export type FormValues = Record<string, string | boolean>;

/**
 * Form field errors.
 */
export type FormErrors = Record<string, string>;

/**
 * Props for Form component.
 */
export interface FormProps {
    /** Form field definitions */
    fields: FormField[];

    /** Callback when form is submitted with valid values */
    onSubmit: (values: FormValues) => void;

    /** Callback when form is cancelled. Omit it and the Cancel button is not rendered. */
    onCancel?: () => void;

    /** Submit button label */
    submitLabel?: string;

    /** Focus scope label */
    focusLabel?: string;

    /** Whether form is busy (disables submission) */
    busy?: boolean;

    /** Busy label to show while busy */
    busyLabel?: string;

    /**
     * Called when Escape is pressed while `busy`. Supplying it also advertises
     * the hatch next to the busy label — a busy state that can be cancelled
     * and does not say so is one nobody tries.
     *
     * Omit it and Escape keeps falling through to `onCancel`.
     */
    onCancelBusy?: () => void;

    /** Error message to show in toolbar (right side) */
    statusError?: string;

    /**
     * Total rows the form may occupy, including its action and hint rows.
     * Pass it when the screen knows its own chrome; otherwise the form derives
     * a budget from the terminal height.
     */
    height?: number;
}

/**
 * Which action stop the cursor is on once it moves past the last field.
 */
type FormAction = 'submit' | 'cancel';

/**
 * Truncate a label to the gutter width, marking the cut with an ellipsis.
 */
function truncateLabel(label: string, max: number): string {

    if (max <= 0) return '';

    if (label.length <= max) return label;

    return `${label.slice(0, max - 1)}…`;

}

/**
 * Browse-mode text for a field's value, so a select costs one row like
 * everything else until it is opened.
 */
function displayValue(field: FormField, value: string | boolean | undefined): string {

    if (field.type === 'checkbox') {

        return value ? '☑ Yes' : '☐ No';

    }

    const text = typeof value === 'string' ? value : '';

    if (field.type === 'password') {

        return '•'.repeat(text.length);

    }

    if (field.type === 'select') {

        const option = field.options?.find((opt) => opt.value === text);

        return option?.label ?? text;

    }

    return text;

}

/**
 * Form component.
 *
 * A multi-field form with browse/edit keyboard navigation and validation.
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
    onCancelBusy,
    statusError,
    height,
}: FormProps): ReactElement {

    const { isFocused } = useFocusScope(focusLabel);

    // useWindowSize, not useStdout: stdout.rows mutates on resize without telling
    // React, which would freeze the derived budget at mount size.
    const { rows: terminalRows } = useWindowSize();

    const [activeIndex, setActiveIndex] = useState(0);
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [editSnapshot, setEditSnapshot] = useState<string | boolean>('');
    const [values, setValues] = useState<FormValues>(() => {

        const initial: FormValues = {};

        for (const field of fields) {

            if (field.defaultValue !== undefined) {

                initial[field.key] = field.defaultValue;

            }
            else if (field.type === 'checkbox') {

                initial[field.key] = false;

            }
            else {

                initial[field.key] = '';

            }

        }

        return initial;

    });
    const [errors, setErrors] = useState<FormErrors>({});
    const [submitted, setSubmitted] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const actions: FormAction[] = useMemo(
        () => (onCancel ? ['submit', 'cancel'] : ['submit']),
        [onCancel],
    );

    const stopCount = fields.length + actions.length;
    const activeAction = activeIndex >= fields.length ? actions[activeIndex - fields.length] : undefined;
    const currentField = activeIndex < fields.length ? fields[activeIndex] : undefined;
    const isEditing = editingKey !== null;

    // A field list that shrinks (SecretValueForm swaps fields by mode) must not
    // leave the cursor pointing past the end.
    useEffect(() => {

        setActiveIndex((i) => (i >= stopCount ? Math.max(0, stopCount - 1) : i));

    }, [stopCount]);

    const moveBy = useCallback((delta: number) => {

        setActiveIndex((i) => (i + delta + stopCount) % stopCount);

    }, [stopCount]);

    const updateValue = useCallback((key: string, value: string | boolean) => {

        setValues((prev) => ({ ...prev, [key]: value }));

        setErrors((prev) => {

            if (!prev[key]) return prev;

            const next = { ...prev };
            delete next[key];

            return next;

        });

    }, []);

    // TextInput reports changes from a useEffect keyed on the onChange identity,
    // so an inline arrow would re-fire the last change on every render - loud
    // enough to overwrite an Esc revert with the value it just discarded.
    const onChangeHandlers = useRef<Record<string, (value: string) => void>>({});

    const getOnChangeHandler = useCallback(
        (key: string) => {

            if (!onChangeHandlers.current[key]) {

                onChangeHandlers.current[key] = (value: string) => updateValue(key, value);

            }

            return onChangeHandlers.current[key];

        },
        [updateValue],
    );

    const collectErrors = useCallback((): FormErrors => {

        const found: FormErrors = {};

        for (const field of fields) {

            const value = values[field.key];

            if (field.required && (value === '' || value === undefined)) {

                found[field.key] = 'Required';

                continue;

            }

            if (field.validate) {

                const error = field.validate(value ?? '');

                if (error) {

                    found[field.key] = error;

                }

            }

        }

        return found;

    }, [fields, values]);

    const handleSubmit = useCallback(() => {

        if (busy || submitting) return;

        const found = collectErrors();
        const firstInvalid = fields.findIndex((field) => found[field.key]);

        setSubmitted(true);
        setSubmitting(true);
        setErrors(found);

        if (firstInvalid === -1) {

            onSubmit(values);

        }
        else {

            // Land on the offending field; it may be outside the current window.
            setActiveIndex(firstInvalid);

        }

        // Parent's `busy` prop guards double-submit across the async work.
        setSubmitting(false);

    }, [busy, submitting, collectErrors, fields, values, onSubmit]);

    const beginEdit = useCallback(() => {

        const field = fields[activeIndex];

        if (!field) return;

        // A checkbox has nothing to type into, so Enter just flips it.
        if (field.type === 'checkbox') {

            updateValue(field.key, !values[field.key]);

            return;

        }

        if (field.type === 'select' && !field.options?.length) return;

        setEditSnapshot(values[field.key] ?? '');
        setEditingKey(field.key);

    }, [activeIndex, fields, values, updateValue]);

    const commitEdit = useCallback((finalValue?: string) => {

        if (editingKey !== null && finalValue !== undefined) {

            updateValue(editingKey, finalValue);

        }

        setEditingKey(null);

    }, [editingKey, updateValue]);

    const revertEdit = useCallback(() => {

        if (editingKey === null) return;

        const key = editingKey;

        setValues((prev) => ({ ...prev, [key]: editSnapshot }));
        setEditingKey(null);

    }, [editingKey, editSnapshot]);

    const activateStop = useCallback(() => {

        if (activeAction === 'submit') {

            handleSubmit();

            return;

        }

        if (activeAction === 'cancel') {

            onCancel?.();

            return;

        }

        beginEdit();

    }, [activeAction, handleSubmit, onCancel, beginEdit]);

    // Note: the guard is inside the handler, not useInput's `isActive` option -
    // isFocused is false on the first render and `isActive` would skip
    // registration permanently.
    useInput((input, key) => {

        if (!isFocused) return;

        if (isEditing) {

            // Everything else belongs to the field: TextInput's own handler for
            // text/password, SelectField's for select.
            if (key.escape) {

                revertEdit();

                return;

            }

            if (key.tab) {

                commitEdit();
                moveBy(key.shift ? -1 : 1);

                return;

            }

            if (key.return) {

                commitEdit();

            }

            return;

        }

        if (key.tab) {

            moveBy(key.shift ? -1 : 1);

            return;

        }

        if (key.downArrow) {

            moveBy(1);

            return;

        }

        if (key.upArrow) {

            moveBy(-1);

            return;

        }

        if (activeAction && (key.leftArrow || key.rightArrow)) {

            setActiveIndex((i) => {

                const next = key.leftArrow ? i - 1 : i + 1;

                return Math.min(stopCount - 1, Math.max(fields.length, next));

            });

            return;

        }

        if (key.escape) {

            // While busy, Escape belongs to the operation in flight: leaving
            // the screen would abandon it rather than stop it.
            if (busy && onCancelBusy) {

                onCancelBusy();

                return;

            }

            onCancel?.();

            return;

        }

        if (key.return) {

            activateStop();

            return;

        }

        if (input === ' ' && currentField?.type === 'checkbox') {

            updateValue(currentField.key, !values[currentField.key]);

        }

    });

    const gutterWidth = useMemo(() => {

        let widest = 0;

        for (const field of fields) {

            const width = field.label.length + (field.required ? 1 : 0);

            if (width > widest) widest = width;

        }

        return Math.min(widest, LABEL_GUTTER_MAX);

    }, [fields]);

    const labelColumnWidth = MARKER_WIDTH + gutterWidth + LABEL_VALUE_GAP;

    // An expanded select eats rows the field list would otherwise get.
    const expandedExtraRows = useMemo(() => {

        const field = fields.find((candidate) => candidate.key === editingKey);

        if (field?.type !== 'select' || !field.options) return 0;

        const listed = Math.min(field.options.length, SELECT_VISIBLE_OPTIONS);
        const indicators = field.options.length > SELECT_VISIBLE_OPTIONS ? 2 : 0;

        return listed + indicators - 1;

    }, [fields, editingKey]);

    const budget = height ?? Math.max(terminalRows - SCREEN_CHROME_ROWS, MIN_FORM_ROWS);
    const visibleCount = Math.max(1, budget - FORM_CHROME_ROWS - expandedExtraRows);

    // Same windowing as SelectList: centre the focused row, clamp to the ends.
    const startIndex = useMemo(() => {

        if (fields.length <= visibleCount) return 0;

        const windowFocus = Math.min(activeIndex, fields.length - 1);
        const halfVisible = Math.floor(visibleCount / 2);
        let start = windowFocus - halfVisible;

        if (start < 0) start = 0;
        if (start > fields.length - visibleCount) {

            start = fields.length - visibleCount;

        }

        return start;

    }, [activeIndex, fields.length, visibleCount]);

    const visibleFields = fields.slice(startIndex, startIndex + visibleCount);
    const hasMoreAbove = startIndex > 0;
    const hasMoreBelow = startIndex + visibleCount < fields.length;

    const hintText = useMemo(() => {

        if (isEditing) {

            const field = fields.find((candidate) => candidate.key === editingKey);

            return field?.type === 'select'
                ? '↑↓ option   ↵ commit   esc revert'
                : '↵ commit   esc revert   tab commit + next';

        }

        if (activeAction) {

            return '↑↓ move   ←→ button   ↵ activate   esc cancel';

        }

        if (currentField?.type === 'checkbox') {

            return '↑↓ field   ↵/space toggle   esc cancel';

        }

        return '↑↓ field   ↵ edit   esc cancel';

    }, [isEditing, fields, editingKey, activeAction, currentField]);

    return (
        <Box flexDirection="column">
            {hasMoreAbove && <Text dimColor>{'  '}↑ {startIndex} more</Text>}

            {visibleFields.map((field, visibleIndex) => {

                const index = startIndex + visibleIndex;
                const isActive = index === activeIndex && isFocused;
                const isFieldEditing = editingKey === field.key;
                const error = errors[field.key];
                const value = values[field.key];
                const starWidth = field.required ? 1 : 0;

                return (
                    <Box key={field.key}>
                        <Box width={labelColumnWidth}>
                            <Text
                                color={isActive ? 'cyan' : undefined}
                                dimColor={!isActive}
                                bold={isActive}
                            >
                                {isActive ? '› ' : '  '}
                                {truncateLabel(field.label, gutterWidth - starWidth)}
                            </Text>
                            {field.required && <Text color="red">*</Text>}
                        </Box>

                        <Box flexDirection="column">
                            {isFieldEditing && (field.type === 'text' || field.type === 'password') && (
                                <TextInput
                                    placeholder={field.placeholder ?? ''}
                                    defaultValue={typeof value === 'string' ? value : ''}
                                    onChange={getOnChangeHandler(field.key)}
                                    onSubmit={commitEdit}
                                />
                            )}

                            {isFieldEditing && field.type === 'select' && field.options && (
                                <SelectField
                                    options={field.options}
                                    value={typeof value === 'string' ? value : ''}
                                    onChange={getOnChangeHandler(field.key)}
                                    isActive={isFocused}
                                    onConfirm={commitEdit}
                                />
                            )}

                            {!isFieldEditing && (
                                <Box>
                                    {displayValue(field, value) === '' && field.placeholder ? (
                                        <Text dimColor>{field.placeholder}</Text>
                                    ) : (
                                        <Text>{displayValue(field, value)}</Text>
                                    )}

                                    {field.hint && <Text dimColor>{'  '}{field.hint}</Text>}

                                    {error && submitted && <Text color="red">{'  '}✘ {error}</Text>}
                                </Box>
                            )}
                        </Box>
                    </Box>
                );

            })}

            {hasMoreBelow && (
                <Text dimColor>{'  '}↓ {fields.length - startIndex - visibleCount} more</Text>
            )}

            <Box marginTop={1} gap={2}>
                {busy ? (
                    <>
                        <Text dimColor>{busyLabel}</Text>
                        {onCancelBusy && <Text dimColor>[Esc] Cancel</Text>}
                    </>
                ) : (
                    actions.map((action) => {

                        const focused = activeAction === action && isFocused;
                        const label = action === 'submit' ? submitLabel : 'Cancel';

                        return (
                            <Text
                                key={action}
                                color={focused ? 'cyan' : undefined}
                                bold={focused}
                                dimColor={!focused}
                            >
                                {focused ? '❯ ' : '  '}[ {label} ]
                            </Text>
                        );

                    })
                )}
            </Box>

            <Box justifyContent="space-between">
                <Text dimColor wrap="truncate">{'  '}{hintText}</Text>

                {statusError && <Text color="red">✘ {statusError}</Text>}
            </Box>
        </Box>
    );

}
