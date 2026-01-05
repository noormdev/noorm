/**
 * ChangeListScreen - view all changes with status.
 *
 * Shows changes from disk merged with database execution status.
 * Displays applied/pending/reverted/failed status for each.
 *
 * @example
 * ```bash
 * noorm change          # View changes
 * noorm change list     # Same thing
 * ```
 */
import { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { ChangeListItem } from '../../../core/change/types.js';
import type { NoormDatabase } from '../../../core/shared/index.js';
import type { Kysely } from 'kysely';

import { attempt } from '@logosdx/utils';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner } from '../../components/index.js';
import { discoverChanges } from '../../../core/change/parser.js';
import { ChangeHistory } from '../../../core/change/history.js';
import { createConnection } from '../../../core/connection/factory.js';
import { relativeTimeAgo } from '../../utils/date.js';

/**
 * Get status indicator for a change.
 */
function getStatusIndicator(item: ChangeListItem): { symbol: string; color: string } {

    if (item.orphaned) {

        return { symbol: '!', color: 'yellow' };

    }

    switch (item.status) {

    case 'success':
        return { symbol: '✓', color: 'green' };

    case 'failed':
        return { symbol: '✗', color: 'red' };

    case 'reverted':
        return { symbol: '↩', color: 'yellow' };

    case 'pending':
    default:
        return { symbol: '○', color: 'gray' };

    }

}

/**
 * ChangeListScreen component.
 */
export function ChangeListScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ChangeList');
    const { activeConfig, activeConfigName, loadingStatus } = useAppContext();

    const [changes, setChanges] = useState<ChangeListItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Load changes
    useEffect(() => {

        if (!activeConfig || loadingStatus !== 'ready') {

            setIsLoading(false);

            return;

        }

        let cancelled = false;

        const loadChanges = async () => {

            setIsLoading(true);
            setError(null);

            const [_, err] = await attempt(async () => {

                // Discover changes from disk
                const diskChanges = await discoverChanges(
                    activeConfig.paths.changes,
                    activeConfig.paths.sql,
                );

                // Get statuses from database
                const conn = await createConnection(
                    activeConfig.connection,
                    activeConfigName ?? '__list__',
                );
                const db = conn.db as Kysely<NoormDatabase>;

                const history = new ChangeHistory(db, activeConfigName ?? '');
                const statuses = await history.getAllStatuses();

                await conn.destroy();

                if (cancelled) return;

                // Merge disk and database info
                const merged: ChangeListItem[] = [];

                // Add disk changes with their status
                for (const cs of diskChanges) {

                    const dbStatus = statuses.get(cs.name);

                    merged.push({
                        name: cs.name,
                        path: cs.path,
                        date: cs.date,
                        description: cs.description,
                        changeFiles: cs.changeFiles,
                        revertFiles: cs.revertFiles,
                        hasChangelog: cs.hasChangelog,
                        status: dbStatus?.status ?? 'pending',
                        appliedAt: dbStatus?.appliedAt ?? null,
                        appliedBy: dbStatus?.appliedBy ?? null,
                        revertedAt: dbStatus?.revertedAt ?? null,
                        errorMessage: dbStatus?.errorMessage ?? null,
                        isNew: !dbStatus,
                        orphaned: false,
                    });

                }

                // Add orphaned changes (in DB but not on disk)
                const diskNames = new Set(diskChanges.map((cs) => cs.name));
                for (const [name, status] of statuses) {

                    if (!diskNames.has(name)) {

                        merged.push({
                            name,
                            path: '',
                            date: null,
                            description: name,
                            status: status.status,
                            appliedAt: status.appliedAt,
                            appliedBy: status.appliedBy,
                            revertedAt: status.revertedAt,
                            errorMessage: status.errorMessage,
                            isNew: false,
                            orphaned: true,
                        });

                    }

                }

                // Sort by date (newest first) with pending at top
                merged.sort((a, b) => {

                    // Pending first
                    if (a.status === 'pending' && b.status !== 'pending') return -1;
                    if (b.status === 'pending' && a.status !== 'pending') return 1;

                    // Then by date
                    const dateA = a.date?.getTime() ?? 0;
                    const dateB = b.date?.getTime() ?? 0;

                    return dateB - dateA;

                });

                setChanges(merged);

            });

            if (err) {

                if (!cancelled) {

                    setError(err instanceof Error ? err.message : String(err));

                }

            }

            setIsLoading(false);

        };

        loadChanges();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, loadingStatus]);

    // Get selected change
    const selectedChange = useMemo(() => {

        return changes[selectedIndex];

    }, [changes, selectedIndex]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        // Navigation
        if (key.upArrow) {

            setSelectedIndex((prev) => Math.max(0, prev - 1));

            return;

        }

        if (key.downArrow) {

            setSelectedIndex((prev) => Math.min(changes.length - 1, prev + 1));

            return;

        }

        if (key.escape) {

            back();

            return;

        }

        // Actions
        if (input === 'a') {

            navigate('change/add');

            return;

        }

        if (input === 'e' && selectedChange && !selectedChange.orphaned) {

            navigate('change/edit', { name: selectedChange.name });

            return;

        }

        if (input === 'd' && selectedChange) {

            navigate('change/rm', { name: selectedChange.name });

            return;

        }

        if (input === 'r' && selectedChange && (selectedChange.status === 'pending' || selectedChange.status === 'failed')) {

            navigate('change/run', { name: selectedChange.name });

            return;

        }

        if (input === 'v' && selectedChange && selectedChange.status === 'success') {

            navigate('change/revert', { name: selectedChange.name });

            return;

        }

        if (input === 'n') {

            navigate('change/next');

            return;

        }

        if (input === 'f') {

            navigate('change/ff');

            return;

        }

        if (input === 'w') {

            navigate('change/rewind');

            return;

        }

        if (input === 'h') {

            navigate('change/history');

            return;

        }

        // Enter - smart action based on status
        if (key.return && selectedChange) {

            if (selectedChange.status === 'pending' || selectedChange.status === 'failed') {

                navigate('change/run', { name: selectedChange.name });

            }
            else if (selectedChange.status === 'success') {

                navigate('change/revert', { name: selectedChange.name });

            }

        }

    });

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Changes" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration. Press 'c' to manage configs.</Text>
            </Panel>
        );

    }

    // Loading
    if (isLoading) {

        return (
            <Panel title="Changes" paddingX={2} paddingY={1}>
                <Spinner label="Loading changes..." />
            </Panel>
        );

    }

    // Error
    if (error) {

        return (
            <Panel title="Changes" paddingX={2} paddingY={1} borderColor="red">
                <Box flexDirection="column" gap={1}>
                    <Text color="red">Failed to load changes: {error}</Text>
                    <Text dimColor>Press Esc to go back</Text>
                </Box>
            </Panel>
        );

    }

    // Statistics
    const applied = changes.filter((cs) => cs.status === 'success').length;
    const pending = changes.filter((cs) => cs.status === 'pending').length;
    const failed = changes.filter((cs) => cs.status === 'failed').length;
    const orphaned = changes.filter((cs) => cs.orphaned).length;

    return (
        <Panel title="Changes" paddingX={2} paddingY={1}>
            <Box flexDirection="column" gap={1}>
                {/* Statistics */}
                <Box gap={2}>
                    <Text>
                        Total: <Text bold>{changes.length}</Text>
                    </Text>
                    <Text>
                        Applied: <Text color="green">{applied}</Text>
                    </Text>
                    <Text>
                        Pending: <Text color="yellow">{pending}</Text>
                    </Text>
                    {failed > 0 && (
                        <Text>
                            Failed: <Text color="red">{failed}</Text>
                        </Text>
                    )}
                    {orphaned > 0 && (
                        <Text>
                            Orphaned: <Text color="yellow">{orphaned}</Text>
                        </Text>
                    )}
                </Box>

                {/* Change List */}
                {changes.length === 0 ? (
                    <Box marginTop={1}>
                        <Text dimColor>No changes found. Press [a] to create one.</Text>
                    </Box>
                ) : (
                    <Box flexDirection="column" marginTop={1}>
                        {changes.map((cs, index) => {

                            const isSelected = index === selectedIndex;
                            const indicator = getStatusIndicator(cs);

                            return (
                                <Box key={cs.name}>
                                    <Text color={isSelected ? 'cyan' : undefined}>
                                        {isSelected ? '>' : ' '}
                                    </Text>
                                    <Text color={indicator.color}> {indicator.symbol} </Text>
                                    <Text
                                        color={
                                            isSelected ? 'cyan' : cs.orphaned ? 'yellow' : undefined
                                        }
                                        bold={isSelected}
                                    >
                                        {cs.name}
                                    </Text>
                                    <Text dimColor>
                                        {cs.status === 'success' && cs.appliedAt && (
                                            <> {relativeTimeAgo(cs.appliedAt)}</>
                                        )}
                                        {cs.status === 'pending' && '  pending'}
                                        {cs.status === 'reverted' && '  reverted'}
                                        {cs.status === 'failed' && '  failed'}
                                        {cs.orphaned && '  (orphaned)'}
                                    </Text>
                                </Box>
                            );

                        })}
                    </Box>
                )}

                {/* Selected change details */}
                {selectedChange && (
                    <Box
                        marginTop={1}
                        flexDirection="column"
                        borderStyle="single"
                        borderColor={selectedChange.status === 'failed' ? 'red' : 'gray'}
                        paddingX={1}
                    >
                        <Text bold>{selectedChange.name}</Text>
                        <Box gap={2}>
                            <Text dimColor>
                                Change files: {selectedChange.changeFiles?.length ?? 0}
                            </Text>
                            <Text dimColor>
                                Revert files: {selectedChange.revertFiles?.length ?? 0}
                            </Text>
                        </Box>
                        {selectedChange.appliedBy && (
                            <Text dimColor>Applied by: {selectedChange.appliedBy}</Text>
                        )}
                        {selectedChange.status === 'failed' && selectedChange.errorMessage && (
                            <Box flexDirection="column" marginTop={1}>
                                <Text color="red" bold>Error:</Text>
                                <Text color="red" wrap="wrap">
                                    {selectedChange.errorMessage}
                                </Text>
                            </Box>
                        )}
                    </Box>
                )}

                {/* Keyboard hints */}
                <Box marginTop={1} flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[a] Add</Text>
                    <Text dimColor>[e] Edit</Text>
                    <Text dimColor>[d] Delete</Text>
                    <Text dimColor>[r] Run</Text>
                    <Text dimColor>[v] Revert</Text>
                    <Text dimColor>[n] Next</Text>
                    <Text dimColor>[f] FF</Text>
                    <Text dimColor>[w] Rewind</Text>
                    <Text dimColor>[h] History</Text>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        </Panel>
    );

}
