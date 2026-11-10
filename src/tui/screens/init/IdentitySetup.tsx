/**
 * Identity Setup screen.
 *
 * First-time setup for user identity. Pre-populates fields from system/git.
 *
 * Fields:
 * - Name (from git config or OS username, editable)
 * - Email (from git config, editable)
 * - Machine (from hostname, editable)
 * - OS (auto-detected, not editable)
 *
 * One panel, no spacer rows: the app shell leaves 20 rows on an 80x24
 * terminal, and anything taller pushes the action row out of the frame.
 */
import { useState, useEffect, useCallback } from 'react';
import type { ReactElement } from 'react';
import { Box, Text } from 'ink';

import { Panel } from '../../components/layout/index.js';
import { Form, type FormField, type FormValues } from '../../components/forms/index.js';
import { Spinner } from '../../components/feedback/index.js';
import { detectIdentityDefaults, type IdentityDefaults } from '../../../core/identity/index.js';

/**
 * Props for IdentitySetup.
 */
export interface IdentitySetupProps {
    /** Called when identity setup is complete */
    onComplete: (values: IdentitySetupValues) => void;

    /** Called when user cancels */
    onCancel: () => void;

    /** Whether this is regenerating an existing identity (changes UI text) */
    isRegeneration?: boolean;

    /** Why setup is being shown, when the user did not ask for it */
    reason?: string;

    /** Why the last attempt failed */
    error?: string;
}

/**
 * Values returned from identity setup.
 */
export interface IdentitySetupValues {
    name: string;
    email: string;
    machine: string;
    os: string;
}

/**
 * Identity setup component.
 *
 * Shows a form pre-populated with detected values.
 * User can edit name, email, and machine; OS is auto-detected.
 *
 * @example
 * <IdentitySetup onComplete={createIdentity} onCancel={back} reason="Saving a config needs an identity." />
 */
export function IdentitySetup({
    onComplete,
    onCancel,
    isRegeneration = false,
    reason,
    error,
}: IdentitySetupProps): ReactElement {

    // Note: No useFocusScope here - let the Form manage its own focus.
    // Parent focus scopes interfere with child focus due to React effect order.

    // Detected defaults
    const [defaults, setDefaults] = useState<IdentityDefaults | null>(null);
    const [loading, setLoading] = useState(true);

    // Detect defaults on mount
    useEffect(() => {

        const detected = detectIdentityDefaults();
        setDefaults(detected);
        setLoading(false);

    }, []);

    // Handle form submission
    const handleSubmit = useCallback(
        (values: FormValues) => {

            onComplete({
                name: values['name'] as string,
                email: values['email'] as string,
                machine: values['machine'] as string,
                os: defaults?.os ?? '',
            });

        },
        [defaults?.os, onComplete],
    );

    // Show loading while detecting defaults
    if (loading || !defaults) {

        return (
            <Box flexDirection="column" padding={1}>
                <Box>
                    <Spinner label="Detecting identity defaults..." />
                </Box>
            </Box>
        );

    }

    // Build form fields
    const fields: FormField[] = [
        {
            key: 'name',
            label: 'Name',
            type: 'text',
            defaultValue: defaults.name,
            required: true,
            placeholder: 'Your name',
        },
        {
            key: 'email',
            label: 'Email',
            type: 'text',
            defaultValue: defaults.email,
            required: true,
            placeholder: 'your@email.com',
            validate: (value: string | boolean) => {

                if (typeof value === 'string' && !value.includes('@')) {

                    return 'Invalid email address';

                }

            },
        },
        {
            key: 'machine',
            label: 'Machine',
            type: 'text',
            defaultValue: defaults.machine,
            required: true,
            placeholder: 'Machine name',
        },
    ];

    return (
        <Panel title={isRegeneration ? 'Regenerate Identity' : 'Welcome to noorm'} titleColor="cyan">
            {isRegeneration ? (
                <Box flexDirection="column" marginBottom={1}>
                    <Text color="yellow">You are regenerating your identity.</Text>
                </Box>
            ) : (
                <Box flexDirection="column" marginBottom={1}>
                    {reason && <Text>{reason}</Text>}
                    <Text>It is used for the audit trail and for sharing configs with teammates.</Text>
                </Box>
            )}

            <Form
                fields={fields}
                onSubmit={handleSubmit}
                onCancel={onCancel}
                submitLabel={isRegeneration ? 'Regenerate' : 'Continue'}
                statusError={error}
            />

            <Text dimColor>{'  '}OS: {defaults.os} (auto-detected)</Text>
        </Panel>
    );

}
