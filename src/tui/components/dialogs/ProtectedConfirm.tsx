/**
 * ProtectedConfirm component - type-to-confirm for protected configs.
 *
 * Requires the user to type a specific phrase (e.g., "yes-production")
 * to confirm destructive actions on protected configurations.
 *
 * @example
 * ```tsx
 * <ProtectedConfirm
 *     configName="production"
 *     action="delete"
 *     onConfirm={() => deleteConfig('production')}
 *     onCancel={() => setShowConfirm(false)}
 * />
 * ```
 */
import { useState, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';

import type { ReactElement } from 'react';

import { useFocusScope } from '../../focus.js';
import { Panel } from '../layout/Panel.js';

/**
 * Props for ProtectedConfirm component.
 */
export interface ProtectedConfirmProps {
    /** Name of the protected configuration */
    configName: string;

    /** Action being performed (for display) */
    action: string;

    /** Callback when user confirms with correct phrase */
    onConfirm: () => void;

    /** Callback when user cancels */
    onCancel: () => void;

    /** Focus scope label */
    focusLabel?: string;

    /** External focus control - if provided, skips useFocusScope */
    isFocused?: boolean;
}

/**
 * ProtectedConfirm component.
 *
 * A type-to-confirm dialog that prevents accidental destructive actions.
 * User must type "yes-{configName}" to confirm.
 */
export function ProtectedConfirm({
    configName,
    action,
    onConfirm,
    onCancel,
    focusLabel = 'ProtectedConfirm',
    isFocused: externalFocused,
}: ProtectedConfirmProps): ReactElement {

    const hasExternalFocus = externalFocused !== undefined;
    const internalFocus = useFocusScope({
        label: focusLabel,
        skip: hasExternalFocus,
    });
    const isFocused = hasExternalFocus ? externalFocused : internalFocus.isFocused;

    const confirmPhrase = `yes-${configName}`;
    const [input, setInput] = useState('');
    const [error, setError] = useState<string | null>(null);

    // Stable onChange handler for TextInput (prevents infinite loop)
    const handleChangeRef = useRef((value: string) => {

        setInput(value);
        setError(null);

    });
    const handleChange = handleChangeRef.current;

    // Handle submit
    const handleSubmit = useCallback(() => {

        if (input === confirmPhrase) {

            onConfirm();

        }
        else {

            setError(`Type "${confirmPhrase}" to confirm`);

        }

    }, [input, confirmPhrase, onConfirm]);

    // Keyboard handling
    useInput((_, key) => {

        if (!isFocused) return;

        if (key.escape) {

            if (input) {

                setInput('');
                setError(null);

            }
            else {

                onCancel();

            }

        }

        if (key.return) {

            handleSubmit();

        }

    });

    return (
        <Panel title="Protected Configuration" borderColor="red" paddingX={2} paddingY={1}>
            <Box flexDirection="column" gap={1}>
                <Text>
                    You are about to{' '}
                    <Text color="red" bold>
                        {action}
                    </Text>{' '}
                    the protected configuration{' '}
                    <Text color="yellow" bold>
                        {configName}
                    </Text>
                    .
                </Text>

                <Text>
                    Type{' '}
                    <Text color="cyan" bold>
                        {confirmPhrase}
                    </Text>{' '}
                    to confirm:
                </Text>

                <Box marginTop={1}>
                    <TextInput
                        placeholder={confirmPhrase}
                        defaultValue={input}
                        onChange={handleChange}
                        isDisabled={!isFocused}
                    />
                </Box>

                {error && <Text color="red">{error}</Text>}

                <Box marginTop={1} gap={2}>
                    <Text dimColor>[Enter] Confirm</Text>
                    <Text dimColor>[Esc] Cancel</Text>
                </Box>
            </Box>
        </Panel>
    );

}
