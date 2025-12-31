/**
 * DbTruncateScreen - truncate table data.
 *
 * Truncates data from tables while preserving schema.
 * Uses settings.teardown.preserveTables for default exclusions.
 *
 * @example
 * ```bash
 * noorm db truncate    # Opens this screen
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
import { truncateData } from '../../../core/teardown/index.js';
import { fetchList } from '../../../core/explore/operations.js';
import { attempt } from '@logosdx/utils';

import type { Kysely } from 'kysely';
import type { TruncateResult } from '../../../core/teardown/index.js';
import type { TableSummary } from '../../../core/explore/types.js';

type Phase = 'loading' | 'preview' | 'confirm' | 'running' | 'done' | 'error';

/**
 * DbTruncateScreen component.
 */
export function DbTruncateScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('DbTruncate');
    const { activeConfig, activeConfigName } = useAppContext();
    const { settings } = useSettings();
    const { showToast } = useToast();

    const [phase, setPhase] = useState<Phase>('loading');
    const [error, setError] = useState<string | null>(null);
    const [tables, setTables] = useState<TableSummary[]>([]);
    const [result, setResult] = useState<TruncateResult | null>(null);

    // Get preserved tables from settings - memoize to prevent effect re-runs
    const preserveTables = useMemo(
        () => settings?.teardown?.preserveTables ?? [],
        [settings?.teardown?.preserveTables],
    );

    // Track if we've already started loading to prevent duplicate loads
    const loadingRef = useRef(false);

    // Load tables
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
                const tableList = await fetchList(db, activeConfig.connection.dialect, 'tables');

                if (!cancelled) {

                    setTables(tableList);
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

    }, [activeConfig, activeConfigName]);

    // Execute truncate
    const executeTruncate = useCallback(async () => {

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

            const truncateResult = await truncateData(db, activeConfig.connection.dialect, {
                preserve: preserveTables,
                restartIdentity: true,
            });

            setResult(truncateResult);
            setPhase('done');

        }
        catch (err) {

            setError(err instanceof Error ? err.message : String(err));
            setPhase('error');

        }
        finally {

            await conn.destroy();

        }

    }, [activeConfig, activeConfigName, preserveTables]);

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

        }

        if (phase === 'done' || phase === 'error') {

            if (key.return || key.escape) {

                if (phase === 'done') {

                    showToast({ message: `Truncated ${result?.truncated.length ?? 0} tables`, variant: 'success' });

                }

                back();

            }

        }

    });

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Wipe Data" borderColor="red" paddingX={1} paddingY={1}>
                <Text color="red">No active configuration selected.</Text>
            </Panel>
        );

    }

    // Loading
    if (phase === 'loading') {

        return (
            <Panel title="Wipe Data" paddingX={1} paddingY={1}>
                <Spinner label="Loading tables..." />
            </Panel>
        );

    }

    // Error
    if (phase === 'error') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Wipe Data Failed" borderColor="red" paddingX={1} paddingY={1}>
                    <Text color="red">{error}</Text>
                </Panel>
                <Box gap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Preview
    if (phase === 'preview') {

        // Filter out noorm tables and preserved tables
        const preserveSet = new Set(preserveTables);
        const toTruncate = tables.filter(
            (t) => !t.name.startsWith('__noorm_') && !preserveSet.has(t.name),
        );
        const toPreserve = tables.filter(
            (t) => t.name.startsWith('__noorm_') || preserveSet.has(t.name),
        );

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Wipe Data - Preview" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text>
                            This will <Text bold color="yellow">truncate all data</Text> from the following tables:
                        </Text>

                        <Box flexDirection="column" marginTop={1}>
                            <Text bold>Tables to truncate ({toTruncate.length}):</Text>
                            {toTruncate.length > 0 ? (
                                toTruncate.slice(0, 10).map((t) => (
                                    <Text key={t.name} dimColor>  - {t.name}</Text>
                                ))
                            ) : (
                                <Text dimColor>  (none)</Text>
                            )}
                            {toTruncate.length > 10 && (
                                <Text dimColor>  ... and {toTruncate.length - 10} more</Text>
                            )}
                        </Box>

                        {toPreserve.length > 0 && (
                            <Box flexDirection="column" marginTop={1}>
                                <Text bold color="green">Preserved ({toPreserve.length}):</Text>
                                {toPreserve.slice(0, 5).map((t) => (
                                    <Text key={t.name} color="green" dimColor>
                                        {'  '}- {t.name} {t.name.startsWith('__noorm_') ? '(system)' : '(settings)'}
                                    </Text>
                                ))}
                                {toPreserve.length > 5 && (
                                    <Text dimColor>  ... and {toPreserve.length - 5} more</Text>
                                )}
                            </Box>
                        )}
                    </Box>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Enter/y] Continue</Text>
                    <Text dimColor>[Esc] Cancel</Text>
                </Box>
            </Box>
        );

    }

    // Confirm
    if (phase === 'confirm') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Wipe Data" borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text>
                            This will <Text bold color="red">permanently delete</Text> all data from tables.
                        </Text>
                        <Text dimColor>Schema and table structure will be preserved.</Text>
                    </Box>
                </Panel>

                <ProtectedConfirm
                    configName={activeConfigName ?? 'unknown'}
                    action="truncate data for"
                    onConfirm={executeTruncate}
                    onCancel={() => setPhase('preview')}
                    focusLabel="DbTruncateConfirm"
                />
            </Box>
        );

    }

    // Running
    if (phase === 'running') {

        return (
            <Panel title="Wipe Data" paddingX={1} paddingY={1}>
                <Spinner label="Truncating tables..." />
            </Panel>
        );

    }

    // Done
    if (phase === 'done' && result) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Data Wiped" borderColor="green" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="green">
                            Successfully truncated <Text bold>{result.truncated.length}</Text> tables.
                        </Text>
                        <Text dimColor>
                            Preserved {result.preserved.length} tables. Duration: {(result.durationMs / 1000).toFixed(2)}s
                        </Text>
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
