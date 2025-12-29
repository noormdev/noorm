/**
 * Confirm dialog component - Yes/No confirmation.
 *
 * Uses our focus stack with custom keyboard handling.
 * @inkjs/ui's ConfirmInput uses ink's internal focus, incompatible with our stack.
 *
 * @example
 * ```tsx
 * <Confirm
 *     message="Delete configuration 'production'?"
 *     onConfirm={() => deleteConfig('production')}
 *     onCancel={() => setShowConfirm(false)}
 * />
 * ```
 */
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';

import { useFocusScope } from '../../focus.js';
import { Panel } from '../layout/Panel.js';

/**
 * Props for Confirm component.
 */
export interface ConfirmProps {
    /** Confirmation message/question */
    message: string;

    /** Optional title for the dialog */
    title?: string;

    /** Callback when user confirms */
    onConfirm: () => void;

    /** Callback when user cancels */
    onCancel: () => void;

    /** Default choice */
    defaultChoice?: 'confirm' | 'cancel';

    /** Dialog variant affects border color */
    variant?: 'default' | 'danger' | 'warning';

    /** Focus scope label */
    focusLabel?: string;

    /** External focus control - if provided, skips useFocusScope */
    isFocused?: boolean;
}

// Border colors by variant
const borderColors: Record<string, string> = {
    default: 'cyan',
    danger: 'red',
    warning: 'yellow',
};

/**
 * Confirm dialog component.
 *
 * A modal confirmation dialog with Yes/No options.
 * Pushes to the focus stack on mount.
 */
export function Confirm({
    message,
    title = 'Confirm',
    onConfirm,
    onCancel,
    defaultChoice = 'confirm',
    variant = 'default',
    focusLabel = 'Confirm',
    isFocused: externalFocused,
}: ConfirmProps): ReactElement {

    const hasExternalFocus = externalFocused !== undefined;
    const internalFocus = useFocusScope({
        label: focusLabel,
        skip: hasExternalFocus,
    });
    const isFocused = hasExternalFocus ? externalFocused : internalFocus.isFocused;
    const [selected, setSelected] = useState<'yes' | 'no'>(
        defaultChoice === 'confirm' ? 'yes' : 'no',
    );

    useInput((input, key) => {

        if (!isFocused) return;

        // Y/y confirms
        if (input.toLowerCase() === 'y') {

            onConfirm();

            return;

        }

        // N/n cancels
        if (input.toLowerCase() === 'n') {

            onCancel();

            return;

        }

        // Arrow keys toggle selection
        if (key.leftArrow || key.rightArrow) {

            setSelected((s) => (s === 'yes' ? 'no' : 'yes'));

            return;

        }

        // Tab toggles selection
        if (key.tab) {

            setSelected((s) => (s === 'yes' ? 'no' : 'yes'));

            return;

        }

        // Enter confirms current selection
        if (key.return) {

            if (selected === 'yes') {

                onConfirm();

            }
            else {

                onCancel();

            }

            return;

        }

        // Escape cancels
        if (key.escape) {

            onCancel();

        }

    });

    return (
        <Panel title={title} borderColor={borderColors[variant]} paddingX={2} paddingY={1}>
            <Box flexDirection="column" gap={1}>
                <Text>{message}</Text>

                <Box gap={2}>
                    <Text
                        color={selected === 'yes' ? 'green' : undefined}
                        bold={selected === 'yes'}
                    >
                        {selected === 'yes' ? '❯ ' : '  '}
                        Yes (y)
                    </Text>
                    <Text color={selected === 'no' ? 'red' : undefined} bold={selected === 'no'}>
                        {selected === 'no' ? '❯ ' : '  '}
                        No (n)
                    </Text>
                </Box>
            </Box>
        </Panel>
    );

}
