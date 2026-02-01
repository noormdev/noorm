/**
 * DbTransferScreen - cross-database data transfer.
 *
 * Transfers data between database configurations with:
 * - Same-server optimization (direct SQL)
 * - Cross-server batch transfers
 * - Configurable conflict resolution
 * - FK dependency ordering
 *
 * Phases:
 * 1. select-dest: Choose destination config
 * 2. select-tables: Multi-select tables (or "all")
 * 3. options: Configure conflict strategy, batching
 * 4. plan: Show transfer plan with warnings
 * 5. confirm: Final confirmation
 * 6. running: Progress with table-by-table status
 * 7. complete: Results summary
 *
 * @example
 * ```bash
 * noorm db transfer    # Opens this screen
 * ```
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { ProgressBar } from '@inkjs/ui';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { useTransferProgress } from '../../hooks/index.js';
import {
    useToast,
    Panel,
    Spinner,
    SelectList,
    Confirm,
    type SelectListItem,
} from '../../components/index.js';

import { transferData, getTransferPlan } from '../../../core/transfer/index.js';
import type { TransferOptions, TransferPlan, ConflictStrategy } from '../../../core/transfer/index.js';
import type { Config } from '../../../core/config/types.js';

type Phase =
    | 'select-dest'
    | 'select-tables'
    | 'options'
    | 'plan'
    | 'confirm'
    | 'running'
    | 'complete'
    | 'error';

/**
 * DbTransferScreen component.
 */
export function DbTransferScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { activeConfig, activeConfigName, stateManager } = useAppContext();
    const { showToast } = useToast();
    const { state: progress, reset: resetProgress } = useTransferProgress();

    const [phase, setPhase] = useState<Phase>('select-dest');
    const [error, setError] = useState<string | null>(null);
    const [destConfigName, setDestConfigName] = useState<string | null>(null);
    const [destConfig, setDestConfig] = useState<Config | null>(null);
    const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
    const [allTables, setAllTables] = useState<string[]>([]);
    const [selectAllTables, setSelectAllTables] = useState(true);
    const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>('fail');
    const [truncateFirst, _setTruncateFirst] = useState(false);
    const [plan, setPlan] = useState<TransferPlan | null>(null);

    const loadingRef = useRef(false);

    // Get available configs (excluding active)
    const availableConfigs = useMemo(() => {

        if (!stateManager) return [];

        const configs = stateManager.listConfigs();

        return configs.filter((c) => c.name !== activeConfigName);

    }, [stateManager, activeConfigName]);

    // Config items for SelectList
    const configItems: SelectListItem<string>[] = useMemo(() => {

        return availableConfigs.map((c) => ({
            key: c.name,
            label: c.name,
            value: c.name,
            description: `${c.dialect} - ${c.database}`,
        }));

    }, [availableConfigs]);

    // Table items for SelectList (during select-tables phase)
    const tableItems: SelectListItem<string>[] = useMemo(() => {

        const allItem: SelectListItem<string> = {
            key: '__all__',
            label: selectAllTables ? '[x] All tables' : '[ ] All tables',
            value: '__all__',
            description: `Transfer all ${allTables.length} tables`,
        };

        if (selectAllTables) {

            return [allItem];

        }

        const items: SelectListItem<string>[] = [allItem];

        for (const table of allTables) {

            items.push({
                key: table,
                label: selectedTables.has(table) ? `[x] ${table}` : `[ ] ${table}`,
                value: table,
            });

        }

        return items;

    }, [allTables, selectedTables, selectAllTables]);

    // Options items
    const conflictItems: SelectListItem<ConflictStrategy>[] = [
        { key: 'fail', label: 'Fail on conflict', value: 'fail', description: 'Abort transfer on first duplicate' },
        { key: 'skip', label: 'Skip conflicts', value: 'skip', description: 'Skip rows that already exist' },
        { key: 'update', label: 'Update existing', value: 'update', description: 'Update existing rows with source data' },
        { key: 'replace', label: 'Replace rows', value: 'replace', description: 'Delete and re-insert conflicting rows' },
    ];

    // Load destination config and tables when selected
    useEffect(() => {

        if (!destConfigName || !stateManager || !activeConfig) return;
        if (loadingRef.current) return;

        loadingRef.current = true;
        let cancelled = false;

        const load = async () => {

            const config = stateManager.getConfig(destConfigName);

            if (!config) {

                if (!cancelled) {

                    setError(`Config not found: ${destConfigName}`);
                    setPhase('error');

                }

                loadingRef.current = false;

                return;

            }

            setDestConfig(config);

            // Get transfer plan to list tables
            const [planResult, planErr] = await getTransferPlan(activeConfig, config, {});

            if (!cancelled) {

                if (planErr) {

                    setError(planErr.message);
                    setPhase('error');

                }
                else if (planResult) {

                    setAllTables(planResult.tables.map((t) => t.name));
                    setPhase('select-tables');

                }

            }

            loadingRef.current = false;

        };

        load();

        return () => {

            cancelled = true;

        };

    }, [destConfigName, stateManager, activeConfig]);

    // Handle destination selection
    const handleDestSelect = useCallback((item: SelectListItem<string>) => {

        setDestConfigName(item.value);

    }, []);

    // Handle table selection toggle
    const handleTableToggle = useCallback((item: SelectListItem<string>) => {

        if (item.value === '__all__') {

            setSelectAllTables((prev) => !prev);

            if (!selectAllTables) {

                setSelectedTables(new Set());

            }

        }
        else {

            setSelectedTables((prev) => {

                const next = new Set(prev);

                if (next.has(item.value)) {

                    next.delete(item.value);

                }
                else {

                    next.add(item.value);

                }

                return next;

            });
            setSelectAllTables(false);

        }

    }, [selectAllTables]);

    // Handle table selection submit
    const handleTablesSubmit = useCallback(() => {

        if (!selectAllTables && selectedTables.size === 0) {

            showToast({ message: 'Select at least one table', variant: 'warning' });

            return;

        }

        setPhase('options');

    }, [selectAllTables, selectedTables.size, showToast]);

    // Handle conflict strategy selection
    const handleConflictSelect = useCallback((item: SelectListItem<ConflictStrategy>) => {

        setConflictStrategy(item.value);
        // Move to plan phase
        loadPlan();

    }, []);

    // Load transfer plan
    const loadPlan = useCallback(async () => {

        if (!activeConfig || !destConfig) return;

        setPhase('plan');
        const tables = selectAllTables ? undefined : Array.from(selectedTables);

        const [planResult, planErr] = await getTransferPlan(activeConfig, destConfig, {
            tables,
            onConflict: conflictStrategy,
            truncateFirst,
        });

        if (planErr) {

            setError(planErr.message);
            setPhase('error');

        }
        else {

            setPlan(planResult);

        }

    }, [activeConfig, destConfig, selectAllTables, selectedTables, conflictStrategy, truncateFirst]);

    // Execute transfer
    const executeTransfer = useCallback(async () => {

        if (!activeConfig || !destConfig) return;

        setPhase('running');
        resetProgress();

        const tables = selectAllTables ? undefined : Array.from(selectedTables);

        const options: TransferOptions = {
            tables,
            onConflict: conflictStrategy,
            truncateFirst,
        };

        const [_result, err] = await transferData(activeConfig, destConfig, options);

        if (err) {

            setError(err.message);
            setPhase('error');

        }
        else {

            setPhase('complete');

        }

    }, [activeConfig, destConfig, selectAllTables, selectedTables, conflictStrategy, truncateFirst, resetProgress]);

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Data Transfer" borderColor="red" paddingX={1} paddingY={1}>
                <Text color="red">No active configuration selected.</Text>
            </Panel>
        );

    }

    // Error
    if (phase === 'error') {

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler focusLabel="DbTransferError" onEscape={back} />
                <Panel title="Transfer Failed" borderColor="red" paddingX={1} paddingY={1}>
                    <Text color="red">{error}</Text>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Select destination
    if (phase === 'select-dest') {

        if (availableConfigs.length === 0) {

            return (
                <Box flexDirection="column" gap={1}>
                    <KeyHandler focusLabel="DbTransferNoConfigs" onEscape={back} />
                    <Panel title="Data Transfer" borderColor="yellow" paddingX={1} paddingY={1}>
                        <Text color="yellow">No other configurations available.</Text>
                        <Text dimColor>Add another config to transfer data.</Text>
                    </Panel>
                    <Box flexWrap="wrap" columnGap={2}>
                        <Text dimColor>[Esc] Back</Text>
                    </Box>
                </Box>
            );

        }

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Data Transfer - Select Destination" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text>
                            Source: <Text bold color="cyan">{activeConfigName}</Text>
                        </Text>
                        <Text dimColor>Select destination config:</Text>
                        <Box flexDirection="column" height={Math.min(configItems.length + 2, 12)}>
                            <SelectList
                                focusLabel="DbTransferDestSelect"
                                items={configItems}
                                onSelect={handleDestSelect}
                                onCancel={back}
                                visibleCount={10}
                            />
                        </Box>
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter] Select</Text>
                    <Text dimColor>[Esc] Cancel</Text>
                </Box>
            </Box>
        );

    }

    // Select tables
    if (phase === 'select-tables') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Data Transfer - Select Tables" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text>
                            <Text dimColor>From:</Text> <Text bold>{activeConfigName}</Text>
                            <Text dimColor> → </Text>
                            <Text bold color="cyan">{destConfigName}</Text>
                        </Text>
                        <Text dimColor>
                            Space to toggle, Enter to continue ({selectAllTables ? 'all' : selectedTables.size} selected)
                        </Text>
                        <Box flexDirection="column" height={Math.min(tableItems.length + 2, 15)}>
                            <SelectList
                                focusLabel="DbTransferTableSelect"
                                items={tableItems}
                                multiSelect={true}
                                onToggle={handleTableToggle}
                                onSubmit={handleTablesSubmit}
                                onCancel={() => setPhase('select-dest')}
                                visibleCount={12}
                            />
                        </Box>
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Space] Toggle</Text>
                    <Text dimColor>[Enter] Continue</Text>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Options
    if (phase === 'options') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Data Transfer - Options" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text dimColor>How should conflicts be handled?</Text>
                        <Box flexDirection="column" height={8}>
                            <SelectList
                                focusLabel="DbTransferOptionsSelect"
                                items={conflictItems}
                                onSelect={handleConflictSelect}
                                onCancel={() => setPhase('select-tables')}
                                visibleCount={4}
                            />
                        </Box>
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter] Continue</Text>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Plan
    if (phase === 'plan' && plan) {

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler focusLabel="DbTransferPlan" onEscape={() => setPhase('options')} onEnter={() => setPhase('confirm')} />
                <Panel title="Data Transfer - Plan" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Box gap={2}>
                            <Text>Tables: <Text bold>{plan.tables.length}</Text></Text>
                            <Text>Rows: <Text bold>~{plan.estimatedRows.toLocaleString()}</Text></Text>
                            <Text>Mode: <Text bold>{plan.sameServer ? 'Direct SQL' : 'Batch'}</Text></Text>
                        </Box>

                        {plan.warnings.length > 0 && (
                            <Box flexDirection="column" marginTop={1}>
                                <Text color="yellow" bold>Warnings:</Text>
                                {plan.warnings.map((w, i) => (
                                    <Text key={i} color="yellow" dimColor>  - {w}</Text>
                                ))}
                            </Box>
                        )}

                        <Box flexDirection="column" marginTop={1}>
                            <Text bold>Transfer order:</Text>
                            {plan.tables.slice(0, 10).map((t) => (
                                <Text key={t.name} dimColor>
                                    {'  '}{t.name} ({t.rowCount.toLocaleString()} rows)
                                    {t.dependsOn.length > 0 && ` → after ${t.dependsOn.join(', ')}`}
                                </Text>
                            ))}
                            {plan.tables.length > 10 && (
                                <Text dimColor>  ... and {plan.tables.length - 10} more</Text>
                            )}
                        </Box>
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter] Continue</Text>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Loading plan
    if (phase === 'plan' && !plan) {

        return (
            <Panel title="Data Transfer" paddingX={1} paddingY={1}>
                <Spinner label="Building transfer plan..." />
            </Panel>
        );

    }

    // Confirm
    if (phase === 'confirm') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Data Transfer - Confirm" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text>
                            Transfer <Text bold>{plan?.tables.length}</Text> tables from{' '}
                            <Text bold>{activeConfigName}</Text> to{' '}
                            <Text bold color="cyan">{destConfigName}</Text>?
                        </Text>
                        <Text dimColor>
                            Estimated rows: {plan?.estimatedRows.toLocaleString()}
                        </Text>
                        <Text dimColor>
                            Conflict strategy: {conflictStrategy}
                        </Text>
                    </Box>
                </Panel>

                <Confirm
                    focusLabel="DbTransferConfirm"
                    message="Start transfer?"
                    onConfirm={executeTransfer}
                    onCancel={() => setPhase('plan')}
                />
            </Box>
        );

    }

    // Running
    if (phase === 'running') {

        const tableProgress = progress.tableCount > 0
            ? progress.tablesCompleted / progress.tableCount
            : 0;

        const rowProgress = progress.currentRowsTotal > 0
            ? progress.currentRowsTransferred / progress.currentRowsTotal
            : 0;

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler
                    focusLabel="DbTransferRunning"
                    toastMessage="Cannot cancel running transfer"
                    showToast={showToast}
                />
                <Panel title="Data Transfer - Running" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        {progress.currentTable && (
                            <Text>
                                Transferring: <Text bold color="cyan">{progress.currentTable}</Text>
                                {' '}({progress.currentIndex + 1}/{progress.tableCount})
                            </Text>
                        )}

                        {!progress.currentTable && progress.phase === 'planning' && (
                            <Spinner label="Planning transfer..." />
                        )}

                        {progress.currentTable && (
                            <Box flexDirection="column" gap={1}>
                                <Box gap={1}>
                                    <Text dimColor>Table:</Text>
                                    <Box width={40}>
                                        <ProgressBar value={rowProgress} />
                                    </Box>
                                    <Text dimColor>
                                        {progress.currentRowsTransferred.toLocaleString()}/{progress.currentRowsTotal.toLocaleString()}
                                    </Text>
                                </Box>
                            </Box>
                        )}

                        <Box gap={1}>
                            <Text dimColor>Overall:</Text>
                            <Box width={40}>
                                <ProgressBar value={tableProgress} />
                            </Box>
                            <Text dimColor>
                                {progress.tablesCompleted}/{progress.tableCount} tables
                            </Text>
                        </Box>

                        <Box gap={3} marginTop={1}>
                            <Text>
                                <Text color="green">{progress.rowsTransferred.toLocaleString()}</Text> rows transferred
                            </Text>
                            {progress.rowsSkipped > 0 && (
                                <Text>
                                    <Text color="yellow">{progress.rowsSkipped.toLocaleString()}</Text> skipped
                                </Text>
                            )}
                        </Box>
                    </Box>
                </Panel>
            </Box>
        );

    }

    // Complete
    if (phase === 'complete') {

        const failures = progress.results.filter((r) => r.status === 'failed');

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler focusLabel="DbTransferComplete" onEscape={back} />
                <Panel
                    title="Data Transfer - Complete"
                    borderColor={progress.status === 'success' ? 'green' : 'yellow'}
                    paddingX={1}
                    paddingY={1}
                >
                    <Box flexDirection="column" gap={1}>
                        <Text color={progress.status === 'success' ? 'green' : 'yellow'}>
                            Transfer {progress.status === 'success' ? 'completed' : 'completed with issues'}
                        </Text>

                        <Box gap={3}>
                            <Text>
                                <Text bold color="green">{progress.rowsTransferred.toLocaleString()}</Text> rows transferred
                            </Text>
                            {progress.rowsSkipped > 0 && (
                                <Text>
                                    <Text bold color="yellow">{progress.rowsSkipped.toLocaleString()}</Text> skipped
                                </Text>
                            )}
                        </Box>

                        <Text dimColor>
                            {progress.tablesCompleted} tables in {(progress.durationMs / 1000).toFixed(2)}s
                        </Text>

                        {failures.length > 0 && (
                            <Box flexDirection="column" marginTop={1}>
                                <Text color="red" bold>Failures:</Text>
                                {failures.map((f) => (
                                    <Text key={f.table} color="red" dimColor>
                                        {'  '}{f.table}: {f.error}
                                    </Text>
                                ))}
                            </Box>
                        )}
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Done</Text>
                </Box>
            </Box>
        );

    }

    return <></>;

}

/**
 * Component that handles keyboard input.
 */
function KeyHandler({
    focusLabel,
    onEscape,
    onEnter,
    toastMessage,
    showToast,
}: {
    focusLabel: string;
    onEscape?: () => void;
    onEnter?: () => void;
    toastMessage?: string;
    showToast?: (opts: { message: string; variant: 'warning' }) => void;
}): null {

    const { isFocused } = useFocusScope(focusLabel);

    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            if (toastMessage && showToast) {

                showToast({ message: toastMessage, variant: 'warning' });

            }
            else if (onEscape) {

                onEscape();

            }

            return;

        }

        if (key.return && onEnter) {

            onEnter();

        }

    });

    return null;

}
