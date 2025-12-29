/**
 * Identity Setup screen.
 *
 * First-time setup for user identity. Pre-populates fields from system/git.
 * Generates keypair on continue.
 *
 * Fields:
 * - Name (from git config or OS username, editable)
 * - Email (from git config, editable)
 * - Machine (from hostname, editable)
 * - OS (auto-detected, not editable)
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
 */
export function IdentitySetup({ onComplete, onCancel }: IdentitySetupProps): ReactElement {

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
        <Box flexDirection="column">
            {/* Welcome message */}
            <Panel title="Welcome to noorm" titleColor="cyan">
                <Box flexDirection="column" marginBottom={1}>
                    <Text>Let's set up your identity. This is used for:</Text>
                    <Box flexDirection="column" marginLeft={2} marginTop={1}>
                        <Text>
                            <Text dimColor>•</Text> Tracking who made changes (audit trail)
                        </Text>
                        <Text>
                            <Text dimColor>•</Text> Securely sharing configs with teammates
                        </Text>
                    </Box>
                </Box>

                {/* Detection source hints */}
                <Box flexDirection="column" marginBottom={1}>
                    <Text dimColor>We've pre-filled what we could detect:</Text>
                </Box>
            </Panel>

            {/* Form */}
            <Box marginTop={1}>
                <Form
                    fields={fields}
                    onSubmit={handleSubmit}
                    onCancel={onCancel}
                    submitLabel="Continue"
                />
            </Box>

            {/* Auto-detected OS info (read-only) */}
            <Box marginTop={1} flexDirection="column">
                <Text dimColor>
                    <Text>OS: </Text>
                    <Text>{defaults.os}</Text>
                    <Text dimColor> (auto-detected)</Text>
                </Text>
            </Box>

            {/* Info message */}
            <Box marginTop={1}>
                <Text dimColor>
                    On continue, we'll generate your keypair for secure config sharing.
                </Text>
            </Box>
        </Box>
    );

}
