/**
 * SecretValueForm - form for setting secret values.
 *
 * Used by SecretSetScreen for creating/updating actual secret values.
 * The screen provides context-specific data and callbacks.
 */
import { useMemo } from 'react';
import { Box, Text } from 'ink';

import type { ReactElement } from 'react';
import type { FormField, FormValues } from '../forms/index.js';
import type { StageSecret } from './types.js';

import { Form } from '../forms/index.js';

/**
 * Props for SecretValueForm.
 */
export interface SecretValueFormProps {
    /** Secret key if editing (undefined/null for add mode) */
    secretKey?: string | null;

    /** Secret definition if this is a required secret */
    secretDefinition?: StageSecret | null;

    /** List of unset required secrets (for suggestions in add mode) */
    unsetRequired?: StageSecret[];

    /** Whether the secret already exists (show overwrite warning) */
    secretExists?: boolean;

    /** Called with key and value */
    onSubmit: (key: string, value: string) => void | Promise<void>;

    /** Called when user cancels */
    onCancel: () => void;

    /** Loading state */
    busy?: boolean;

    /** Error message */
    error?: string | null;

    /** Focus label */
    focusLabel?: string;
}

/**
 * SecretValueForm component.
 *
 * Renders a form for setting secret values with appropriate input types.
 *
 * @example
 * ```tsx
 * <SecretValueForm
 *     secretKey="DB_PASSWORD"
 *     secretDefinition={passwordSecret}
 *     secretExists={true}
 *     onSubmit={handleSubmit}
 *     onCancel={handleCancel}
 *     busy={isSaving}
 *     error={saveError}
 *     focusLabel="SecretSetForm"
 * />
 * ```
 */
export function SecretValueForm({
    secretKey,
    secretDefinition,
    unsetRequired = [],
    secretExists = false,
    onSubmit,
    onCancel,
    busy = false,
    error = null,
    focusLabel = 'SecretValueForm',
}: SecretValueFormProps): ReactElement {

    const isAddMode = !secretKey;

    // Build form fields
    const fields = useMemo<FormField[]>(() => {

        const result: FormField[] = [];

        // If no key provided, ask for key name
        if (isAddMode) {

            // Build placeholder with suggestions from unset required secrets
            let placeholder = 'e.g., MY_SECRET_KEY';

            if (unsetRequired.length > 0) {

                const suggestions = unsetRequired
                    .slice(0, 3)
                    .map((s) => s.key)
                    .join(', ');
                placeholder = suggestions + (unsetRequired.length > 3 ? '...' : '');

            }

            result.push({
                key: 'secretKey',
                label: 'Secret Key',
                type: 'text',
                required: true,
                placeholder,
                validate: (v) => {

                    const val = String(v).trim();

                    if (!val) return 'Key is required';

                    // Relaxed validation - allow lowercase but warn format
                    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(val)) {

                        return 'Key must start with letter, contain only letters, numbers, underscores';

                    }

                    return undefined;

                },
            });

        }

        // Value field - use password type for sensitive secrets
        const isPasswordType =
            secretDefinition?.type === 'password' || secretDefinition?.type === 'api_key';

        result.push({
            key: 'value',
            label: 'Value',
            type: isPasswordType ? 'password' : 'text',
            required: true,
            placeholder: secretDefinition?.description ?? 'Enter secret value',
            validate: (v) => {

                const val = String(v).trim();

                if (!val) return 'Value is required';

                // Type-specific validation
                if (secretDefinition?.type === 'connection_string') {

                    // Basic URI validation
                    try {

                        new URL(val);

                    }
                    catch {

                        return 'Invalid connection string (must be a valid URI)';

                    }

                }

                return undefined;

            },
        });

        return result;

    }, [isAddMode, unsetRequired, secretDefinition]);

    // Handle form submission
    const handleSubmit = (values: FormValues) => {

        // Determine the key to use
        let key = secretKey;

        if (!key) {

            key = String(values['secretKey'] ?? '').trim();

        }

        if (!key) return;

        const value = String(values['value'] ?? '').trim();

        onSubmit(key, value);

    };

    return (
        <Box flexDirection="column" gap={1}>
            {/* Required secret description */}
            {secretDefinition?.description && <Text dimColor>{secretDefinition.description}</Text>}

            {/* Overwrite warning */}
            {secretExists && <Text color="yellow">This will overwrite the existing value.</Text>}

            {/* Show unset required secrets as suggestions */}
            {isAddMode && unsetRequired.length > 0 && (
                <Box flexDirection="column">
                    <Text dimColor>Missing required secrets:</Text>
                    <Box gap={1} flexWrap="wrap">
                        {unsetRequired.map((s) => (
                            <Text key={s.key} color="yellow">
                                {s.key}
                            </Text>
                        ))}
                    </Box>
                </Box>
            )}

            <Form
                fields={fields}
                onSubmit={handleSubmit}
                onCancel={onCancel}
                submitLabel="Save"
                focusLabel={focusLabel}
                busy={busy}
                busyLabel="Saving secret..."
                statusError={error ?? undefined}
            />
        </Box>
    );

}
