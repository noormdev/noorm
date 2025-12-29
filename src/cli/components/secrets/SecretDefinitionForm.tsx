/**
 * SecretDefinitionForm - form for adding/editing secret definitions.
 *
 * Used by both universal and stage-specific secret screens.
 * The screen provides context-specific callbacks and data.
 */
import { useMemo } from 'react';

import type { ReactElement } from 'react';
import type { FormField, FormValues } from '../forms/index.js';
import type { StageSecret, SecretType } from './types.js';

import { Form } from '../forms/index.js';
import { SECRET_TYPE_OPTIONS, validateSecretKey, checkDuplicateKey } from './types.js';

/**
 * Props for SecretDefinitionForm.
 */
export interface SecretDefinitionFormProps {
    /** Existing secret for edit mode (undefined/null for add mode) */
    existingSecret?: StageSecret | null;

    /** Keys that already exist (for duplicate validation) */
    existingKeys: string[];

    /** Whether this is add mode (no existingSecret) */
    isAddMode: boolean;

    /** Called with validated secret data */
    onSubmit: (secret: StageSecret) => void | Promise<void>;

    /** Called when user cancels */
    onCancel: () => void;

    /** Loading state */
    busy?: boolean;

    /** Error message to display */
    error?: string | null;

    /** Focus label for the form */
    focusLabel?: string;
}

/**
 * SecretDefinitionForm component.
 *
 * Renders a form with fields for key, type, description, and required flag.
 * Handles key validation and duplicate checking.
 *
 * @example
 * ```tsx
 * <SecretDefinitionForm
 *     existingSecret={secret}
 *     existingKeys={allKeys}
 *     isAddMode={false}
 *     onSubmit={handleSubmit}
 *     onCancel={handleCancel}
 *     busy={isSaving}
 *     error={saveError}
 *     focusLabel="EditSecretForm"
 * />
 * ```
 */
export function SecretDefinitionForm({
    existingSecret,
    existingKeys,
    isAddMode,
    onSubmit,
    onCancel,
    busy = false,
    error = null,
    focusLabel = 'SecretDefinitionForm',
}: SecretDefinitionFormProps): ReactElement {

    // Build form fields
    const fields: FormField[] = useMemo(() => {

        return [
            {
                key: 'key',
                label: 'Secret Key',
                type: 'text',
                required: true,
                defaultValue: existingSecret?.key ?? '',
                placeholder: 'e.g., DB_PASSWORD, api_key',
                validate: (value) => {

                    if (typeof value !== 'string') return 'Key is required';

                    const trimmed = value.trim();

                    // Basic validation
                    const keyError = validateSecretKey(trimmed);
                    if (keyError) return keyError;

                    // Check for duplicates in add mode
                    if (isAddMode) {

                        const duplicateError = checkDuplicateKey(trimmed, existingKeys);
                        if (duplicateError) return duplicateError;

                    }

                    return undefined;

                },
            },
            {
                key: 'type',
                label: 'Secret Type',
                type: 'select',
                required: true,
                options: [...SECRET_TYPE_OPTIONS],
                defaultValue: existingSecret?.type ?? 'string',
            },
            {
                key: 'description',
                label: 'Description',
                type: 'text',
                defaultValue: existingSecret?.description ?? '',
                placeholder: 'e.g., Database password for production',
            },
            {
                key: 'required',
                label: 'Required',
                type: 'checkbox',
                defaultValue: existingSecret?.required !== false,
            },
        ];

    }, [existingSecret, isAddMode, existingKeys]);

    // Handle form submission
    const handleSubmit = (values: FormValues) => {

        const key = String(values['key']).trim();

        const secret: StageSecret = {
            key,
            type: String(values['type']) as SecretType,
            description: values['description'] ? String(values['description']) : undefined,
            required: Boolean(values['required']),
        };

        onSubmit(secret);

    };

    return (
        <Form
            fields={fields}
            onSubmit={handleSubmit}
            onCancel={onCancel}
            submitLabel={isAddMode ? 'Create' : 'Save Changes'}
            focusLabel={focusLabel}
            busy={busy}
            busyLabel="Saving..."
            statusError={error ?? undefined}
        />
    );

}
