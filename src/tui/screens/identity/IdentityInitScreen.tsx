/**
 * IdentityInitScreen - regenerate or create identity.
 *
 * Shows warning if regenerating existing identity, then displays
 * the identity setup form. Generates new keypair on completion.
 *
 * Flow:
 * 1. Warning (if existing identity) -> Confirm
 * 2. Form (IdentitySetup with isRegeneration)
 * 3. Processing (back up the old keypair, generate the new one)
 * 4. Backup paths (regeneration only) -> back to identity screen
 *
 * Keyboard shortcuts:
 * - Enter: Confirm warning, leave the backup paths
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
import {
    IDENTITY_REPLACE_WARNING,
    backupKeyPair,
    createCryptoIdentity,
    ensureIdentity,
    hasPrivateKeyFile,
} from '../../../core/identity/index.js';
import { attempt } from '@logosdx/utils';
import { getErrorMessage } from '../../utils/index.js';

const RESTORE_HINT = 'Restore identity.key from that backup to regain access to existing state.';

/**
 * Step in the regeneration flow.
 */
type InitStep = 'warning' | 'form' | 'processing' | 'backed-up';


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
    const [backups, setBackups] = useState<string[]>([]);

    // Handle warning confirmation
    const handleConfirmWarning = useCallback(() => {

        setStep('form');

    }, []);

    // Handle form completion
    const handleFormComplete = useCallback(
        async (values: IdentitySetupValues) => {

            const input = { name: values.name, email: values.email, machine: values.machine };

            const fail = (message: string) => {

                setError(message);
                setStep('form');
                showToast({
                    message: 'Failed to create identity',
                    variant: 'error',
                });

            };

            setStep('processing');
            setError(null);

            let backedUp: string[] = [];

            // Every state.enc on the machine is encrypted with the old key, so
            // nothing replaces it until a copy is on disk.
            if (hasIdentity && (await hasPrivateKeyFile())) {

                const [written, backupErr] = await attempt(() => backupKeyPair());

                if (backupErr) {

                    fail(
                        `Refusing to overwrite: could not back up the existing identity (${backupErr.message}). `
                        + 'Without a backup this operation is unrecoverable.',
                    );

                    return;

                }

                backedUp = written;

            }

            // No identity can still mean a private key on disk, restored
            // without its .pub. Only a confirmed regeneration replaces one.
            const create = hasIdentity ? createCryptoIdentity : ensureIdentity;

            const [, err] = await attempt(() => create(input));

            if (err) {

                // The key file is written first, so the old key may by now exist only in the backup.
                fail(backedUp.length > 0
                    ? `${getErrorMessage(err)} The previous identity was backed up to: ${backedUp.join(', ')}. ${RESTORE_HINT}`
                    : getErrorMessage(err));

                return;

            }

            // The state manager still holds the key it loaded at startup, or none.
            await stateManager?.reloadPrivateKey();

            // Refresh app context to pick up the new identity from global ~/.noorm/
            // createCryptoIdentity() already saved the identity globally
            await refresh?.();

            // Success
            showToast({
                message: hasIdentity ? 'Identity regenerated' : 'Identity created',
                variant: 'success',
            });

            if (backedUp.length > 0) {

                setBackups(backedUp);
                setStep('backed-up');

                return;

            }

            back();

        },
        [stateManager, refresh, hasIdentity, showToast, back],
    );

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    useInput(
        (input, key) => {

            if (!isFocused) return;

            if (step === 'backed-up') {

                if (key.return || key.escape) back();

                return;

            }

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
                <Panel title="Regenerate Identity" borderColor="yellow" paddingX={2}>
                    <Box flexDirection="column" gap={1}>
                        <Box flexDirection="column">
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

                        <Text color="yellow">{IDENTITY_REPLACE_WARNING}</Text>

                        <Text dimColor>
                            The current identity files are copied to ~/.noorm/{'<file>'}.bak-{'<timestamp>'} first.
                            Team members need your new public key.
                        </Text>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter] Continue</Text>
                    <Text dimColor>[Esc] Cancel</Text>
                </Box>
            </Box>
        );

    }

    if (step === 'backed-up') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Identity Regenerated" borderColor="yellow" paddingX={2}>
                    <Box flexDirection="column" gap={1}>
                        <Box flexDirection="column">
                            <Text>Previous identity backed up to:</Text>
                            {backups.map((path) => (
                                <Text key={path}>{path}</Text>
                            ))}
                        </Box>

                        <Text>{RESTORE_HINT}</Text>
                    </Box>
                </Panel>

                <Text dimColor>[Enter] Back</Text>
            </Box>
        );

    }

    // Processing step
    if (step === 'processing') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title={hasIdentity ? 'Regenerate Identity' : 'Identity'} paddingX={2} paddingY={1}>
                    <Spinner label={hasIdentity ? 'Generating keypair...' : 'Setting up identity...'} />
                </Panel>
            </Box>
        );

    }

    // Form step
    return (
        <IdentitySetup
            onComplete={handleFormComplete}
            onCancel={handleCancel}
            isRegeneration={hasIdentity}
            error={error ?? undefined}
        />
    );

}
