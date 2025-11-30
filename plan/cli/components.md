# CLI Components


## Overview

Shared UI components used across all screens in the noorm TUI. These provide consistent styling and behavior for:

- Layout (Header, Footer, Box containers)
- Lists and selection
- Forms and inputs
- Progress indicators
- Confirmations and alerts
- Status displays


## Dependencies

```json
{
    "ink": "^4.4.0",
    "ink-text-input": "^5.0.1",
    "ink-select-input": "^5.0.0",
    "ink-spinner": "^5.0.0",
    "react": "^18.2.0"
}
```


## File Structure

```
src/cli/components/
├── index.ts               # Public exports
├── layout/
│   ├── Header.tsx
│   ├── Footer.tsx
│   ├── Panel.tsx
│   └── Divider.tsx
├── lists/
│   ├── SelectList.tsx
│   ├── ActionList.tsx
│   └── StatusList.tsx
├── forms/
│   ├── TextInput.tsx
│   ├── PasswordInput.tsx
│   ├── SelectInput.tsx
│   ├── Checkbox.tsx
│   └── Form.tsx
├── feedback/
│   ├── ProgressBar.tsx
│   ├── Spinner.tsx
│   ├── Alert.tsx
│   └── Toast.tsx
├── dialogs/
│   ├── Confirm.tsx
│   ├── ProtectedConfirm.tsx
│   └── HelpOverlay.tsx
└── status/
    ├── Badge.tsx
    ├── LockStatus.tsx
    └── ConnectionStatus.tsx
```


## Layout Components


### Header

```typescript
// src/cli/components/layout/Header.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { useRouter, getSection } from '../../router';
import { Section } from '../../types';

const SECTIONS: Array<{ key: Section; label: string }> = [
    { key: 'config', label: 'Config' },
    { key: 'change', label: 'Change' },
    { key: 'run', label: 'Run' },
    { key: 'db', label: 'DB' },
    { key: 'lock', label: 'Lock' },
];

export function Header() {

    const { route } = useRouter();
    const currentSection = getSection(route);

    return (
        <Box flexDirection="column" marginBottom={1}>

            <Box>
                <Text bold color="cyan">noorm</Text>
                <Text color="gray"> - Database Schema & Changeset Manager</Text>
            </Box>

            <Box marginTop={1}>
                <Text color="gray">{'─'.repeat(50)}</Text>
            </Box>

            <Box marginTop={1} gap={2}>
                {SECTIONS.map(({ key, label }) => (

                    <TabButton
                        key={key}
                        label={label}
                        active={currentSection === key}
                    />
                ))}
            </Box>

        </Box>
    );
}

interface TabButtonProps {
    label: string;
    active: boolean;
}

function TabButton({ label, active }: TabButtonProps) {

    if (active) {

        return (
            <Text backgroundColor="cyan" color="black" bold>
                {` ${label} `}
            </Text>
        );
    }

    return (
        <Text color="gray">
            {` ${label} `}
        </Text>
    );
}
```


### Footer

```typescript
// src/cli/components/layout/Footer.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { useRouter, useCanGoBack } from '../../router';

export interface FooterProps {
    /** Screen-specific actions */
    actions?: Array<{ key: string; label: string }>;
}

export function Footer({ actions = [] }: FooterProps) {

    const canGoBack = useCanGoBack();

    const globalActions = [
        ...(canGoBack ? [{ key: 'esc', label: 'back' }] : []),
        { key: '?', label: 'help' },
        { key: 'q', label: 'quit' },
    ];

    const allActions = [...actions, ...globalActions];

    return (
        <Box
            flexDirection="column"
            marginTop={1}
            borderStyle="single"
            borderTop
            borderBottom={false}
            borderLeft={false}
            borderRight={false}
            paddingX={1}
        >
            <Box gap={2} flexWrap="wrap">
                {allActions.map(({ key, label }) => (

                    <Box key={key}>
                        <Text color="yellow">[{key}]</Text>
                        <Text color="gray">{label}</Text>
                    </Box>
                ))}
            </Box>
        </Box>
    );
}
```


### Panel

```typescript
// src/cli/components/layout/Panel.tsx

import React from 'react';
import { Box, Text } from 'ink';

export interface PanelProps {
    title?: string;
    children: React.ReactNode;
    borderColor?: string;
    padding?: number;
}

export function Panel({
    title,
    children,
    borderColor = 'gray',
    padding = 1
}: PanelProps) {

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={borderColor}
            paddingX={padding}
            paddingY={padding > 0 ? 1 : 0}
        >
            {title && (
                <Box marginBottom={1}>
                    <Text bold>{title}</Text>
                </Box>
            )}

            {children}
        </Box>
    );
}
```


### Divider

```typescript
// src/cli/components/layout/Divider.tsx

import React from 'react';
import { Box, Text } from 'ink';

export interface DividerProps {
    title?: string;
    width?: number;
}

export function Divider({ title, width = 40 }: DividerProps) {

    if (!title) {

        return (
            <Box marginY={1}>
                <Text color="gray">{'─'.repeat(width)}</Text>
            </Box>
        );
    }

    const sideWidth = Math.floor((width - title.length - 2) / 2);
    const leftLine = '─'.repeat(sideWidth);
    const rightLine = '─'.repeat(width - sideWidth - title.length - 2);

    return (
        <Box marginY={1}>
            <Text color="gray">{leftLine} </Text>
            <Text>{title}</Text>
            <Text color="gray"> {rightLine}</Text>
        </Box>
    );
}
```


## List Components


### SelectList

```typescript
// src/cli/components/lists/SelectList.tsx

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

export interface SelectListItem<T = any> {
    key: string;
    label: string;
    value: T;
    description?: string;
    disabled?: boolean;
    icon?: string;
}

export interface SelectListProps<T> {
    items: Array<SelectListItem<T>>;
    onSelect: (item: SelectListItem<T>) => void;
    onHighlight?: (item: SelectListItem<T>) => void;
    initialIndex?: number;
    limit?: number;
}

export function SelectList<T>({
    items,
    onSelect,
    onHighlight,
    initialIndex = 0,
    limit = 10
}: SelectListProps<T>) {

    const [selectedIndex, setSelectedIndex] = useState(initialIndex);
    const [scrollOffset, setScrollOffset] = useState(0);

    // Notify on highlight change
    useEffect(() => {

        if (items[selectedIndex]) {

            onHighlight?.(items[selectedIndex]);
        }
    }, [selectedIndex, items, onHighlight]);

    useInput((input, key) => {

        if (key.upArrow) {

            setSelectedIndex(prev => {

                const next = prev > 0 ? prev - 1 : items.length - 1;

                // Skip disabled items
                if (items[next]?.disabled) {

                    return prev > 1 ? prev - 1 : items.length - 1;
                }

                // Adjust scroll
                if (next < scrollOffset) {

                    setScrollOffset(next);
                }

                return next;
            });
        }

        if (key.downArrow) {

            setSelectedIndex(prev => {

                const next = prev < items.length - 1 ? prev + 1 : 0;

                if (items[next]?.disabled) {

                    return prev < items.length - 2 ? prev + 1 : 0;
                }

                // Adjust scroll
                if (next >= scrollOffset + limit) {

                    setScrollOffset(next - limit + 1);
                }

                return next;
            });
        }

        if (key.return) {

            const item = items[selectedIndex];

            if (item && !item.disabled) {

                onSelect(item);
            }
        }
    });

    const visibleItems = items.slice(scrollOffset, scrollOffset + limit);
    const hasMore = items.length > limit;

    return (
        <Box flexDirection="column">

            {hasMore && scrollOffset > 0 && (
                <Text color="gray">  ↑ {scrollOffset} more</Text>
            )}

            {visibleItems.map((item, index) => {

                const actualIndex = scrollOffset + index;
                const isSelected = actualIndex === selectedIndex;

                return (
                    <SelectListRow
                        key={item.key}
                        item={item}
                        selected={isSelected}
                    />
                );
            })}

            {hasMore && scrollOffset + limit < items.length && (
                <Text color="gray">  ↓ {items.length - scrollOffset - limit} more</Text>
            )}

        </Box>
    );
}

interface SelectListRowProps<T> {
    item: SelectListItem<T>;
    selected: boolean;
}

function SelectListRow<T>({ item, selected }: SelectListRowProps<T>) {

    const prefix = selected ? '>' : ' ';
    const icon = item.icon ?? '';

    return (
        <Box>
            <Text color={selected ? 'cyan' : undefined}>
                {prefix} {icon}{icon ? ' ' : ''}{item.label}
            </Text>

            {item.description && (
                <Text color="gray"> - {item.description}</Text>
            )}

            {item.disabled && (
                <Text color="gray"> (disabled)</Text>
            )}
        </Box>
    );
}
```


### ActionList

```typescript
// src/cli/components/lists/ActionList.tsx

import React from 'react';
import { Box, Text } from 'ink';

export interface Action {
    key: string;
    label: string;
    description?: string;
    disabled?: boolean;
}

export interface ActionListProps {
    actions: Action[];
    direction?: 'row' | 'column';
}

export function ActionList({ actions, direction = 'row' }: ActionListProps) {

    return (
        <Box flexDirection={direction} gap={direction === 'row' ? 2 : 0}>
            {actions.map(action => (

                <Box key={action.key}>
                    <Text
                        color={action.disabled ? 'gray' : 'yellow'}
                        dimColor={action.disabled}
                    >
                        [{action.key}]
                    </Text>
                    <Text color={action.disabled ? 'gray' : undefined}>
                        {action.label}
                    </Text>

                    {action.description && direction === 'column' && (
                        <Text color="gray"> - {action.description}</Text>
                    )}
                </Box>
            ))}
        </Box>
    );
}
```


### StatusList

```typescript
// src/cli/components/lists/StatusList.tsx

import React from 'react';
import { Box, Text } from 'ink';

export interface StatusItem {
    key: string;
    label: string;
    status: 'success' | 'pending' | 'failed' | 'skipped' | 'running';
    detail?: string;
}

export interface StatusListProps {
    items: StatusItem[];
    showDetail?: boolean;
}

const STATUS_ICONS: Record<StatusItem['status'], { icon: string; color: string }> = {
    success: { icon: '\u2713', color: 'green' },
    pending: { icon: '\u25cb', color: 'gray' },
    failed: { icon: '\u2717', color: 'red' },
    skipped: { icon: '\u25cb', color: 'yellow' },
    running: { icon: '\u25cf', color: 'cyan' },
};

export function StatusList({ items, showDetail = true }: StatusListProps) {

    return (
        <Box flexDirection="column">
            {items.map(item => {

                const { icon, color } = STATUS_ICONS[item.status];

                return (
                    <Box key={item.key}>
                        <Text color={color}>{icon} </Text>
                        <Text>{item.label}</Text>

                        {showDetail && item.detail && (
                            <Text color="gray"> ({item.detail})</Text>
                        )}
                    </Box>
                );
            })}
        </Box>
    );
}
```


## Form Components


### TextInput

```typescript
// src/cli/components/forms/TextInput.tsx

import React from 'react';
import { Box, Text } from 'ink';
import InkTextInput from 'ink-text-input';

export interface TextInputProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    onSubmit?: (value: string) => void;
    placeholder?: string;
    focus?: boolean;
    error?: string;
}

export function TextInput({
    label,
    value,
    onChange,
    onSubmit,
    placeholder,
    focus = true,
    error
}: TextInputProps) {

    return (
        <Box flexDirection="column">

            <Box>
                <Text>{label}: </Text>
                <InkTextInput
                    value={value}
                    onChange={onChange}
                    onSubmit={onSubmit}
                    placeholder={placeholder}
                    focus={focus}
                />
            </Box>

            {error && (
                <Text color="red">  {error}</Text>
            )}

        </Box>
    );
}
```


### PasswordInput

```typescript
// src/cli/components/forms/PasswordInput.tsx

import React from 'react';
import { Box, Text } from 'ink';
import InkTextInput from 'ink-text-input';

export interface PasswordInputProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    onSubmit?: (value: string) => void;
    focus?: boolean;
    showLength?: boolean;
}

export function PasswordInput({
    label,
    value,
    onChange,
    onSubmit,
    focus = true,
    showLength = true
}: PasswordInputProps) {

    const masked = '*'.repeat(value.length);

    return (
        <Box>
            <Text>{label}: </Text>
            <InkTextInput
                value={value}
                onChange={onChange}
                onSubmit={onSubmit}
                focus={focus}
                mask="*"
            />

            {showLength && value.length > 0 && (
                <Text color="gray"> ({value.length} chars)</Text>
            )}
        </Box>
    );
}
```


### SelectInput

```typescript
// src/cli/components/forms/SelectInput.tsx

import React from 'react';
import { Box, Text } from 'ink';
import InkSelectInput from 'ink-select-input';

export interface SelectOption<T = string> {
    label: string;
    value: T;
}

export interface SelectInputProps<T> {
    label: string;
    options: Array<SelectOption<T>>;
    onSelect: (option: SelectOption<T>) => void;
    initialIndex?: number;
}

export function SelectInput<T>({
    label,
    options,
    onSelect,
    initialIndex = 0
}: SelectInputProps<T>) {

    return (
        <Box flexDirection="column">

            <Text>{label}:</Text>

            <Box marginLeft={2}>
                <InkSelectInput
                    items={options}
                    onSelect={onSelect}
                    initialIndex={initialIndex}
                />
            </Box>

        </Box>
    );
}
```


### Checkbox

```typescript
// src/cli/components/forms/Checkbox.tsx

import React from 'react';
import { Box, Text, useInput } from 'ink';

export interface CheckboxProps {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    focus?: boolean;
}

export function Checkbox({
    label,
    checked,
    onChange,
    focus = false
}: CheckboxProps) {

    useInput((input, key) => {

        if (focus && (input === ' ' || key.return)) {

            onChange(!checked);
        }
    });

    const box = checked ? '[x]' : '[ ]';
    const color = focus ? 'cyan' : undefined;

    return (
        <Box>
            <Text color={color}>{box} {label}</Text>
        </Box>
    );
}
```


### Form

```typescript
// src/cli/components/forms/Form.tsx

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

export interface FormField {
    key: string;
    label: string;
    type: 'text' | 'password' | 'select' | 'checkbox';
    required?: boolean;
    options?: Array<{ label: string; value: string }>;
    defaultValue?: any;
    validate?: (value: any) => string | null;
}

export interface FormProps {
    fields: FormField[];
    onSubmit: (values: Record<string, any>) => void;
    onCancel?: () => void;
    submitLabel?: string;
}

export function Form({
    fields,
    onSubmit,
    onCancel,
    submitLabel = 'Submit'
}: FormProps) {

    const [currentField, setCurrentField] = useState(0);
    const [values, setValues] = useState<Record<string, any>>(() => {

        const initial: Record<string, any> = {};

        for (const field of fields) {

            initial[field.key] = field.defaultValue ?? (field.type === 'checkbox' ? false : '');
        }

        return initial;
    });
    const [errors, setErrors] = useState<Record<string, string>>({});

    const validateAll = useCallback(() => {

        const newErrors: Record<string, string> = {};
        let hasErrors = false;

        for (const field of fields) {

            const value = values[field.key];

            if (field.required && !value) {

                newErrors[field.key] = `${field.label} is required`;
                hasErrors = true;
            }
            else if (field.validate) {

                const error = field.validate(value);

                if (error) {

                    newErrors[field.key] = error;
                    hasErrors = true;
                }
            }
        }

        setErrors(newErrors);
        return !hasErrors;
    }, [fields, values]);

    const handleSubmit = useCallback(() => {

        if (validateAll()) {

            onSubmit(values);
        }
    }, [validateAll, onSubmit, values]);

    useInput((input, key) => {

        if (key.escape && onCancel) {

            onCancel();
            return;
        }

        if (key.upArrow && currentField > 0) {

            setCurrentField(prev => prev - 1);
        }

        if (key.downArrow && currentField < fields.length) {

            setCurrentField(prev => prev + 1);
        }

        // Submit on last field + down or explicit enter on submit button
        if (currentField === fields.length && key.return) {

            handleSubmit();
        }
    });

    return (
        <Box flexDirection="column" gap={1}>

            {fields.map((field, index) => (

                <FormFieldRenderer
                    key={field.key}
                    field={field}
                    value={values[field.key]}
                    onChange={(value) => setValues(prev => ({ ...prev, [field.key]: value }))}
                    error={errors[field.key]}
                    focus={currentField === index}
                />
            ))}

            <Box marginTop={1}>
                <Text
                    color={currentField === fields.length ? 'cyan' : 'gray'}
                    bold={currentField === fields.length}
                >
                    {currentField === fields.length ? '> ' : '  '}
                    [{submitLabel}]
                </Text>
            </Box>

        </Box>
    );
}

interface FormFieldRendererProps {
    field: FormField;
    value: any;
    onChange: (value: any) => void;
    error?: string;
    focus: boolean;
}

function FormFieldRenderer({
    field,
    value,
    onChange,
    error,
    focus
}: FormFieldRendererProps) {

    const prefix = focus ? '> ' : '  ';

    // Simplified - in real implementation, render appropriate input type
    return (
        <Box flexDirection="column">
            <Box>
                <Text color={focus ? 'cyan' : undefined}>
                    {prefix}{field.label}:{' '}
                </Text>
                <Text>{String(value)}</Text>
            </Box>

            {error && (
                <Text color="red">    {error}</Text>
            )}
        </Box>
    );
}
```


## Feedback Components


### ProgressBar

```typescript
// src/cli/components/feedback/ProgressBar.tsx

import React from 'react';
import { Box, Text } from 'ink';

export interface ProgressBarProps {
    current: number;
    total: number;
    label?: string;
    width?: number;
    showPercentage?: boolean;
    showCount?: boolean;
}

export function ProgressBar({
    current,
    total,
    label,
    width = 20,
    showPercentage = true,
    showCount = true
}: ProgressBarProps) {

    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;

    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);

    return (
        <Box flexDirection="column">

            {label && (
                <Text>{label}</Text>
            )}

            <Box>
                <Text color="green">{bar}</Text>

                {showPercentage && (
                    <Text color="gray"> {percentage}%</Text>
                )}

                {showCount && (
                    <Text color="gray"> ({current}/{total})</Text>
                )}
            </Box>

        </Box>
    );
}
```


### Spinner

```typescript
// src/cli/components/feedback/Spinner.tsx

import React from 'react';
import { Box, Text } from 'ink';
import InkSpinner from 'ink-spinner';

export interface SpinnerProps {
    label?: string;
    type?: 'dots' | 'line' | 'arc';
}

export function Spinner({ label, type = 'dots' }: SpinnerProps) {

    return (
        <Box>
            <Text color="cyan">
                <InkSpinner type={type} />
            </Text>

            {label && (
                <Text> {label}</Text>
            )}
        </Box>
    );
}
```


### Alert

```typescript
// src/cli/components/feedback/Alert.tsx

import React from 'react';
import { Box, Text } from 'ink';

export type AlertType = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps {
    type: AlertType;
    title?: string;
    message: string;
}

const ALERT_STYLES: Record<AlertType, { icon: string; color: string }> = {
    info: { icon: '\u2139', color: 'blue' },
    success: { icon: '\u2713', color: 'green' },
    warning: { icon: '\u26a0', color: 'yellow' },
    error: { icon: '\u2717', color: 'red' },
};

export function Alert({ type, title, message }: AlertProps) {

    const { icon, color } = ALERT_STYLES[type];

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={color}
            paddingX={1}
        >
            <Box>
                <Text color={color} bold>
                    {icon} {title ?? type.toUpperCase()}
                </Text>
            </Box>

            <Text>{message}</Text>
        </Box>
    );
}
```


### Toast

```typescript
// src/cli/components/feedback/Toast.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

export interface ToastProps {
    message: string;
    type?: 'info' | 'success' | 'error';
    duration?: number;
    onDismiss?: () => void;
}

export function Toast({
    message,
    type = 'info',
    duration = 3000,
    onDismiss
}: ToastProps) {

    const [visible, setVisible] = useState(true);

    useEffect(() => {

        const timer = setTimeout(() => {

            setVisible(false);
            onDismiss?.();
        }, duration);

        return () => clearTimeout(timer);
    }, [duration, onDismiss]);

    if (!visible) return null;

    const colors: Record<string, string> = {
        info: 'blue',
        success: 'green',
        error: 'red',
    };

    return (
        <Box
            position="absolute"
            marginTop={-3}
            paddingX={1}
            borderStyle="round"
            borderColor={colors[type]}
        >
            <Text color={colors[type]}>{message}</Text>
        </Box>
    );
}
```


## Dialog Components


### Confirm

```typescript
// src/cli/components/dialogs/Confirm.tsx

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface ConfirmProps {
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    confirmLabel?: string;
    cancelLabel?: string;
}

export function Confirm({
    message,
    onConfirm,
    onCancel,
    confirmLabel = 'Yes',
    cancelLabel = 'No'
}: ConfirmProps) {

    const [selected, setSelected] = useState<'confirm' | 'cancel'>('cancel');

    useInput((input, key) => {

        if (key.leftArrow || key.rightArrow || input === 'y' || input === 'n') {

            if (input === 'y') {

                onConfirm();
                return;
            }

            if (input === 'n') {

                onCancel();
                return;
            }

            setSelected(prev => prev === 'confirm' ? 'cancel' : 'confirm');
        }

        if (key.return) {

            if (selected === 'confirm') {

                onConfirm();
            }
            else {

                onCancel();
            }
        }

        if (key.escape) {

            onCancel();
        }
    });

    return (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>

            <Text>{message}</Text>

            <Box marginTop={1} gap={2}>
                <Text
                    color={selected === 'confirm' ? 'green' : 'gray'}
                    bold={selected === 'confirm'}
                >
                    {selected === 'confirm' ? '>' : ' '} [{confirmLabel}]
                </Text>

                <Text
                    color={selected === 'cancel' ? 'red' : 'gray'}
                    bold={selected === 'cancel'}
                >
                    {selected === 'cancel' ? '>' : ' '} [{cancelLabel}]
                </Text>
            </Box>

        </Box>
    );
}
```


### ProtectedConfirm

```typescript
// src/cli/components/dialogs/ProtectedConfirm.tsx

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import InkTextInput from 'ink-text-input';

export interface ProtectedConfirmProps {
    configName: string;
    action: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ProtectedConfirm({
    configName,
    action,
    onConfirm,
    onCancel
}: ProtectedConfirmProps) {

    const [input, setInput] = useState('');
    const expectedInput = `yes-${configName}`;

    const handleSubmit = () => {

        if (input === expectedInput) {

            onConfirm();
        }
    };

    useInput((_, key) => {

        if (key.escape) {

            onCancel();
        }
    });

    return (
        <Box
            flexDirection="column"
            borderStyle="double"
            borderColor="red"
            paddingX={2}
            paddingY={1}
        >
            <Text color="red" bold>
                {'\u26a0'} Protected Configuration
            </Text>

            <Box marginTop={1} flexDirection="column">
                <Text>
                    You are about to <Text bold>{action}</Text> on protected config{' '}
                    <Text color="yellow" bold>{configName}</Text>.
                </Text>

                <Text marginTop={1}>
                    Type <Text color="cyan" bold>{expectedInput}</Text> to confirm:
                </Text>
            </Box>

            <Box marginTop={1}>
                <Text>&gt; </Text>
                <InkTextInput
                    value={input}
                    onChange={setInput}
                    onSubmit={handleSubmit}
                />
            </Box>

            {input.length > 0 && input !== expectedInput && (
                <Text color="red" marginTop={1}>
                    Input does not match. Press Esc to cancel.
                </Text>
            )}

        </Box>
    );
}
```


### HelpOverlay

```typescript
// src/cli/components/dialogs/HelpOverlay.tsx

import React from 'react';
import { Box, Text, useInput } from 'ink';

export interface HelpOverlayProps {
    onClose: () => void;
}

export function HelpOverlay({ onClose }: HelpOverlayProps) {

    useInput((input, key) => {

        if (key.escape || input === '?' || input === 'q') {

            onClose();
        }
    });

    return (
        <Box
            flexDirection="column"
            borderStyle="double"
            borderColor="cyan"
            paddingX={2}
            paddingY={1}
            position="absolute"
            marginLeft={5}
            marginTop={3}
        >
            <Text bold color="cyan">Keyboard Shortcuts</Text>

            <Box marginTop={1} flexDirection="column">
                <HelpRow keys="Tab" description="Next section" />
                <HelpRow keys="Shift+Tab" description="Previous section" />
                <HelpRow keys="Esc" description="Go back / Cancel" />
                <HelpRow keys="Enter" description="Select / Confirm" />
                <HelpRow keys="\u2191 / \u2193" description="Navigate list" />
                <HelpRow keys="?" description="Toggle help" />
                <HelpRow keys="q" description="Quit" />
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text bold>List Actions</Text>
                <HelpRow keys="a" description="Add new" />
                <HelpRow keys="e" description="Edit selected" />
                <HelpRow keys="d" description="Delete selected" />
            </Box>

            <Text marginTop={1} color="gray">
                Press Esc or ? to close
            </Text>

        </Box>
    );
}

function HelpRow({ keys, description }: { keys: string; description: string }) {

    return (
        <Box>
            <Box width={15}>
                <Text color="yellow">{keys}</Text>
            </Box>
            <Text>{description}</Text>
        </Box>
    );
}
```


## Status Components


### Badge

```typescript
// src/cli/components/status/Badge.tsx

import React from 'react';
import { Text } from 'ink';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

export interface BadgeProps {
    label: string;
    variant?: BadgeVariant;
}

const BADGE_COLORS: Record<BadgeVariant, { bg: string; fg: string }> = {
    default: { bg: 'gray', fg: 'white' },
    success: { bg: 'green', fg: 'white' },
    warning: { bg: 'yellow', fg: 'black' },
    error: { bg: 'red', fg: 'white' },
    info: { bg: 'blue', fg: 'white' },
};

export function Badge({ label, variant = 'default' }: BadgeProps) {

    const { bg, fg } = BADGE_COLORS[variant];

    return (
        <Text backgroundColor={bg} color={fg}>
            {` ${label} `}
        </Text>
    );
}
```


### LockStatus

```typescript
// src/cli/components/status/LockStatus.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { useLockStatus } from '../../hooks/useLockStatus';
import { Badge } from './Badge';

export interface LockStatusProps {
    configName: string;
}

export function LockStatus({ configName }: LockStatusProps) {

    const status = useLockStatus(configName);

    if (!status.locked) {

        return (
            <Box>
                <Badge label="UNLOCKED" variant="success" />
            </Box>
        );
    }

    const isExpired = status.expiresAt && new Date() > status.expiresAt;

    return (
        <Box flexDirection="column">

            <Box gap={1}>
                <Badge
                    label={isExpired ? 'EXPIRED' : 'LOCKED'}
                    variant={isExpired ? 'warning' : 'error'}
                />
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text color="gray">Holder: {status.holder}</Text>

                {status.heldSince && (
                    <Text color="gray">Since: {status.heldSince.toISOString()}</Text>
                )}

                {status.expiresAt && (
                    <Text color="gray">Expires: {status.expiresAt.toISOString()}</Text>
                )}
            </Box>

        </Box>
    );
}
```


### ConnectionStatus

```typescript
// src/cli/components/status/ConnectionStatus.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { Badge } from './Badge';

export interface ConnectionStatusProps {
    connected: boolean;
    dialect?: string;
    database?: string;
}

export function ConnectionStatus({
    connected,
    dialect,
    database
}: ConnectionStatusProps) {

    return (
        <Box gap={1}>
            <Badge
                label={connected ? 'CONNECTED' : 'DISCONNECTED'}
                variant={connected ? 'success' : 'error'}
            />

            {connected && dialect && (
                <Text color="gray">({dialect})</Text>
            )}

            {connected && database && (
                <Text color="gray">- {database}</Text>
            )}
        </Box>
    );
}
```


## Public Exports

```typescript
// src/cli/components/index.ts

// Layout
export { Header } from './layout/Header';
export { Footer } from './layout/Footer';
export { Panel } from './layout/Panel';
export { Divider } from './layout/Divider';

// Lists
export { SelectList } from './lists/SelectList';
export type { SelectListItem, SelectListProps } from './lists/SelectList';
export { ActionList } from './lists/ActionList';
export type { Action, ActionListProps } from './lists/ActionList';
export { StatusList } from './lists/StatusList';
export type { StatusItem, StatusListProps } from './lists/StatusList';

// Forms
export { TextInput } from './forms/TextInput';
export { PasswordInput } from './forms/PasswordInput';
export { SelectInput } from './forms/SelectInput';
export { Checkbox } from './forms/Checkbox';
export { Form } from './forms/Form';
export type { FormField, FormProps } from './forms/Form';

// Feedback
export { ProgressBar } from './feedback/ProgressBar';
export { Spinner } from './feedback/Spinner';
export { Alert } from './feedback/Alert';
export type { AlertType } from './feedback/Alert';
export { Toast } from './feedback/Toast';

// Dialogs
export { Confirm } from './dialogs/Confirm';
export { ProtectedConfirm } from './dialogs/ProtectedConfirm';
export { HelpOverlay } from './dialogs/HelpOverlay';

// Status
export { Badge } from './status/Badge';
export type { BadgeVariant } from './status/Badge';
export { LockStatus } from './status/LockStatus';
export { ConnectionStatus } from './status/ConnectionStatus';
```


## Usage Examples


### List with Selection

```typescript
import { SelectList } from './components';

function ConfigListScreen() {

    const configs = [
        { key: 'dev', label: 'dev', value: 'dev', icon: '\u2713', description: 'active' },
        { key: 'staging', label: 'staging', value: 'staging' },
        { key: 'prod', label: 'production', value: 'prod', icon: '\ud83d\udd12' },
    ];

    return (
        <SelectList
            items={configs}
            onSelect={(item) => navigate('config/edit', { name: item.value })}
        />
    );
}
```


### Form with Validation

```typescript
import { Form } from './components';

function ConfigAddScreen() {

    const fields = [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'host', label: 'Host', type: 'text', defaultValue: 'localhost' },
        { key: 'port', label: 'Port', type: 'text', defaultValue: '5432' },
        { key: 'database', label: 'Database', type: 'text', required: true },
        { key: 'protected', label: 'Protected', type: 'checkbox' },
    ];

    return (
        <Form
            fields={fields}
            onSubmit={handleCreate}
            onCancel={() => navigate('config')}
            submitLabel="Create"
        />
    );
}
```


### Progress Indicator

```typescript
import { ProgressBar, Spinner } from './components';
import { useProgress } from '../hooks/useProgress';

function BuildScreen() {

    const progress = useProgress();

    if (!progress) {

        return <Spinner label="Starting build..." />;
    }

    return (
        <ProgressBar
            current={progress.current}
            total={progress.total}
            label={progress.message}
        />
    );
}
```


### Protected Action

```typescript
import { ProtectedConfirm } from './components';

function DestroyScreen() {

    const [showConfirm, setShowConfirm] = useState(true);

    if (showConfirm && config.protected) {

        return (
            <ProtectedConfirm
                configName={config.name}
                action="destroy database"
                onConfirm={handleDestroy}
                onCancel={() => back()}
            />
        );
    }

    return <DestroyInProgress />;
}
```
