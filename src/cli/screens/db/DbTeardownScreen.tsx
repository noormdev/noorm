/**
 * DbTeardownScreen - drop user-created objects.
 *
 * Drops all user-created database objects (tables, views, functions, types)
 * while preserving noorm internal tables (__noorm_*).
 *
 * @example
 * ```bash
 * noorm db teardown    # Opens this screen
 * ```
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext, useSettings } from '../../app-context.js';
import { useToast, Panel, Spinner, ProtectedConfirm } from '../../components/index.js';
import { createConnection } from '../../../core/connection/index.js';
import { previewTeardown, teardownSchema } from '../../../core/teardown/index.js';
import { resolveIdentity, formatIdentity } from '../../../core/identity/index.js';
import { attempt } from '@logosdx/utils';

import type { Kysely } from 'kysely';
import type { TeardownPreview, TeardownResult } from '../../../core/teardown/index.js';

type Phase = 'loading' | 'preview' | 'view' | 'confirm' | 'running' | 'done' | 'error';

type ViewCategory = 'tables' | 'views' | 'functions' | 'types' | 'foreignKeys';

const CATEGORY_LABELS: Record<ViewCategory, string> = {
    tables: 'Tables',
    views: 'Views',
    functions: 'Functions',
    types: 'Types',
    foreignKeys: 'Foreign Keys',
};

/**
 * DbTeardownScreen component.
 */
export function DbTeardownScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('DbTeardown');
    const { activeConfig, activeConfigName, stateManager } = useAppContext();
    const { settings } = useSettings();
    const { showToast } = useToast();

    const [phase, setPhase] = useState<Phase>('loading');
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState<TeardownPreview | null>(null);
    const [result, setResult] = useState<TeardownResult | null>(null);
    const [viewCategory, setViewCategory] = useState<ViewCategory>('tables');
    const [viewScroll, setViewScroll] = useState(0);

    // Get options from settings - memoize to prevent effect re-runs
    const postScript = settings?.teardown?.postScript;
    const preserveTables = useMemo(
        () => settings?.teardown?.preserveTables ?? [],
        [settings?.teardown?.preserveTables],
    );

    // Track if we've already started loading to prevent duplicate loads
    const loadingRef = useRef(false);

    // Load preview
    useEffect(() => {

        if (!activeConfig || !activeConfigName) {

            setError('No active configuration');
            setPhase('error');

            return;

        }

        // Prevent duplicate loads (React strict mode, fast remounts)
        if (loadingRef.current) return;
        loadingRef.current = true;

        let cancelled = false;

        const load = async () => {

            const [conn, connErr] = await attempt(() =>
                createConnection(activeConfig.connection, activeConfigName),
            );

            if (connErr || !conn) {

                if (!cancelled) {

                    setError(`Connection failed: ${connErr?.message ?? 'Unknown error'}`);
                    setPhase('error');

                }

                loadingRef.current = false;

                return;

            }

            try {

                const db = conn.db as Kysely<unknown>;
                const previewResult = await previewTeardown(db, activeConfig.connection.dialect, {
                    preserveTables,
                    postScript,
                });

                if (!cancelled) {

                    setPreview(previewResult);
                    setPhase('preview');

                }

            }
            catch (err) {

                if (!cancelled) {

                    setError(err instanceof Error ? err.message : String(err));
                    setPhase('error');

                }

            }
            finally {

                await conn.destroy();
                loadingRef.current = false;

            }

        };

        load();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, preserveTables, postScript]);

    // Execute teardown
    const executeTeardown = useCallback(async () => {

        if (!activeConfig || !activeConfigName) return;

        setPhase('running');

        const [conn, connErr] = await attempt(() =>
            createConnection(activeConfig.connection, activeConfigName),
        );

        if (connErr || !conn) {

            setError(`Connection failed: ${connErr?.message ?? 'Unknown error'}`);
            setPhase('error');

            return;

        }

        try {

            const db = conn.db as Kysely<unknown>;

            // Resolve identity for changeset tracking
            const identity = resolveIdentity({
                cryptoIdentity: stateManager?.getIdentity() ?? null,
            });

            const teardownResult = await teardownSchema(db, activeConfig.connection.dialect, {
                preserveTables,
                postScript,
                configName: activeConfigName,
                executedBy: formatIdentity(identity),
            });

            setResult(teardownResult);
            setPhase('done');

        }
        catch (err) {

            setError(err instanceof Error ? err.message : String(err));
            setPhase('error');

        }
        finally {

            await conn.destroy();

        }

    }, [activeConfig, activeConfigName, preserveTables, postScript, stateManager]);

    // Get categories that have items
    const nonEmptyCategories = useMemo(() => {

        if (!preview) return [];

        const categories: ViewCategory[] = [];
        if (preview.toDrop.tables.length > 0) categories.push('tables');
        if (preview.toDrop.views.length > 0) categories.push('views');
        if (preview.toDrop.functions.length > 0) categories.push('functions');
        if (preview.toDrop.types.length > 0) categories.push('types');
        if (preview.toDrop.foreignKeys.length > 0) categories.push('foreignKeys');

        return categories;

    }, [preview]);

    // Get current category items
    const currentItems = useMemo(() => {

        if (!preview) return [];

        return preview.toDrop[viewCategory] ?? [];

    }, [preview, viewCategory]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        if (phase === 'preview') {

            if (key.escape) {

                back();

            }

            if (key.return || input === 'y') {

                setPhase('confirm');

            }

            if (input === 'v' && nonEmptyCategories.length > 0) {

                setViewCategory(nonEmptyCategories[0] ?? 'tables');
                setViewScroll(0);
                setPhase('view');

            }

        }

        if (phase === 'view') {

            if (key.escape) {

                setPhase('preview');

            }

            // Navigate categories with left/right
            if (key.leftArrow || key.rightArrow) {

                const currentIdx = nonEmptyCategories.indexOf(viewCategory);
                let newIdx: number;

                if (key.rightArrow) {

                    newIdx = (currentIdx + 1) % nonEmptyCategories.length;

                }
                else {

                    newIdx = (currentIdx - 1 + nonEmptyCategories.length) % nonEmptyCategories.length;

                }

                setViewCategory(nonEmptyCategories[newIdx] ?? 'tables');
                setViewScroll(0);

            }

            // Scroll with up/down
            const maxVisible = 15;

            if (key.downArrow && viewScroll < Math.max(0, currentItems.length - maxVisible)) {

                setViewScroll((s) => s + 1);

            }

            if (key.upArrow && viewScroll > 0) {

                setViewScroll((s) => s - 1);

            }

            // Page up/down
            if (key.pageDown) {

                setViewScroll((s) => Math.min(s + maxVisible, Math.max(0, currentItems.length - maxVisible)));

            }

            if (key.pageUp) {

                setViewScroll((s) => Math.max(0, s - maxVisible));

            }

        }

        if (phase === 'done' || phase === 'error') {

            if (key.return || key.escape) {

                if (phase === 'done') {

                    const count = result
                        ? result.dropped.tables.length +
                          result.dropped.views.length +
                          result.dropped.functions.length +
                          result.dropped.types.length
                        : 0;
                    showToast({ message: `Dropped ${count} objects`, variant: 'success' });

                }

                back();

            }

        }

    });

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Schema Teardown" borderColor="red" paddingX={1} paddingY={1}>
                <Text color="red">No active configuration selected.</Text>
            </Panel>
        );

    }

    // Loading
    if (phase === 'loading') {

        return (
            <Panel title="Schema Teardown" paddingX={1} paddingY={1}>
                <Spinner label="Analyzing schema..." />
            </Panel>
        );

    }

    // Error
    if (phase === 'error') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Schema Teardown Failed" borderColor="red" paddingX={1} paddingY={1}>
                    <Text color="red">{error}</Text>
                </Panel>
                <Box gap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Preview
    if (phase === 'preview' && preview) {

        const totalDrop =
            preview.toDrop.tables.length +
            preview.toDrop.views.length +
            preview.toDrop.functions.length +
            preview.toDrop.types.length +
            preview.toDrop.foreignKeys.length;

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Schema Teardown - Preview" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text>
                            This will <Text bold color="yellow">drop all user objects</Text> from the database:
                        </Text>

                        <Box flexDirection="column" marginTop={1}>
                            <Text bold>Objects to drop ({totalDrop}):</Text>
                            {preview.toDrop.tables.length > 0 && (
                                <Text dimColor>
                                    {'  '}Tables: {preview.toDrop.tables.length}
                                </Text>
                            )}
                            {preview.toDrop.views.length > 0 && (
                                <Text dimColor>
                                    {'  '}Views: {preview.toDrop.views.length}
                                </Text>
                            )}
                            {preview.toDrop.functions.length > 0 && (
                                <Text dimColor>
                                    {'  '}Functions: {preview.toDrop.functions.length}
                                </Text>
                            )}
                            {preview.toDrop.types.length > 0 && (
                                <Text dimColor>
                                    {'  '}Types: {preview.toDrop.types.length}
                                </Text>
                            )}
                            {preview.toDrop.foreignKeys.length > 0 && (
                                <Text dimColor>
                                    {'  '}Foreign Keys: {preview.toDrop.foreignKeys.length}
                                </Text>
                            )}
                            {totalDrop === 0 && (
                                <Text dimColor>  (none)</Text>
                            )}
                        </Box>

                        {preview.toPreserve.length > 0 && (
                            <Box flexDirection="column" marginTop={1}>
                                <Text bold color="green">Preserved ({preview.toPreserve.length}):</Text>
                                {preview.toPreserve.slice(0, 5).map((name) => (
                                    <Text key={name} color="green" dimColor>
                                        {'  '}- {name} {name.startsWith('__noorm_') ? '(system)' : '(settings)'}
                                    </Text>
                                ))}
                                {preview.toPreserve.length > 5 && (
                                    <Text dimColor>  ... and {preview.toPreserve.length - 5} more</Text>
                                )}
                            </Box>
                        )}

                        {postScript && (
                            <Box marginTop={1}>
                                <Text dimColor>Post-script: {postScript}</Text>
                            </Box>
                        )}
                    </Box>
                </Panel>

                <Box gap={2}>
                    {nonEmptyCategories.length > 0 && (
                        <Text dimColor>[v] View details</Text>
                    )}
                    <Text dimColor>[Enter/y] Continue</Text>
                    <Text dimColor>[Esc] Cancel</Text>
                </Box>
            </Box>
        );

    }

    // View detailed list
    if (phase === 'view' && preview) {

        const maxVisible = 15;
        const visibleItems = currentItems.slice(viewScroll, viewScroll + maxVisible);
        const hasMore = currentItems.length > maxVisible;

        return (
            <Box flexDirection="column" gap={1}>
                <Panel
                    title={`Objects to Drop - ${CATEGORY_LABELS[viewCategory]} (${currentItems.length})`}
                    borderColor="yellow"
                    paddingX={1}
                    paddingY={1}
                >
                    <Box flexDirection="column">
                        {/* Category tabs */}
                        <Box gap={2} marginBottom={1}>
                            {nonEmptyCategories.map((cat) => (
                                <Text
                                    key={cat}
                                    bold={cat === viewCategory}
                                    color={cat === viewCategory ? 'yellow' : undefined}
                                    dimColor={cat !== viewCategory}
                                >
                                    {CATEGORY_LABELS[cat]} ({preview.toDrop[cat].length})
                                </Text>
                            ))}
                        </Box>

                        {/* Items list */}
                        <Box flexDirection="column">
                            {visibleItems.map((item, idx) => (
                                <Text key={idx} dimColor>
                                    {'  '}{item}
                                </Text>
                            ))}
                            {currentItems.length === 0 && (
                                <Text dimColor>  (none)</Text>
                            )}
                        </Box>

                        {/* Scroll indicator */}
                        {hasMore && (
                            <Box marginTop={1}>
                                <Text dimColor>
                                    Showing {viewScroll + 1}-{Math.min(viewScroll + maxVisible, currentItems.length)} of {currentItems.length}
                                </Text>
                            </Box>
                        )}
                    </Box>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[←/→] Category</Text>
                    {hasMore && <Text dimColor>[↑/↓] Scroll</Text>}
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Confirm
    if (phase === 'confirm') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Schema Teardown" borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text>
                            This will <Text bold color="red">permanently drop</Text> all user-created objects.
                        </Text>
                        <Text dimColor>Only noorm tracking tables will be preserved.</Text>
                    </Box>
                </Panel>

                <ProtectedConfirm
                    configName={activeConfigName ?? 'unknown'}
                    action="drop schema for"
                    onConfirm={executeTeardown}
                    onCancel={() => setPhase('preview')}
                    focusLabel="DbTeardownConfirm"
                />
            </Box>
        );

    }

    // Running
    if (phase === 'running') {

        return (
            <Panel title="Schema Teardown" paddingX={1} paddingY={1}>
                <Spinner label="Dropping objects..." />
            </Panel>
        );

    }

    // Done
    if (phase === 'done' && result) {

        const totalDropped =
            result.dropped.tables.length +
            result.dropped.views.length +
            result.dropped.functions.length +
            result.dropped.types.length;

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Schema Teardown Complete" borderColor="green" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="green">
                            Successfully dropped <Text bold>{totalDropped}</Text> objects.
                        </Text>

                        <Box flexDirection="column">
                            {result.dropped.tables.length > 0 && (
                                <Text dimColor>  Tables: {result.dropped.tables.length}</Text>
                            )}
                            {result.dropped.views.length > 0 && (
                                <Text dimColor>  Views: {result.dropped.views.length}</Text>
                            )}
                            {result.dropped.functions.length > 0 && (
                                <Text dimColor>  Functions: {result.dropped.functions.length}</Text>
                            )}
                            {result.dropped.types.length > 0 && (
                                <Text dimColor>  Types: {result.dropped.types.length}</Text>
                            )}
                        </Box>

                        <Text dimColor>
                            Preserved {result.preserved.length} tables. Duration: {(result.durationMs / 1000).toFixed(2)}s
                        </Text>

                        {result.staleCount !== undefined && result.staleCount > 0 && (
                            <Text dimColor>
                                Marked {result.staleCount} changesets as stale (will re-run on next apply)
                            </Text>
                        )}

                        {result.postScriptResult && (
                            <Box marginTop={1}>
                                {result.postScriptResult.executed ? (
                                    <Text color="green">Post-script executed successfully</Text>
                                ) : (
                                    <Text color="red">Post-script failed: {result.postScriptResult.error}</Text>
                                )}
                            </Box>
                        )}
                    </Box>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Enter/Esc] Done</Text>
                </Box>
            </Box>
        );

    }

    return <></>;

}
