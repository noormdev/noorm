/**
 * ExploreListScreen - list of database objects in a category.
 *
 * Generic screen that works for all categories: tables, views, etc.
 * Uses the route to determine which category to display.
 *
 * Keyboard shortcuts:
 * - /: Enter search mode
 * - Enter: View detail (for categories with detail views)
 * - Esc: Back
 * - 1-9: Quick select
 *
 * @example
 * ```bash
 * noorm db         # Then press 'x' to explore, then '1' for tables
 * ```
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps, Route } from '../../../types.js';

import { useRouter } from '../../../router.js';
import { useFocusScope } from '../../../focus.js';
import { useAppContext, useExploreFilters, useSettings } from '../../../app-context.js';
import { Panel, Spinner, SearchableList } from '../../../components/index.js';
import { createConnection } from '../../../../core/connection/index.js';
import { fetchList, formatSummaryDescription } from '../../../../core/explore/index.js';

import type { SelectListItem, SearchableListFilterState } from '../../../components/index.js';
import type {
    ExploreCategory,
    ExploreOptions,
    TableSummary,
    ViewSummary,
    ProcedureSummary,
    FunctionSummary,
    TypeSummary,
    IndexSummary,
    ForeignKeySummary,
} from '../../../../core/explore/index.js';

/**
 * Category configuration.
 */
interface CategoryMeta {

    category: ExploreCategory;
    title: string;
    detailRoute?: Route;
    hasDetail: boolean;

}

/**
 * Route to category mapping.
 */
const ROUTE_TO_CATEGORY: Record<string, CategoryMeta> = {
    'db/explore/tables': {
        category: 'tables',
        title: 'Tables',
        detailRoute: 'db/explore/tables/detail',
        hasDetail: true,
    },
    'db/explore/views': {
        category: 'views',
        title: 'Views',
        detailRoute: 'db/explore/views/detail',
        hasDetail: true,
    },
    'db/explore/procedures': {
        category: 'procedures',
        title: 'Procedures',
        detailRoute: 'db/explore/procedures/detail',
        hasDetail: true,
    },
    'db/explore/functions': {
        category: 'functions',
        title: 'Functions',
        detailRoute: 'db/explore/functions/detail',
        hasDetail: true,
    },
    'db/explore/types': {
        category: 'types',
        title: 'Types',
        detailRoute: 'db/explore/types/detail',
        hasDetail: true,
    },
    'db/explore/indexes': {
        category: 'indexes',
        title: 'Indexes',
        hasDetail: false,
    },
    'db/explore/fks': {
        category: 'foreignKeys',
        title: 'Foreign Keys',
        hasDetail: false,
    },
};

/**
 * Union type for all summary types.
 */
type AnySummary =
    | TableSummary
    | ViewSummary
    | ProcedureSummary
    | FunctionSummary
    | TypeSummary
    | IndexSummary
    | ForeignKeySummary;

/**
 * ExploreListScreen component.
 *
 * Displays a searchable list of database objects for the current category.
 */
export function ExploreListScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back, route } = useRouter();
    const { isFocused } = useFocusScope('ExploreList');
    const { activeConfig, activeConfigName } = useAppContext();
    const { getFilter, setFilter } = useExploreFilters();
    const { settings } = useSettings();

    const [items, setItems] = useState<AnySummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Get category meta from route
    const meta = ROUTE_TO_CATEGORY[route];

    // Include noorm tables only in verbose mode
    const exploreOptions: ExploreOptions = {
        includeNoormTables: settings?.logging?.level === 'verbose',
    };

    // Get persisted filter state for this category
    const filterState = meta ? getFilter(meta.category) : undefined;

    // Load items
    useEffect(() => {

        if (!activeConfig || !meta) {

            setIsLoading(false);

            return;

        }

        let cancelled = false;

        const load = async () => {

            setIsLoading(true);
            setError(null);

            const [result, err] = await attempt(async () => {

                const conn = await createConnection(
                    activeConfig.connection,
                    activeConfigName ?? '__explore__',
                );

                const data = await fetchList(conn.db, activeConfig.connection.dialect, meta.category, exploreOptions);

                await conn.destroy();

                return data;

            });

            if (cancelled) return;

            if (err) {

                setError(err.message);

            }
            else {

                setItems(result as AnySummary[]);

            }

            setIsLoading(false);

        };

        load();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, meta, settings?.logging?.level]);

    // Convert items to SelectListItem format
    const listItems = useMemo((): SelectListItem<AnySummary>[] => {

        if (!meta) return [];

        return items.map((item) => {

            const name = item.name;
            const schema = 'schema' in item ? (item as { schema?: string }).schema : undefined;

            return {
                key: schema ? `${schema}.${name}` : name,
                label: schema ? `${schema}.${name}` : name,
                value: item,
                description: formatSummaryDescription(meta.category, item),
            };

        });

    }, [items, meta]);

    // Handle item selection
    const handleSelect = (item: SelectListItem<AnySummary>) => {

        if (!meta?.hasDetail || !meta.detailRoute) return;

        const summary = item.value;
        const schema = 'schema' in summary ? (summary as { schema?: string }).schema : undefined;

        navigate(meta.detailRoute, {
            name: summary.name,
            schema,
        });

    };

    // Handle filter state changes (persist to app context)
    const handleFilterChange = useCallback((state: SearchableListFilterState) => {

        if (!meta) return;

        setFilter(meta.category, {
            searchTerm: state.searchTerm,
            highlightedKey: state.highlightedKey,
        });

    }, [meta, setFilter]);

    // Handle escape (back navigation)
    useInput((input, key) => {

        if (!isFocused) return;

        // Only handle Escape when SearchableList doesn't consume it
        // SearchableList handles Esc for clearing search
        if (key.escape) {

            back();

        }

    });

    // Invalid route
    if (!meta) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Error" borderColor="red" paddingX={1} paddingY={1}>
                    <Text color="red">Invalid explore route: {route}</Text>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // No active config
    if (!activeConfig) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title={meta.title} borderColor="yellow" paddingX={1} paddingY={1}>
                    <Text color="yellow">No active configuration selected.</Text>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Loading state
    if (isLoading) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title={meta.title} paddingX={1} paddingY={1}>
                    <Spinner label={`Loading ${meta.title.toLowerCase()}...`} />
                </Panel>
            </Box>
        );

    }

    // Error state
    if (error) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title={meta.title} borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red">Error loading {meta.title.toLowerCase()}</Text>
                        <Text dimColor>{error}</Text>
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
            <Panel title={`${meta.title} (${items.length})`} paddingX={1} paddingY={1}>
                <SearchableList
                    items={listItems}
                    onSelect={meta.hasDetail ? handleSelect : undefined}
                    searchPlaceholder={`Filter ${meta.title.toLowerCase()}...`}
                    emptyLabel={`No ${meta.title.toLowerCase()} found`}
                    noResultsLabel="No matches"
                    visibleCount={10}
                    isFocused={isFocused}
                    numberNav
                    initialSearchTerm={filterState?.searchTerm}
                    initialHighlightedKey={filterState?.highlightedKey}
                    onFilterChange={handleFilterChange}
                />
            </Panel>

            {/* Hotkeys */}
            <Box gap={2}>
                {meta.hasDetail && <Text dimColor>[Enter] View detail</Text>}
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
