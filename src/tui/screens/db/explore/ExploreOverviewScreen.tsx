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
import { useState, useMemo } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { Kysely } from 'kysely';
import type { ScreenProps, Route } from '../../../types.js';

import { useRouter } from '../../../router.js';
import { useFocusScope } from '../../../focus.js';
import { useAppContext, useExploreFilters, useSettings } from '../../../app-context.js';
import { useOnScreenPopped, useConnection, useAsyncEffect } from '../../../hooks/index.js';
import { Panel, Spinner } from '../../../components/index.js';
import { fetchOverview } from '../../../../core/explore/index.js';
import { CELL_GAP, LABEL_CAP, cellWidth, fitWidths, rowBudget } from './layout.js';

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
 * Sums the categories this screen actually lists.
 *
 * `ExploreOverview` also carries `triggers`, `locks` and `connections`. None
 * has a row here, and locks and connections are runtime state rather than
 * schema objects, so counting them left the total silently exceeding the rows
 * a reader could see.
 *
 * @example
 * countBrowsableObjects({ tables: 42, views: 7, ...rest }); // 49 + rest
 */
export function countBrowsableObjects(overview: ExploreOverview): number {

    return CATEGORIES.reduce((sum, cat) => sum + (overview[cat.key] ?? 0), 0);

}

/**
 * Labels of the config summary above the category list. Their gutter is
 * derived here so the three values start on one offset instead of each
 * landing wherever its own label ended.
 */
const SUMMARY_LABELS = ['Config:', 'Database:', 'Total Objects:'];

const SUMMARY_GUTTER = cellWidth(SUMMARY_LABELS, LABEL_CAP);

/**
 * Category list component.
 *
 * Hotkey, label, and count are sized from the categories themselves rather
 * than a hardcoded width, and none of the three shrinks, so every count sits
 * on the same offset.
 */
export function CategoryList({ overview, width }: { overview: ExploreOverview | null; width: number }): ReactElement {

    const [hotkeyWidth, labelWidth, countWidth] = useMemo(() => fitWidths(
        [
            cellWidth(CATEGORIES.map((cat) => `[${cat.numberKey}]`)),
            cellWidth(CATEGORIES.map((cat) => cat.label), LABEL_CAP),
            cellWidth(CATEGORIES.map((cat) => String(overview?.[cat.key] ?? 0))),
        ],
        width,
    ), [overview, width]);

    return (
        <Box marginTop={1} flexDirection="column">
            {CATEGORIES.map((cat) => {

                const count = overview?.[cat.key] ?? 0;
                const hasItems = count > 0;

                return (
                    <Box key={cat.key} gap={CELL_GAP}>
                        <Box width={hotkeyWidth} flexShrink={0}>
                            <Text color={hasItems ? 'cyan' : 'gray'}>
                                [{cat.numberKey}]
                            </Text>
                        </Box>
                        <Box width={labelWidth} flexShrink={0}>
                            <Text color={hasItems ? undefined : 'gray'} wrap="truncate">
                                {cat.label}
                            </Text>
                        </Box>
                        <Box width={countWidth} flexShrink={0}>
                            <Text bold={hasItems} color={hasItems ? 'green' : 'gray'}>
                                {count}
                            </Text>
                        </Box>
                    </Box>
                );

            })}
        </Box>
    );

}

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

    // useWindowSize, not useStdout: stdout.columns mutates on resize without
    // telling React, so widths derived from it would freeze at mount size.
    // Above the early returns, or the hook count changes once the load resolves.
    const { columns: terminalColumns } = useWindowSize();

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

    // Shared connection
    const { db, dialect, loading: connLoading, error: connError } = useConnection();

    // Load overview data when connection is ready
    useAsyncEffect(async (isCancelled) => {

        if (!db || !dialect) {

            if (!connLoading && !connError) setIsLoading(false);

            return;

        }

        setIsLoading(true);
        setError(null);

        const [result, err] = await attempt(async () => {

            return await fetchOverview(db as Kysely<unknown>, dialect, exploreOptions);

        });

        if (isCancelled()) return;

        if (err) {

            setError(err.message);

        }
        else {

            setOverview(result);

        }

        setIsLoading(false);

    }, [db, dialect, settings?.logging?.level]);

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
    if (isLoading || connLoading) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="DB Explore" paddingX={1} paddingY={1}>
                    <Spinner label="Loading schema overview..." />
                </Panel>
            </Box>
        );

    }

    // Error state
    if (error || connError) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="DB Explore" borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red">Connection Error</Text>
                        <Text dimColor>{error ?? connError}</Text>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    const totalObjects = overview ? countBrowsableObjects(overview) : 0;

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="DB Explore" paddingX={1} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    {/* Config info */}
                    <Box gap={CELL_GAP}>
                        <Box width={SUMMARY_GUTTER} flexShrink={0}>
                            <Text>Config:</Text>
                        </Box>
                        <Text bold color="cyan">{activeConfigName}</Text>
                        <Text dimColor>({activeConfig.connection.dialect})</Text>
                    </Box>

                    <Box gap={CELL_GAP}>
                        <Box width={SUMMARY_GUTTER} flexShrink={0}>
                            <Text>Database:</Text>
                        </Box>
                        <Text>{activeConfig.connection.database}</Text>
                    </Box>

                    <Box gap={CELL_GAP}>
                        <Box width={SUMMARY_GUTTER} flexShrink={0}>
                            <Text>Total Objects:</Text>
                        </Box>
                        <Text bold color="green">{totalObjects}</Text>
                    </Box>

                    <CategoryList overview={overview} width={rowBudget(terminalColumns)} />
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
