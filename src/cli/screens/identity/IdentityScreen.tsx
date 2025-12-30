/**
 * IdentityScreen - view current cryptographic identity.
 *
 * Displays identity details including name, email, machine, OS,
 * identity hash (truncated), public key (truncated), and creation date.
 *
 * Keyboard shortcuts:
 * - e: Export public key
 * - r: Regenerate identity
 * - u: View known users
 * - Esc: Go back
 *
 * @example
 * ```bash
 * noorm identity    # Opens this screen
 * ```
 */
import { useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel } from '../../components/index.js';
import { truncateHash } from '../../../core/identity/index.js';


/**
 * Format ISO date for display.
 */
function formatDate(isoDate: string): string {

    const date = new Date(isoDate);

    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });

}


/**
 * IdentityScreen component.
 *
 * Shows current cryptographic identity with navigation to related screens.
 */
export function IdentityScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('IdentityScreen');
    const { identity, hasIdentity, stateManager } = useAppContext();

    // Count known users
    const knownUsersCount = useMemo(() => {

        const users = stateManager?.getKnownUsers() ?? {};

        return Object.keys(users).length;

    }, [stateManager]);

    // Keyboard shortcuts
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

            return;

        }

        if (input === 'e') {

            navigate('identity/edit');

            return;

        }

        if (input === 'x') {

            navigate('identity/export');

            return;

        }

        if (input === 'r') {

            navigate('identity/init');

            return;

        }

        if (input === 'u') {

            navigate('identity/list');

            return;

        }

    });

    // No identity - show setup prompt
    if (!hasIdentity || !identity) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Identity" borderColor="yellow" paddingX={2} paddingY={1}>
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

    // Truncate values for display
    const truncatedHash = truncateHash(identity.identityHash, 12);
    const truncatedKey = identity.publicKey.slice(0, 24) + '...';

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="Identity" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    {/* Primary info */}
                    <Box flexDirection="column">
                        <Box>
                            <Box width={12}>
                                <Text dimColor>Name:</Text>
                            </Box>
                            <Text bold>{identity.name}</Text>
                        </Box>
                        <Box>
                            <Box width={12}>
                                <Text dimColor>Email:</Text>
                            </Box>
                            <Text>{identity.email}</Text>
                        </Box>
                    </Box>

                    {/* Environment info */}
                    <Box flexDirection="column" marginTop={1}>
                        <Box>
                            <Box width={12}>
                                <Text dimColor>Machine:</Text>
                            </Box>
                            <Text>{identity.machine}</Text>
                        </Box>
                        <Box>
                            <Box width={12}>
                                <Text dimColor>OS:</Text>
                            </Box>
                            <Text>{identity.os}</Text>
                        </Box>
                    </Box>

                    {/* Cryptographic info */}
                    <Box flexDirection="column" marginTop={1}>
                        <Box>
                            <Box width={12}>
                                <Text dimColor>Hash:</Text>
                            </Box>
                            <Text color="gray">{truncatedHash}</Text>
                        </Box>
                        <Box>
                            <Box width={12}>
                                <Text dimColor>Public Key:</Text>
                            </Box>
                            <Text color="gray">{truncatedKey}</Text>
                        </Box>
                        <Box>
                            <Box width={12}>
                                <Text dimColor>Created:</Text>
                            </Box>
                            <Text>{formatDate(identity.createdAt)}</Text>
                        </Box>
                    </Box>
                </Box>
            </Panel>

            {/* Known users hint */}
            {knownUsersCount > 0 && (
                <Box paddingLeft={2}>
                    <Text dimColor>
                        {knownUsersCount} known user{knownUsersCount !== 1 ? 's' : ''} discovered
                    </Text>
                </Box>
            )}

            {/* Keyboard shortcuts */}
            <Box gap={2} flexWrap="wrap">
                <Text dimColor>[e] Edit</Text>
                <Text dimColor>[x] Export Key</Text>
                <Text dimColor>[r] Regenerate</Text>
                <Text dimColor>[u] Known Users</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
