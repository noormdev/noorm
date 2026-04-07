/**
 * SQL Clear Screen.
 *
 * Clear SQL query history with confirmation.
 *
 * Options:
 * - Clear last 3 months
 * - Clear all history
 *
 * Both require confirmation before proceeding.
 */
import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, Confirm, useToast } from '../../components/index.js';
import { SqlHistoryManager } from '../../../core/sql-terminal/index.js';

/**
 * Clear option type.
 */
type ClearOption = '3months' | 'all';

/**
 * Screen phase.
 */
type Phase = 'select' | 'confirm' | 'clearing' | 'done';

/**
 * Format bytes for display.
 */
function formatBytes(bytes: number): string {

    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

}

/**
 * SQL Clear Screen component.
 */
export function SqlClearScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('SqlClear');
    const { activeConfigName, projectRoot } = useAppContext();
    const { showToast } = useToast();

    // State
    const [phase, setPhase] = useState<Phase>('select');
    const [selectedOption, setSelectedOption] = useState<ClearOption>('3months');
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [stats, setStats] = useState<{ entryCount: number; resultsSize: number } | null>(null);
    const [isLoadingStats, setIsLoadingStats] = useState(true);
    const [clearResult, setClearResult] = useState<{ entriesRemoved: number; filesRemoved: number } | null>(null);

    const options: { key: ClearOption; label: string; description: string }[] = [
        {
            key: '3months',
            label: 'Clear last 3 months',
            description: 'Remove queries older than 3 months',
        },
        {
            key: 'all',
            label: 'Clear all history',
            description: 'Remove all queries and results',
        },
    ];

    // Load stats
    useEffect(() => {

        if (!activeConfigName || !projectRoot) {

            setIsLoadingStats(false);

            return;

        }

        const loadStats = async () => {

            setIsLoadingStats(true);

            const manager = new SqlHistoryManager(projectRoot, activeConfigName);
            const s = await manager.getStats();

            setStats(s);
            setIsLoadingStats(false);

        };

        loadStats();

    }, [activeConfigName, projectRoot]);

    // Handle clear
    const handleClear = async () => {

        if (!activeConfigName || !projectRoot) return;

        setPhase('clearing');

        const manager = new SqlHistoryManager(projectRoot, activeConfigName);
        let result;

        if (selectedOption === '3months') {

            result = await manager.clearOlderThan(3);

        }
        else {

            result = await manager.clearAll();

        }

        setClearResult(result);
        setPhase('done');

        showToast({
            message: `Cleared ${result.entriesRemoved} entries, ${result.filesRemoved} files`,
            variant: 'success',
        });

    };

    // Keyboard shortcuts
    useInput((input, key) => {

        if (!isFocused) return;

        // Select phase
        if (phase === 'select') {

            // Up/Down: Navigate options
            if (key.upArrow) {

                setHighlightedIndex((i) => (i > 0 ? i - 1 : options.length - 1));

                return;

            }

            if (key.downArrow) {

                setHighlightedIndex((i) => (i < options.length - 1 ? i + 1 : 0));

                return;

            }

            // Enter: Select option
            if (key.return) {

                const option = options[highlightedIndex];
                if (option) {

                    setSelectedOption(option.key);
                    setPhase('confirm');

                }

                return;

            }

            // Escape: Back
            if (key.escape) {

                back();

                return;

            }

            return;

        }

        // Done phase
        if (phase === 'done') {

            if (key.escape || key.return) {

                back();

                return;

            }

            return;

        }

    });

    // No config
    if (!activeConfigName || !projectRoot) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Clear History" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Text color="yellow">No active configuration selected.</Text>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Clearing
    if (phase === 'clearing') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Clear History" paddingX={1} paddingY={1}>
                    <Spinner label="Clearing history..." />
                </Panel>
            </Box>
        );

    }

    // Done
    if (phase === 'done' && clearResult) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Clear History" borderColor="green" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="green">History cleared successfully!</Text>
                        <Text>Entries removed: {clearResult.entriesRemoved}</Text>
                        <Text>Files removed: {clearResult.filesRemoved}</Text>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Confirm phase
    if (phase === 'confirm') {

        const optionLabel = selectedOption === '3months'
            ? 'clear queries older than 3 months'
            : 'clear ALL history';

        return (
            <Confirm
                message={`Are you sure you want to ${optionLabel}?`}
                onConfirm={handleClear}
                onCancel={() => setPhase('select')}
            />
        );

    }

    // Select phase
    return (
        <Box flexDirection="column" gap={1}>
            {/* Header */}
            <Box gap={2}>
                <Text bold>Clear History</Text>
                <Text dimColor>-</Text>
                <Text color="cyan">{activeConfigName}</Text>
            </Box>

            {/* Stats */}
            <Panel title="Current History" paddingX={1} paddingY={1}>
                {isLoadingStats ? (
                    <Spinner label="Loading stats..." />
                ) : stats ? (
                    <Box flexDirection="column">
                        <Box gap={2}>
                            <Text>Queries:</Text>
                            <Text bold>{stats.entryCount}</Text>
                        </Box>
                        <Box gap={2}>
                            <Text>Results size:</Text>
                            <Text bold>{formatBytes(stats.resultsSize)}</Text>
                        </Box>
                    </Box>
                ) : (
                    <Text dimColor>No history</Text>
                )}
            </Panel>

            {/* Options */}
            <Panel title="Clear Options" paddingX={1} paddingY={1}>
                <Box flexDirection="column">
                    {options.map((option, index) => {

                        const isHighlighted = index === highlightedIndex;

                        return (
                            <Box key={option.key} flexDirection="column">
                                <Box>
                                    <Text
                                        inverse={isHighlighted}
                                        color={option.key === 'all' ? 'red' : undefined}
                                    >
                                        {isHighlighted ? '> ' : '  '}
                                        {option.label}
                                    </Text>
                                </Box>
                                <Box marginLeft={4}>
                                    <Text dimColor>{option.description}</Text>
                                </Box>
                            </Box>
                        );

                    })}
                </Box>
            </Panel>

            {/* Footer hints */}
            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[Enter] Select</Text>
                <Text dimColor>[↑/↓] Navigate</Text>
                <Text dimColor>[Esc] Cancel</Text>
            </Box>
        </Box>
    );

}
