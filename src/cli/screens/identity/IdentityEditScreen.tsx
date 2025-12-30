/**
 * IdentityEditScreen - edit identity details without regenerating keys.
 *
 * Allows updating name, email, and machine while keeping the existing keypair.
 * Identity hash will change if details change.
 *
 * Keyboard shortcuts:
 * - Tab/Up/Down: Navigate form
 * - Enter: Submit
 * - Esc: Cancel
 *
 * @example
 * ```bash
 * noorm identity:edit    # Opens this screen
 * ```
 */
import { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, useToast } from '../../components/index.js';
import { Form, type FormField, type FormValues } from '../../components/forms/index.js';
import { createIdentityForExistingKeys } from '../../../core/identity/index.js';
import { attempt } from '@logosdx/utils';


/**
 * IdentityEditScreen component.
 *
 * Edits identity details while preserving the existing keypair.
 */
export function IdentityEditScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { identity, hasIdentity, stateManager, refresh } = useAppContext();
    const { showToast } = useToast();

    // Note: No useFocusScope - let Form manage focus

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Build form fields with current values
    const fields: FormField[] = identity
        ? [
            {
                key: 'name',
                label: 'Name',
                type: 'text',
                defaultValue: identity.name,
                required: true,
                placeholder: 'Your name',
            },
            {
                key: 'email',
                label: 'Email',
                type: 'text',
                defaultValue: identity.email,
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
                defaultValue: identity.machine,
                required: true,
                placeholder: 'Machine name',
            },
        ]
        : [];

    // Handle form submission
    const handleSubmit = useCallback(
        async (values: FormValues) => {

            setSaving(true);
            setError(null);

            // Create new identity metadata with existing keys
            const [newIdentity, err] = await attempt(() =>
                createIdentityForExistingKeys({
                    name: values['name'] as string,
                    email: values['email'] as string,
                    machine: values['machine'] as string,
                }),
            );

            if (err) {

                setError(err instanceof Error ? err.message : String(err));
                setSaving(false);
                showToast({
                    message: 'Failed to update identity',
                    variant: 'error',
                });

                return;

            }

            if (!newIdentity) {

                setError('Could not load existing keys. You may need to regenerate your identity.');
                setSaving(false);

                return;

            }

            // Save to state
            const [, stateErr] = await attempt(async () => {

                await stateManager?.setIdentity(newIdentity);
                await refresh?.();

            });

            if (stateErr) {

                setError(stateErr instanceof Error ? stateErr.message : String(stateErr));
                setSaving(false);
                showToast({
                    message: 'Failed to save identity',
                    variant: 'error',
                });

                return;

            }

            showToast({
                message: 'Identity updated',
                variant: 'success',
            });
            back();

        },
        [stateManager, refresh, showToast, back],
    );

    // No identity
    if (!hasIdentity || !identity) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Edit Identity" borderColor="yellow" paddingX={2} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">No identity configured.</Text>
                        <Text dimColor>
                            Run <Text color="cyan">noorm init</Text> to set up your identity.
                        </Text>
                    </Box>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Saving state
    if (saving) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Edit Identity" paddingX={2} paddingY={1}>
                    <Spinner label="Saving changes..." />
                </Panel>
            </Box>
        );

    }

    return (
        <Box flexDirection="column" gap={1}>
            {error && (
                <Panel borderColor="red" paddingX={2} paddingY={1}>
                    <Text color="red">{error}</Text>
                </Panel>
            )}

            <Panel title="Edit Identity" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text dimColor>
                        Update your identity details. Your keypair will remain unchanged.
                    </Text>

                    <Box marginTop={1}>
                        <Form
                            fields={fields}
                            onSubmit={handleSubmit}
                            onCancel={back}
                            submitLabel="Save"
                        />
                    </Box>

                    {/* OS info (read-only) */}
                    <Box marginTop={1}>
                        <Text dimColor>
                            OS: {identity.os} <Text dimColor>(auto-detected)</Text>
                        </Text>
                    </Box>

                    <Box marginTop={1}>
                        <Text dimColor>
                            Note: If you change your details, your identity hash will change.
                        </Text>
                    </Box>
                </Box>
            </Panel>
        </Box>
    );

}
