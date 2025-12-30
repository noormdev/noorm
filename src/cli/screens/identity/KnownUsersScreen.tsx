/**
 * KnownUsersScreen - browse team members discovered from database syncs.
 *
 * Groups users by email (one person may have multiple machines).
 * Supports inline expansion to view full details.
 *
 * Keyboard shortcuts:
 * - Up/Down: Navigate list
 * - Enter: Toggle expand/collapse
 * - Esc: Go back
 *
 * @example
 * ```bash
 * noorm identity:list    # Opens this screen
 * ```
 */
import { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { KnownUser } from '../../../core/identity/index.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel } from '../../components/index.js';
import { truncateHash } from '../../../core/identity/index.js';


/**
 * Group of users sharing the same email.
 */
interface UserGroup {
    email: string;
    users: KnownUser[];
}


/**
 * Format relative time for display.
 */
function formatRelativeTime(isoDate: string): string {

    const date = new Date(isoDate);
    const now = Date.now();
    const diffMs = now - date.getTime();

    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;

    return 'just now';

}


/**
 * KnownUsersScreen component.
 *
 * Lists known users grouped by email with inline detail expansion.
 */
export function KnownUsersScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('KnownUsers');
    const { stateManager } = useAppContext();

    // UI state
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [expandedEmail, setExpandedEmail] = useState<string | null>(null);

    // Group users by email
    const userGroups = useMemo<UserGroup[]>(() => {

        const knownUsers = stateManager?.getKnownUsers() ?? {};
        const byEmail: Record<string, KnownUser[]> = {};

        for (const user of Object.values(knownUsers)) {

            if (!byEmail[user.email]) {

                byEmail[user.email] = [];

            }

            byEmail[user.email]!.push(user);

        }

        // Sort by email, then sort machines within each group by lastSeen
        return Object.entries(byEmail)
            .map(([email, users]) => ({
                email,
                users: users.sort(
                    (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime(),
                ),
            }))
            .sort((a, b) => a.email.localeCompare(b.email));

    }, [stateManager]);

    // Total identity count
    const totalIdentities = useMemo(() => {

        return userGroups.reduce((sum, group) => sum + group.users.length, 0);

    }, [userGroups]);

    // Keyboard navigation
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

            return;

        }

        if (key.upArrow) {

            setHighlightedIndex((i) => Math.max(0, i - 1));

            return;

        }

        if (key.downArrow) {

            setHighlightedIndex((i) => Math.min(userGroups.length - 1, i + 1));

            return;

        }

        if (key.return) {

            const group = userGroups[highlightedIndex];

            if (group) {

                setExpandedEmail((current) => (current === group.email ? null : group.email));

            }

            return;

        }

    });

    // Empty state
    if (userGroups.length === 0) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Known Users" borderColor="gray" paddingX={2} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text dimColor>No known users discovered yet.</Text>
                        <Text dimColor>
                            Users are discovered when you connect to shared databases.
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
            <Panel title="Known Users" paddingX={2} paddingY={1}>
                <Box flexDirection="column">
                    {userGroups.map((group, index) => {

                        const isHighlighted = index === highlightedIndex;
                        const isExpanded = group.email === expandedEmail;
                        const machineCount = group.users.length;

                        return (
                            <Box key={group.email} flexDirection="column">
                                {/* Group header */}
                                <Box>
                                    <Text color={isHighlighted ? 'cyan' : undefined}>
                                        {isHighlighted ? '>' : ' '}
                                    </Text>
                                    <Text color={isHighlighted ? 'cyan' : undefined}>
                                        {' '}
                                        [{isExpanded ? '-' : '+'}]{' '}
                                    </Text>
                                    <Text bold={isHighlighted}>{group.email}</Text>
                                    <Text dimColor>
                                        {' '}
                                        ({machineCount} machine{machineCount !== 1 ? 's' : ''})
                                    </Text>
                                </Box>

                                {/* Expanded details */}
                                {isExpanded &&
                                    group.users.map((user, userIndex) => {

                                        const isLast = userIndex === group.users.length - 1;
                                        const prefix = isLast ? '└─' : '├─';
                                        const linePrefix = isLast ? '   ' : '│  ';

                                        return (
                                            <Box
                                                key={user.identityHash}
                                                flexDirection="column"
                                                marginLeft={4}
                                            >
                                                {/* Machine header */}
                                                <Box>
                                                    <Text dimColor>{prefix} </Text>
                                                    <Text>{user.name}</Text>
                                                    <Text dimColor>
                                                        {' '}
                                                        ({user.machine}, {user.os.split(' ')[0]})
                                                    </Text>
                                                </Box>

                                                {/* Details */}
                                                <Box flexDirection="column" marginLeft={3}>
                                                    <Box>
                                                        <Text dimColor>{linePrefix}</Text>
                                                        <Text dimColor>Hash: </Text>
                                                        <Text color="gray">
                                                            {truncateHash(user.identityHash)}
                                                        </Text>
                                                    </Box>
                                                    <Box>
                                                        <Text dimColor>{linePrefix}</Text>
                                                        <Text dimColor>Key: </Text>
                                                        <Text color="gray">
                                                            {user.publicKey.slice(0, 20)}...
                                                        </Text>
                                                    </Box>
                                                    <Box>
                                                        <Text dimColor>{linePrefix}</Text>
                                                        <Text dimColor>Source: </Text>
                                                        <Text>{user.source}</Text>
                                                    </Box>
                                                    <Box>
                                                        <Text dimColor>{linePrefix}</Text>
                                                        <Text dimColor>Last seen: </Text>
                                                        <Text>{formatRelativeTime(user.lastSeen)}</Text>
                                                    </Box>
                                                </Box>
                                            </Box>
                                        );

                                    })}
                            </Box>
                        );

                    })}
                </Box>
            </Panel>

            {/* Summary */}
            <Box paddingLeft={2}>
                <Text dimColor>
                    {userGroups.length} user{userGroups.length !== 1 ? 's' : ''}, {totalIdentities}{' '}
                    {totalIdentities !== 1 ? 'identities' : 'identity'}
                </Text>
            </Box>

            {/* Keyboard shortcuts */}
            <Box gap={2}>
                <Text dimColor>[Enter] Expand/Collapse</Text>
                <Text dimColor>[Up/Down] Navigate</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
