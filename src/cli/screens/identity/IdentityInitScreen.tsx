/**
 * IdentityInitScreen - regenerate or create identity.
 *
 * Shows warning if regenerating existing identity, then displays
 * the identity setup form. Generates new keypair on completion.
 *
 * Flow:
 * 1. Warning (if existing identity) -> Confirm
 * 2. Form (IdentitySetup with isRegeneration)
 * 3. Processing (generate keypair)
 * 4. Success -> back to identity screen
 *
 * Keyboard shortcuts:
 * - Enter: Confirm warning
 * - Esc: Cancel
 *
 * @example
 * ```bash
 * noorm identity:init    # Opens this screen
 * ```
 */
import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, useToast } from '../../components/index.js';
import { IdentitySetup, type IdentitySetupValues } from '../init/IdentitySetup.js';
import { createCryptoIdentity } from '../../../core/identity/index.js';
import { attempt } from '@logosdx/utils';


/**
 * Step in the regeneration flow.
 */
type InitStep = 'warning' | 'form' | 'processing';


/**
 * IdentityInitScreen component.
 *
 * Handles identity creation/regeneration with confirmation flow.
 */
export function IdentityInitScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('IdentityInit');
    const { identity, hasIdentity, stateManager, refresh } = useAppContext();
    const { showToast } = useToast();

    // Determine initial step based on existing identity
    const [step, setStep] = useState<InitStep>(hasIdentity ? 'warning' : 'form');
    const [error, setError] = useState<string | null>(null);

    // Handle warning confirmation
    const handleConfirmWarning = useCallback(() => {

        setStep('form');

    }, []);

    // Handle form completion
    const handleFormComplete = useCallback(
        async (values: IdentitySetupValues) => {

            setStep('processing');
            setError(null);

            // Create new identity with new keypair
            const [result, err] = await attempt(() =>
                createCryptoIdentity({
                    name: values.name,
                    email: values.email,
                    machine: values.machine,
                }),
            );

            if (err) {

                setError(err instanceof Error ? err.message : String(err));
                setStep('form');
                showToast({
                    message: 'Failed to create identity',
                    variant: 'error',
                });

                return;

            }

            // Update state with new identity
            const [, stateErr] = await attempt(async () => {

                await stateManager?.setIdentity(result.identity);
                await refresh?.();

            });

            if (stateErr) {

                setError(stateErr instanceof Error ? stateErr.message : String(stateErr));
                setStep('form');
                showToast({
                    message: 'Failed to save identity',
                    variant: 'error',
                });

                return;

            }

            // Success
            showToast({
                message: hasIdentity ? 'Identity regenerated' : 'Identity created',
                variant: 'success',
            });
            back();

        },
        [stateManager, refresh, hasIdentity, showToast, back],
    );

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Keyboard input for warning step
    useInput(
        (input, key) => {

            if (!isFocused) return;
            if (step !== 'warning') return;

            if (key.escape) {

                back();

                return;

            }

            if (key.return) {

                handleConfirmWarning();

                return;

            }

        },
    );

    // Warning step
    if (step === 'warning') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Regenerate Identity" borderColor="yellow" paddingX={2} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">This will generate a new keypair.</Text>

                        <Box flexDirection="column" marginTop={1}>
                            <Text dimColor>Current identity:</Text>
                            <Box marginLeft={2} flexDirection="column">
                                <Text>
                                    {identity?.name} {'<'}
                                    {identity?.email}
                                    {'>'}
                                </Text>
                                <Text dimColor>
                                    {identity?.machine} ({identity?.os.split(' ')[0]})
                                </Text>
                            </Box>
                        </Box>

                        <Box flexDirection="column" marginTop={1}>
                            <Text>Consequences:</Text>
                            <Box marginLeft={2} flexDirection="column">
                                <Text dimColor>
                                    <Text color="yellow">•</Text> Existing encrypted configs will not
                                    decrypt
                                </Text>
                                <Text dimColor>
                                    <Text color="yellow">•</Text> Team members need your new public key
                                </Text>
                                <Text dimColor>
                                    <Text color="yellow">•</Text> Your identity hash may change
                                </Text>
                            </Box>
                        </Box>
                    </Box>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Enter] Continue</Text>
                    <Text dimColor>[Esc] Cancel</Text>
                </Box>
            </Box>
        );

    }

    // Processing step
    if (step === 'processing') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Regenerate Identity" paddingX={2} paddingY={1}>
                    <Spinner label="Generating keypair..." />
                </Panel>
            </Box>
        );

    }

    // Form step
    return (
        <Box flexDirection="column" gap={1}>
            {error && (
                <Panel borderColor="red" paddingX={2} paddingY={1}>
                    <Text color="red">{error}</Text>
                </Panel>
            )}

            <IdentitySetup
                onComplete={handleFormComplete}
                onCancel={handleCancel}
                isRegeneration={hasIdentity}
            />
        </Box>
    );

}
