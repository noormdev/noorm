/**
 * IdentityExportScreen - export public key for sharing.
 *
 * Displays the full public key and identity hash for team members
 * to use when sending encrypted configurations.
 *
 * Keyboard shortcuts:
 * - c: Copy public key to clipboard
 * - Esc: Go back
 *
 * @example
 * ```bash
 * noorm identity:export    # Opens this screen
 * ```
 */
import { useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, useToast } from '../../components/index.js';
import { copyToClipboard, isClipboardAvailable } from '../../utils/index.js';
import { attemptSync } from '@logosdx/utils';


/**
 * IdentityExportScreen component.
 *
 * Shows full public key with copy-to-clipboard functionality.
 */
export function IdentityExportScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('IdentityExport');
    const { identity, hasIdentity } = useAppContext();
    const { showToast } = useToast();

    const clipboardAvailable = isClipboardAvailable();

    // Copy public key to clipboard
    const handleCopy = useCallback(() => {

        if (!identity?.publicKey) return;

        const [, err] = attemptSync(() => copyToClipboard(identity.publicKey));

        if (err) {

            showToast({
                message: 'Failed to copy to clipboard',
                variant: 'error',
            });

            return;

        }

        showToast({
            message: 'Public key copied to clipboard',
            variant: 'success',
        });

    }, [identity?.publicKey, showToast]);

    // Keyboard shortcuts
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

            return;

        }

        if (input === 'c' && clipboardAvailable) {

            handleCopy();

            return;

        }

    });

    // No identity
    if (!hasIdentity || !identity) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Export Public Key" borderColor="yellow" paddingX={2} paddingY={1}>
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

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="Export Public Key" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    {/* Instructions */}
                    <Text>
                        Share this key with team members so they can send you encrypted configurations.
                    </Text>

                    {/* Public key display */}
                    <Box
                        flexDirection="column"
                        marginTop={1}
                        borderStyle="single"
                        borderColor="gray"
                        paddingX={1}
                        paddingY={1}
                    >
                        <Text wrap="wrap">{identity.publicKey}</Text>
                    </Box>

                    {/* Identity hash for verification */}
                    <Box marginTop={1}>
                        <Text dimColor>Identity Hash: </Text>
                        <Text color="gray">{identity.identityHash}</Text>
                    </Box>
                </Box>
            </Panel>

            {/* Keyboard shortcuts */}
            <Box gap={2}>
                {clipboardAvailable ? (
                    <Text dimColor>[c] Copy to Clipboard</Text>
                ) : (
                    <Text dimColor color="yellow">
                        Clipboard not available
                    </Text>
                )}
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
