/**
 * DbTransferScreen - cross-database data transfer with export/import.
 *
 * Transfers data between database configurations with:
 * - Same-server optimization (direct SQL)
 * - Cross-server batch transfers
 * - Cross-dialect type conversion
 * - Configurable conflict resolution
 * - FK dependency ordering
 * - .dt file export and import
 *
 * Phases:
 * 1. select-dest: Choose destination config (or export/import)
 * 2. select-tables: Multi-select tables (or "all")
 * 3. options: Configure conflict strategy, batching
 * 4. export-options: File path, format, passphrase for export
 * 5. import-file: File path input for import
 * 6. import-passphrase: Passphrase input for .dtzx files
 * 7. import-preview: Schema validation and preview
 * 8. plan: Show transfer plan with warnings
 * 9. confirm: Final confirmation
 * 10. running: Progress with table-by-table status
 * 11. complete: Results summary
 *
 * @example
 * ```bash
 * noorm db transfer    # Opens this screen
 * ```
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { ProgressBar, TextInput } from '@inkjs/ui';

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
    FilePicker,
    type SelectListItem,
} from '../../components/index.js';

import { transferData, getTransferPlan } from '../../../core/transfer/index.js';
import {
    exportTable,
    importDtFile,
    DtReader,
    resolveExportExtension,
    ensureExportDirectory,
} from '../../../core/dt/index.js';
import type { TransferOptions, TransferPlan, ConflictStrategy } from '../../../core/transfer/index.js';
import type { Config } from '../../../core/config/types.js';
import type { DtSchema } from '../../../core/dt/index.js';

type TransferMode = 'db-to-db' | 'export' | 'import';

type Phase =
    | 'select-dest'
    | 'select-tables'
    | 'options'
    | 'export-options'
    | 'import-file'
    | 'import-passphrase'
    | 'import-preview'
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

    // Export/import state
    const [transferMode, setTransferMode] = useState<TransferMode>('db-to-db');
    const [exportDirectory, setExportDirectory] = useState('./export/');
    const [exportFilename, setExportFilename] = useState('');
    const [compress, setCompress] = useState(false);
    const [encrypt, setEncrypt] = useState(false);
    const [passphrase, setPassphrase] = useState('');
    const [importFiles, setImportFiles] = useState<string[]>([]);
    const [availableDtFiles, setAvailableDtFiles] = useState<string[]>([]);
    const [scanningFiles, setScanningFiles] = useState(false);
    const [importSchemas, setImportSchemas] = useState<Map<string, DtSchema>>(new Map());
    const [loadingSchemas, setLoadingSchemas] = useState(false);

    const loadingRef = useRef(false);

    // Get available configs (excluding active)
    const availableConfigs = useMemo(() => {

        if (!stateManager) return [];

        const configs = stateManager.listConfigs();

        return configs.filter((c) => c.name !== activeConfigName);

    }, [stateManager, activeConfigName]);

    // Config items for SelectList (includes export/import options)
    const configItems: SelectListItem<string>[] = useMemo(() => {

        const items: SelectListItem<string>[] = availableConfigs.map((c) => ({
            key: c.name,
            label: c.name,
            value: c.name,
            description: `${c.dialect} - ${c.database}`,
        }));

        items.push(
            {
                key: '__export__',
                label: 'Export to .dt file',
                value: '__export__',
                description: 'Export tables to portable .dt format',
            },
            {
                key: '__import__',
                label: 'Import from .dt file',
                value: '__import__',
                description: 'Import data from a .dt/.dtz/.dtzx file',
            },
        );

        return items;

    }, [availableConfigs]);

    // Table items for SelectList (during select-tables phase)
    const tableItems: SelectListItem<string>[] = useMemo(() => {

        const allItem: SelectListItem<string> = {
            key: '__all__',
            label: selectAllTables ? '[x] All tables' : '[ ] All tables',
            value: '__all__',
            description: `Transfer all ${allTables.length} tables`,
        };

        const items: SelectListItem<string>[] = [allItem];

        for (const table of allTables) {

            // When "All tables" is selected, show all as checked
            const isChecked = selectAllTables || selectedTables.has(table);

            items.push({
                key: table,
                label: isChecked ? `[x] ${table}` : `[ ] ${table}`,
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

    // Load tables from active config for export mode
    useEffect(() => {

        if (transferMode !== 'export' || phase !== 'select-tables') return;
        if (!stateManager || !activeConfig) return;
        if (allTables.length > 0) return;

        let cancelled = false;

        const load = async () => {

            // Use a dummy dest config (same as source) to get table list
            const [planResult, planErr] = await getTransferPlan(activeConfig, activeConfig, {});

            if (!cancelled) {

                if (planErr) {

                    setError(planErr.message);
                    setPhase('error');

                }
                else if (planResult) {

                    setAllTables(planResult.tables.map((t) => t.name));

                }

            }

        };

        load();

        return () => {

            cancelled = true;

        };

    }, [transferMode, phase, stateManager, activeConfig, allTables.length]);

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

    // Scan for .dt files when entering import mode
    useEffect(() => {

        if (transferMode !== 'import' || phase !== 'import-file') return;
        if (availableDtFiles.length > 0) return;

        let cancelled = false;

        const scan = async () => {

            setScanningFiles(true);

            const { readdir } = await import('fs/promises');
            const { join } = await import('path');

            const dtFiles: string[] = [];
            const ignoreDirs = new Set(['node_modules', '.git', '.noorm', 'dist', 'build']);

            const scanDir = async (dir: string, prefix = ''): Promise<void> => {

                if (cancelled) return;

                const entries = await readdir(dir, { withFileTypes: true });

                for (const entry of entries) {

                    if (cancelled) break;

                    const fullPath = join(dir, entry.name);
                    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

                    if (entry.isDirectory()) {

                        if (!ignoreDirs.has(entry.name) && !entry.name.startsWith('.')) {

                            await scanDir(fullPath, relativePath);

                        }

                    }
                    else if (entry.isFile()) {

                        const lower = entry.name.toLowerCase();

                        if (lower.endsWith('.dt') || lower.endsWith('.dtz') || lower.endsWith('.dtzx')) {

                            dtFiles.push(relativePath);

                        }

                    }

                }

            };

            await scanDir(process.cwd());

            if (!cancelled) {

                setAvailableDtFiles(dtFiles.sort());
                setScanningFiles(false);

            }

        };

        scan();

        return () => {

            cancelled = true;

        };

    }, [transferMode, phase, availableDtFiles.length]);

    // Handle destination selection
    const handleDestSelect = useCallback((item: SelectListItem<string>) => {

        if (item.value === '__export__') {

            setTransferMode('export');
            setPhase('select-tables');

            return;

        }

        if (item.value === '__import__') {

            setTransferMode('import');
            setPhase('import-file');

            return;

        }

        setTransferMode('db-to-db');
        setDestConfigName(item.value);

    }, []);

    // Handle table selection toggle
    const handleTableToggle = useCallback((item: SelectListItem<string>) => {

        if (item.value === '__all__') {

            setSelectAllTables((prev) => !prev);

            if (!selectAllTables) {

                // Switching to "all" - clear individual selections
                setSelectedTables(new Set());

            }

        }
        else {

            if (selectAllTables) {

                // User had "All tables" selected, now deselecting one
                // Select all tables EXCEPT the clicked one
                const allExceptClicked = new Set(allTables.filter((t) => t !== item.value));

                setSelectedTables(allExceptClicked);
                setSelectAllTables(false);

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

            }

        }

    }, [selectAllTables, allTables]);

    // Handle table selection submit
    const handleTablesSubmit = useCallback(() => {

        if (!selectAllTables && selectedTables.size === 0) {

            showToast({ message: 'Select at least one table', variant: 'warning' });

            return;

        }

        if (transferMode === 'export') {

            setPhase('export-options');

            return;

        }

        setPhase('options');

    }, [selectAllTables, selectedTables.size, showToast, transferMode]);

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

    // Handle conflict strategy selection
    const handleConflictSelect = useCallback((item: SelectListItem<ConflictStrategy>) => {

        setConflictStrategy(item.value);

        if (transferMode === 'import') {

            setPhase('confirm');

            return;

        }

        // Move to plan phase for db-to-db
        loadPlan();

    }, [transferMode, loadPlan]);

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

    // Execute export
    const executeExport = useCallback(async () => {

        if (!activeConfig) return;

        setPhase('running');
        resetProgress();

        const tables = selectAllTables ? allTables : Array.from(selectedTables);
        const tableCount = tables.length;
        const ext = resolveExportExtension(compress, encrypt ? passphrase : undefined);
        const isSingleTable = tableCount === 1;

        // Ensure directory ends with /
        const dir = exportDirectory.endsWith('/') ? exportDirectory : `${exportDirectory}/`;

        // Ensure export directory exists
        ensureExportDirectory(dir, tableCount);

        const { createConnection } = await import('../../../core/connection/index.js');
        const conn = await createConnection(activeConfig.connection);

        for (const table of tables) {

            // For single table: use user-provided filename, for multi-table: use table name
            const name = isSingleTable ? (exportFilename || table) : table;
            const filepath = `${dir}${name}${ext}`;

            const [_result, err] = await exportTable({
                db: conn.db,
                dialect: activeConfig.connection.dialect,
                tableName: table,
                filepath,
                passphrase: encrypt ? passphrase : undefined,
            });

            if (err) {

                setError(err.message);
                setPhase('error');
                await conn.destroy();

                return;

            }

        }

        await conn.destroy();
        setPhase('complete');

    }, [activeConfig, selectAllTables, allTables, selectedTables, exportDirectory, exportFilename, compress, encrypt, passphrase, resetProgress]);

    // Handle import file selection from picker
    const handleImportFilesSelect = useCallback((files: string[]) => {

        if (files.length === 0) {

            showToast({ message: 'Select at least one file', variant: 'warning' });

            return;

        }

        setImportFiles(files);

        // Check if any file is encrypted (.dtzx)
        const hasEncrypted = files.some((f) => f.toLowerCase().endsWith('.dtzx'));

        if (hasEncrypted) {

            setPhase('import-passphrase');

            return;

        }

        setPhase('import-preview');

    }, [showToast]);

    // Load import schemas for preview
    useEffect(() => {

        if (phase !== 'import-preview') return;
        if (importFiles.length === 0) return;
        if (importSchemas.size > 0) return;

        let cancelled = false;

        const load = async () => {

            setLoadingSchemas(true);
            const schemas = new Map<string, DtSchema>();

            for (const filepath of importFiles) {

                if (cancelled) break;

                const reader = new DtReader({
                    filepath,
                    passphrase: passphrase || undefined,
                });

                try {

                    await reader.open();
                    const schema = reader.schema;
                    reader.close();

                    if (schema) {

                        schemas.set(filepath, schema);

                    }

                }
                catch (err) {

                    if (!cancelled) {

                        setError(`Failed to read ${filepath}: ${err instanceof Error ? err.message : String(err)}`);
                        setPhase('error');
                        setLoadingSchemas(false);

                        return;

                    }

                }

            }

            if (!cancelled) {

                setImportSchemas(schemas);
                setLoadingSchemas(false);

            }

        };

        load();

        return () => {

            cancelled = true;

        };

    }, [phase, importFiles, passphrase, importSchemas.size]);

    // Execute import for all selected files
    const executeImport = useCallback(async () => {

        if (!activeConfig || importFiles.length === 0) return;

        setPhase('running');
        resetProgress();

        const { createConnection } = await import('../../../core/connection/index.js');
        const conn = await createConnection(activeConfig.connection);

        for (const filepath of importFiles) {

            const [_result, err] = await importDtFile({
                filepath,
                db: conn.db,
                dialect: activeConfig.connection.dialect,
                passphrase: passphrase || undefined,
                onConflict: conflictStrategy,
                truncate: truncateFirst,
            });

            if (err) {

                setError(`Import failed for ${filepath}: ${err.message}`);
                setPhase('error');
                await conn.destroy();

                return;

            }

        }

        await conn.destroy();
        setPhase('complete');

    }, [activeConfig, importFiles, passphrase, conflictStrategy, truncateFirst, resetProgress]);

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

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Data Transfer - Select Destination" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text>
                            Source: <Text bold color="cyan">{activeConfigName}</Text>
                        </Text>
                        <Text dimColor>Select destination or action:</Text>
                        <Box flexDirection="column" height={Math.min(configItems.length + 2, 14)}>
                            <SelectList
                                focusLabel="DbTransferDestSelect"
                                items={configItems}
                                onSelect={handleDestSelect}
                                onCancel={back}
                                visibleCount={12}
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

    // Export options
    if (phase === 'export-options') {

        const tables = selectAllTables ? allTables : Array.from(selectedTables);
        const isSingleTable = tables.length === 1;
        const ext = resolveExportExtension(compress, encrypt ? 'secret' : undefined);

        // Default filename for single table export
        const defaultFilename = isSingleTable ? tables[0] ?? 'export' : '';

        return (
            <Box flexDirection="column" gap={1}>
                <ExportOptionsInput
                    tableCount={tables.length}
                    directory={exportDirectory}
                    onDirectoryChange={setExportDirectory}
                    filename={exportFilename || defaultFilename}
                    onFilenameChange={setExportFilename}
                    compress={compress}
                    onCompressChange={setCompress}
                    encrypt={encrypt}
                    onEncryptChange={setEncrypt}
                    passphrase={passphrase}
                    onPassphraseChange={setPassphrase}
                    ext={ext}
                    onSubmit={() => {

                        if (encrypt && !passphrase.trim()) {

                            showToast({ message: 'Passphrase required for encryption', variant: 'warning' });

                            return;

                        }

                        // Set default filename if not provided for single table
                        if (isSingleTable && !exportFilename.trim()) {

                            setExportFilename(defaultFilename);

                        }

                        setPhase('confirm');

                    }}
                    onCancel={() => setPhase('select-tables')}
                />
            </Box>
        );

    }

    // Import file picker
    if (phase === 'import-file') {

        if (scanningFiles) {

            return (
                <Panel title="Import - Select Files" paddingX={1} paddingY={1}>
                    <Spinner label="Scanning for .dt files..." />
                </Panel>
            );

        }

        if (availableDtFiles.length === 0) {

            return (
                <Box flexDirection="column" gap={1}>
                    <KeyHandler focusLabel="DbTransferImportEmpty" onEscape={() => setPhase('select-dest')} />
                    <Panel title="Import - Select Files" borderColor="yellow" paddingX={1} paddingY={1}>
                        <Text color="yellow">No .dt, .dtz, or .dtzx files found in the project.</Text>
                    </Panel>
                    <Box>
                        <Text dimColor>[Esc] Back</Text>
                    </Box>
                </Box>
            );

        }

        return (
            <FilePicker
                focusLabel="DbTransferImportPicker"
                files={availableDtFiles}
                selected={importFiles}
                onSelect={handleImportFilesSelect}
                onCancel={() => setPhase('select-dest')}
                visibleCount={12}
            />
        );

    }

    // Import passphrase
    if (phase === 'import-passphrase') {

        return (
            <Box flexDirection="column" gap={1}>
                <ImportPassphraseInput
                    value={passphrase}
                    onChange={setPassphrase}
                    onSubmit={() => setPhase('import-preview')}
                    onCancel={() => {

                        setImportFiles([]);
                        setPhase('import-file');

                    }}
                />
            </Box>
        );

    }

    // Import preview
    if (phase === 'import-preview') {

        if (loadingSchemas || importSchemas.size === 0) {

            return (
                <Panel title="Import Preview" paddingX={1} paddingY={1}>
                    <Spinner label={`Reading ${importFiles.length} file(s)...`} />
                </Panel>
            );

        }

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler
                    focusLabel="DbTransferImportPreview"
                    onEscape={() => {

                        setImportSchemas(new Map());
                        setPhase('import-file');

                    }}
                    onEnter={() => setPhase('options')}
                />
                <Panel title="Import Preview" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text bold>{importFiles.length} file(s) selected:</Text>

                        {Array.from(importSchemas.entries()).map(([filepath, schema]) => (
                            <Box key={filepath} flexDirection="column" marginTop={1}>
                                <Text color="cyan">{filepath}</Text>
                                <Box marginLeft={2} gap={2}>
                                    <Text dimColor>Source: {schema.d} {schema.dv}</Text>
                                    {schema.t && <Text dimColor>Table: {schema.t}</Text>}
                                    <Text dimColor>Columns: {schema.columns.length}</Text>
                                </Box>
                            </Box>
                        ))}
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter] Continue to options</Text>
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

        if (transferMode === 'export') {

            const tables = selectAllTables ? allTables : Array.from(selectedTables);
            const isSingleTable = tables.length === 1;
            const ext = resolveExportExtension(compress, encrypt ? passphrase : undefined);
            const dir = exportDirectory.endsWith('/') ? exportDirectory : `${exportDirectory}/`;
            const name = isSingleTable ? (exportFilename || tables[0]) : '<table>';
            const previewPath = `${dir}${name}${ext}`;

            return (
                <Box flexDirection="column" gap={1}>
                    <Panel title="Export - Confirm" borderColor="yellow" paddingX={1} paddingY={1}>
                        <Box flexDirection="column" gap={1}>
                            <Text>
                                Export <Text bold>{tables.length}</Text> table(s) from{' '}
                                <Text bold>{activeConfigName}</Text>
                            </Text>
                            <Text dimColor>
                                Format: {ext} {compress && !encrypt && '(compressed)'}{encrypt && '(encrypted)'}
                            </Text>
                            <Text dimColor>
                                {isSingleTable ? 'File' : 'Directory'}: {previewPath}
                            </Text>
                            {!isSingleTable && (
                                <Text dimColor>Files: {tables.map((t) => `${t}${ext}`).join(', ')}</Text>
                            )}
                        </Box>
                    </Panel>

                    <Confirm
                        focusLabel="DbTransferConfirm"
                        message="Start export?"
                        onConfirm={executeExport}
                        onCancel={() => setPhase('export-options')}
                    />
                </Box>
            );

        }

        if (transferMode === 'import') {

            return (
                <Box flexDirection="column" gap={1}>
                    <Panel title="Import - Confirm" borderColor="yellow" paddingX={1} paddingY={1}>
                        <Box flexDirection="column" gap={1}>
                            <Text>
                                Import <Text bold>{importFiles.length}</Text> file(s) into{' '}
                                <Text bold color="cyan">{activeConfigName}</Text>
                            </Text>
                            {importFiles.length <= 5 ? (
                                importFiles.map((f) => {

                                    const schema = importSchemas.get(f);

                                    return (
                                        <Text key={f} dimColor>
                                            {'  '}{f}{schema?.t ? ` → ${schema.t}` : ''}
                                        </Text>
                                    );

                                })
                            ) : (
                                <Text dimColor>
                                    {'  '}{importFiles.slice(0, 3).join(', ')} and {importFiles.length - 3} more
                                </Text>
                            )}
                            <Text dimColor>
                                Conflict strategy: {conflictStrategy}
                            </Text>
                        </Box>
                    </Panel>

                    <Confirm
                        focusLabel="DbTransferConfirm"
                        message="Start import?"
                        onConfirm={executeImport}
                        onCancel={() => setPhase('import-preview')}
                    />
                </Box>
            );

        }

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

        const modeLabel = transferMode === 'export' ? 'Exporting' : transferMode === 'import' ? 'Importing' : 'Transferring';
        const titleLabel = transferMode === 'export' ? 'Export' : transferMode === 'import' ? 'Import' : 'Data Transfer';

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
                    toastMessage={`Cannot cancel running ${modeLabel.toLowerCase()}`}
                    showToast={showToast}
                />
                <Panel title={`${titleLabel} - Running`} paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        {progress.currentTable && (
                            <Text>
                                {modeLabel}: <Text bold color="cyan">{progress.currentTable}</Text>
                                {progress.tableCount > 0 && ` (${progress.currentIndex + 1}/${progress.tableCount})`}
                            </Text>
                        )}

                        {!progress.currentTable && progress.phase === 'planning' && (
                            <Spinner label="Planning transfer..." />
                        )}

                        {!progress.currentTable && progress.phase !== 'planning' && (
                            <Spinner label={`${modeLabel}...`} />
                        )}

                        {progress.currentTable && progress.currentRowsTotal > 0 && (
                            <Box flexDirection="column" gap={1}>
                                {progress.sameServer && progress.currentRowsTransferred === 0 ? (
                                    <Spinner label={`Transferring ~${progress.currentRowsTotal.toLocaleString()} rows...`} />
                                ) : (
                                    <Box gap={1}>
                                        <Text dimColor>Table:</Text>
                                        <Box width={40}>
                                            <ProgressBar value={rowProgress} />
                                        </Box>
                                        <Text dimColor>
                                            {progress.currentRowsTransferred.toLocaleString()}/{progress.currentRowsTotal.toLocaleString()}
                                        </Text>
                                    </Box>
                                )}
                            </Box>
                        )}

                        {progress.tableCount > 0 && (
                            <Box gap={1}>
                                <Text dimColor>Overall:</Text>
                                <Box width={40}>
                                    <ProgressBar value={tableProgress} />
                                </Box>
                                <Text dimColor>
                                    {progress.tablesCompleted}/{progress.tableCount} tables
                                </Text>
                            </Box>
                        )}

                        <Box gap={3} marginTop={1}>
                            <Text>
                                <Text color="green">{progress.rowsTransferred.toLocaleString()}</Text> rows {transferMode === 'export' ? 'exported' : transferMode === 'import' ? 'imported' : 'transferred'}
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
        const modeLabel = transferMode === 'export' ? 'Export' : transferMode === 'import' ? 'Import' : 'Transfer';
        const rowLabel = transferMode === 'export' ? 'exported' : transferMode === 'import' ? 'imported' : 'transferred';
        const isSuccess = progress.status === 'success' || progress.status === null;

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler focusLabel="DbTransferComplete" onEscape={back} />
                <Panel
                    title={`${modeLabel} - Complete`}
                    borderColor={isSuccess ? 'green' : 'yellow'}
                    paddingX={1}
                    paddingY={1}
                >
                    <Box flexDirection="column" gap={1}>
                        <Text color={isSuccess ? 'green' : 'yellow'}>
                            {modeLabel} {isSuccess ? 'completed' : 'completed with issues'}
                        </Text>

                        <Box gap={3}>
                            <Text>
                                <Text bold color="green">{progress.rowsTransferred.toLocaleString()}</Text> rows {rowLabel}
                            </Text>
                            {progress.rowsSkipped > 0 && (
                                <Text>
                                    <Text bold color="yellow">{progress.rowsSkipped.toLocaleString()}</Text> skipped
                                </Text>
                            )}
                        </Box>

                        {transferMode === 'export' && progress.exportTables.length > 0 && (
                            <Box flexDirection="column">
                                {progress.exportTables.map((t) => (
                                    <Text key={t.table} dimColor>
                                        {'  '}{t.table}: {t.rowsWritten.toLocaleString()} rows → {t.filepath}
                                    </Text>
                                ))}
                            </Box>
                        )}

                        {progress.durationMs > 0 && (
                            <Text dimColor>
                                {progress.tablesCompleted > 0 ? `${progress.tablesCompleted} table(s) in ` : ''}{(progress.durationMs / 1000).toFixed(2)}s
                            </Text>
                        )}

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

/**
 * Import passphrase input component.
 */
function ImportPassphraseInput({
    value,
    onChange,
    onSubmit,
    onCancel,
}: {
    value: string;
    onChange: (v: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
}): ReactElement {

    const { isFocused } = useFocusScope('DbTransferImportPassphrase');

    useInput((_input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            onCancel();

        }

        if (key.return && value.trim()) {

            onSubmit();

        }

    });

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="Import - Passphrase" paddingX={1} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text dimColor>This is an encrypted .dtzx file. Enter the decryption passphrase:</Text>
                    <Box gap={1}>
                        <Text>Passphrase:</Text>
                        <TextInput
                            defaultValue={value}
                            onChange={onChange}
                            placeholder="passphrase"
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

/**
 * Export field types for the export options form.
 */
type ExportField = 'directory' | 'filename' | 'compress' | 'encrypt' | 'passphrase';

/**
 * Export options input component with navigable form fields.
 *
 * Uses arrow keys to navigate between fields instead of hotkeys
 * to avoid conflicts with text input.
 */
function ExportOptionsInput({
    tableCount,
    directory,
    onDirectoryChange,
    filename,
    onFilenameChange,
    compress,
    onCompressChange,
    encrypt,
    onEncryptChange,
    passphrase,
    onPassphraseChange,
    ext,
    onSubmit,
    onCancel,
}: {
    tableCount: number;
    directory: string;
    onDirectoryChange: (v: string) => void;
    filename: string;
    onFilenameChange: (v: string) => void;
    compress: boolean;
    onCompressChange: (v: boolean) => void;
    encrypt: boolean;
    onEncryptChange: (v: boolean) => void;
    passphrase: string;
    onPassphraseChange: (v: string) => void;
    ext: string;
    onSubmit: () => void;
    onCancel: () => void;
}): ReactElement {

    const { isFocused } = useFocusScope('DbTransferExportOptions');
    const isSingleTable = tableCount === 1;

    // Build list of active fields based on current state
    const fields: ExportField[] = useMemo(() => {

        const result: ExportField[] = ['directory'];

        if (isSingleTable) {

            result.push('filename');

        }

        result.push('compress', 'encrypt');

        if (encrypt) {

            result.push('passphrase');

        }

        return result;

    }, [isSingleTable, encrypt]);

    const [activeIndex, setActiveIndex] = useState(0);
    const activeField = fields[activeIndex] ?? 'directory';

    // Navigate between fields
    const nextField = useCallback(() => {

        setActiveIndex((i) => (i + 1) % fields.length);

    }, [fields.length]);

    const prevField = useCallback(() => {

        setActiveIndex((i) => (i - 1 + fields.length) % fields.length);

    }, [fields.length]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        // Escape - cancel form
        if (key.escape) {

            onCancel();

            return;

        }

        // Tab - next field
        if (key.tab) {

            nextField();

            return;

        }

        // Arrow navigation (only when not on a text field, or for checkboxes)
        const isTextField = activeField === 'directory' || activeField === 'filename' || activeField === 'passphrase';

        if (!isTextField) {

            if (key.downArrow) {

                nextField();

                return;

            }

            if (key.upArrow) {

                prevField();

                return;

            }

        }

        // Enter - submit (only from non-text fields; text fields use onSubmit)
        if (key.return && !isTextField) {

            onSubmit();

            return;

        }

        // Space toggles checkboxes
        if (input === ' ') {

            if (activeField === 'compress') {

                onCompressChange(!compress);

                return;

            }

            if (activeField === 'encrypt') {

                const newEncrypt = !encrypt;

                onEncryptChange(newEncrypt);

                if (newEncrypt) {

                    // Encrypt implies compress
                    onCompressChange(true);

                }

            }

        }

    });

    // Adjust active index if fields shrink (e.g., encrypt toggled off removes passphrase)
    useEffect(() => {

        if (activeIndex >= fields.length) {

            setActiveIndex(fields.length - 1);

        }

    }, [fields.length, activeIndex]);

    const renderField = (field: ExportField): ReactElement | null => {

        const isActive = activeField === field && isFocused;
        const prefix = isActive ? '› ' : '  ';
        const color = isActive ? 'cyan' : 'white';

        switch (field) {

        case 'directory':
            return (
                <Box key="directory" flexDirection="column">
                    <Text color={color}>{prefix}Directory</Text>
                    <Box marginLeft={2}>
                        <TextInput
                            defaultValue={directory}
                            onChange={onDirectoryChange}
                            onSubmit={nextField}
                            placeholder="./export/"
                            isDisabled={!isActive}
                        />
                    </Box>
                </Box>
            );

        case 'filename':
            return (
                <Box key="filename" flexDirection="column">
                    <Text color={color}>{prefix}Filename <Text dimColor>(without extension)</Text></Text>
                    <Box marginLeft={2}>
                        <TextInput
                            defaultValue={filename}
                            onChange={onFilenameChange}
                            onSubmit={nextField}
                            placeholder="export"
                            isDisabled={!isActive}
                        />
                    </Box>
                </Box>
            );

        case 'compress':
            return (
                <Box key="compress">
                    <Text color={color}>
                        {prefix}{compress ? '☑' : '☐'} Compress <Text dimColor>(.dtz)</Text>
                    </Text>
                </Box>
            );

        case 'encrypt':
            return (
                <Box key="encrypt">
                    <Text color={color}>
                        {prefix}{encrypt ? '☑' : '☐'} Encrypt <Text dimColor>(.dtzx)</Text>
                    </Text>
                </Box>
            );

        case 'passphrase':
            return (
                <Box key="passphrase" flexDirection="column">
                    <Text color={color}>{prefix}Passphrase</Text>
                    <Box marginLeft={2}>
                        <TextInput
                            defaultValue={passphrase}
                            onChange={onPassphraseChange}
                            onSubmit={onSubmit}
                            placeholder="encryption passphrase"
                            isDisabled={!isActive}
                        />
                    </Box>
                </Box>
            );

        default:
            return null;

        }

    };

    // Build preview path
    const previewPath = isSingleTable
        ? `${directory}${filename}${ext}`
        : `${directory}<table>${ext}`;

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="Data Transfer - Export Options" paddingX={1} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text dimColor>
                        Exporting {tableCount} table(s) — {isSingleTable ? 'single file' : 'one file per table'}
                    </Text>

                    <Box flexDirection="column" marginTop={1} gap={1}>
                        {fields.map(renderField)}
                    </Box>

                    <Box marginTop={1}>
                        <Text dimColor>Output: </Text>
                        <Text bold color="cyan">{previewPath}</Text>
                    </Box>
                </Box>
            </Panel>
            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[↑↓] Navigate</Text>
                <Text dimColor>[Space] Toggle</Text>
                <Text dimColor>[Enter] Continue</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
