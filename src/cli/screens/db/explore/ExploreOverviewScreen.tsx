/**
 * ExploreOverviewScreen - database schema overview.
 *
 * Shows counts of all database objects with navigation to drill down.
 *
 * Keyboard shortcuts:
 * - 1-7 or t,v,p,f,y,i,k: Navigate to category list
 * - Esc: Go back
 *
 * @example
 * ```bash
 * noorm db         # Then press 'x' to explore
 * ```
 */
import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps, Route } from '../../../types.js';

import { useRouter } from '../../../router.js';
import { useFocusScope } from '../../../focus.js';
import { useAppContext, useExploreFilters, useSettings } from '../../../app-context.js';
import { useOnScreenPopped } from '../../../hooks/index.js';
import { Panel, Spinner } from '../../../components/index.js';
import { createConnection, testConnection } from '../../../../core/connection/index.js';
import { fetchOverview } from '../../../../core/explore/index.js';

import type { ExploreOverview, ExploreOptions } from '../../../../core/explore/index.js';

/**
 * Category configuration for navigation.
 */
interface CategoryConfig {

    key: keyof ExploreOverview;
    label: string;
    route: Route;
    hotkey: string;
    numberKey: string;

}

/**
 * All explorable categories.
 */
const CATEGORIES: CategoryConfig[] = [
    { key: 'tables', label: 'Tables', route: 'db/explore/tables', hotkey: 't', numberKey: '1' },
    { key: 'views', label: 'Views', route: 'db/explore/views', hotkey: 'v', numberKey: '2' },
    { key: 'procedures', label: 'Procedures', route: 'db/explore/procedures', hotkey: 'p', numberKey: '3' },
    { key: 'functions', label: 'Functions', route: 'db/explore/functions', hotkey: 'f', numberKey: '4' },
    { key: 'types', label: 'Types', route: 'db/explore/types', hotkey: 'y', numberKey: '5' },
    { key: 'indexes', label: 'Indexes', route: 'db/explore/indexes', hotkey: 'i', numberKey: '6' },
    { key: 'foreignKeys', label: 'Foreign Keys', route: 'db/explore/fks', hotkey: 'k', numberKey: '7' },
];

/**
 * ExploreOverviewScreen component.
 *
 * Entry point for database exploration, showing counts of all object types.
 */
export function ExploreOverviewScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ExploreOverview');
    const { activeConfig, activeConfigName } = useAppContext();
    const { clearFilters } = useExploreFilters();
    const { settings } = useSettings();

    const [overview, setOverview] = useState<ExploreOverview | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Include noorm tables only in verbose mode
    const exploreOptions: ExploreOptions = {
        includeNoormTables: settings?.logging?.level === 'verbose',
    };

    // Clear explore filter state when navigating away from the explore section
    useOnScreenPopped('db/explore', () => {

        clearFilters();

    });

    // Load overview data
    useEffect(() => {

        if (!activeConfig) {

            setIsLoading(false);

            return;

        }

        let cancelled = false;

        const load = async () => {

            setIsLoading(true);
            setError(null);

            // Test connection first
            const testResult = await testConnection(activeConfig.connection);

            if (!testResult.ok) {

                if (!cancelled) {

                    setError(testResult.error ?? 'Connection failed');
                    setIsLoading(false);

                }

                return;

            }

            // Fetch overview
            const [result, err] = await attempt(async () => {

                const conn = await createConnection(
                    activeConfig.connection,
                    activeConfigName ?? '__explore__',
                );

                const data = await fetchOverview(conn.db, activeConfig.connection.dialect, exploreOptions);

                await conn.destroy();

                return data;

            });

            if (cancelled) return;

            if (err) {

                setError(err.message);

            }
            else {

                setOverview(result);

            }

            setIsLoading(false);

        };

        load();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, settings?.logging?.level]);

    // Keyboard navigation
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

            return;

        }

        // Only allow navigation if we have data
        if (!overview) return;

        // Find matching category by hotkey or number
        const category = CATEGORIES.find((c) =>
            c.hotkey === input || c.numberKey === input,
        );

        if (category) {

            const count = overview[category.key];

            // Only navigate if there are items
            if (count > 0) {

                navigate(category.route);

            }

        }

    });

    // No active config
    if (!activeConfig) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="DB Explore" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">No active configuration selected.</Text>
                        <Text dimColor>Select a configuration first using the config screen.</Text>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Loading state
    if (isLoading) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="DB Explore" paddingX={1} paddingY={1}>
                    <Spinner label="Loading schema overview..." />
                </Panel>
            </Box>
        );

    }

    // Error state
    if (error) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="DB Explore" borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red">Connection Error</Text>
                        <Text dimColor>{error}</Text>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Calculate total objects
    const totalObjects = overview
        ? Object.values(overview).reduce((sum, count) => sum + count, 0)
        : 0;

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="DB Explore" paddingX={1} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    {/* Config info */}
                    <Box gap={2}>
                        <Text>Config:</Text>
                        <Text bold color="cyan">{activeConfigName}</Text>
                        <Text dimColor>({activeConfig.connection.dialect})</Text>
                    </Box>

                    <Box gap={2}>
                        <Text>Database:</Text>
                        <Text>{activeConfig.connection.database}</Text>
                    </Box>

                    <Box gap={2}>
                        <Text>Total Objects:</Text>
                        <Text bold color="green">{totalObjects}</Text>
                    </Box>

                    {/* Category list */}
                    <Box marginTop={1} flexDirection="column">
                        {CATEGORIES.map((cat) => {

                            const count = overview?.[cat.key] ?? 0;
                            const hasItems = count > 0;

                            return (
                                <Box key={cat.key} gap={2}>
                                    <Text color={hasItems ? 'cyan' : 'gray'}>
                                        [{cat.numberKey}]
                                    </Text>
                                    <Box width={14}>
                                        <Text color={hasItems ? undefined : 'gray'}>
                                            {cat.label}
                                        </Text>
                                    </Box>
                                    <Text bold={hasItems} color={hasItems ? 'green' : 'gray'}>
                                        {count}
                                    </Text>
                                </Box>
                            );

                        })}
                    </Box>
                </Box>
            </Panel>

            {/* Hotkeys */}
            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[1-7] Navigate</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
