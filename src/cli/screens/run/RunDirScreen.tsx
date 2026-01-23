/**
 * RunDirScreen - execute all SQL files in a directory.
 *
 * Uses a directory picker to select from discovered directories.
 *
 * @example
 * ```bash
 * noorm run dir              # Opens this screen
 * noorm run dir sql/tables  # With pre-filled path
 * ```
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { ProgressBar } from '@inkjs/ui';
import { join, relative, dirname } from 'path';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useSettings, useGlobalModes, useAppContext } from '../../app-context.js';
import { Panel, Spinner, Confirm, SelectList, FilePicker, useToast } from '../../components/index.js';
import { useRunProgress } from '../../hooks/index.js';
import { discoverFiles, runFiles, checkFilesStatus } from '../../../core/runner/index.js';
import type { FilesStatusResult } from '../../../core/runner/index.js';
import { createConnection, testConnection } from '../../../core/connection/index.js';
import { resolveIdentity } from '../../../core/identity/index.js';
import { attempt } from '@logosdx/utils';

import type { NoormDatabase } from '../../../core/shared/index.js';
import type { Kysely } from 'kysely';
import type { RunContext } from '../../../core/runner/index.js';
import type { SelectListItem } from '../../components/index.js';

type Phase = 'loading' | 'picker' | 'confirm' | 'checking' | 'rerun-confirm' | 'running' | 'complete' | 'error';

/**
 * Component that handles Escape, Cancel (c), and Retry (r) keys.
 */
function KeyHandler({
    focusLabel,
    onEscape,
    onRetry,
    onCancel,
}: {
    focusLabel: string;
    onEscape?: () => void;
    onRetry?: () => void;
    onCancel?: () => void;
}): null {

    const { isFocused } = useFocusScope(focusLabel);

    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            if (onCancel) {

                onCancel();

            }
            else if (onEscape) {

                onEscape();

            }

            return;

        }

        if (input === 'r' && onRetry) {

            onRetry();

        }

        if (input === 'c' && onCancel) {

            onCancel();

        }

    });

    return null;

}

/**
 * Extract unique directories from file paths.
 * Returns directories relative to the project root.
 */
function extractDirectories(files: string[], projectRoot: string, sqlPath: string): string[] {

    const dirs = new Set<string>();

    // Always include the schema path itself as an option
    dirs.add(sqlPath);

    for (const file of files) {

        const relativePath = relative(projectRoot, file);
        const dir = dirname(relativePath);

        // Add the directory and all parent directories
        let current = dir;

        while (current && current !== '.') {

            dirs.add(current);
            const parent = dirname(current);

            if (parent === current || parent === '.') break;

            current = parent;

        }

    }

    return Array.from(dirs).sort();

}

/**
 * RunDirScreen component.
 */
export function RunDirScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { activeConfig, activeConfigName, stateManager, identity: cryptoIdentity } = useAppContext();
    const { settings } = useSettings();
    const globalModes = useGlobalModes();
    const { showToast } = useToast();
    const { state: progress, reset: resetProgress } = useRunProgress();

    const [phase, setPhase] = useState<Phase>('loading');
    const [allFiles, setAllFiles] = useState<string[]>([]);
    const [directories, setDirectories] = useState<string[]>([]);
    const [selectedDir, setSelectedDir] = useState<string | null>(params.path ?? null);
    const [selectedDirFiles, setSelectedDirFiles] = useState<string[]>([]);
    const [fileCount, setFileCount] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [filesStatus, setFilesStatus] = useState<FilesStatusResult | null>(null);
    const [forceRerun, setForceRerun] = useState(false);

    // Refs for cancellation support
    const activeConnectionRef = useRef<{ destroy: () => Promise<void> } | null>(null);
    const cancelledRef = useRef(false);

    const projectRoot = process.cwd();
    const sqlPath = settings?.paths?.sql ?? 'sql';

    // Load files and extract directories on mount
    useEffect(() => {

        if (!activeConfig || !settings) return;

        let cancelled = false;

        const load = async () => {

            setPhase('loading');

            const sqlFullPath = join(projectRoot, sqlPath);

            const [files, err] = await attempt(() => discoverFiles(sqlFullPath));

            if (cancelled) return;

            if (err) {

                setError(`Failed to discover files: ${err.message}`);
                setPhase('error');

                return;

            }

            setAllFiles(files ?? []);

            const dirs = extractDirectories(files ?? [], projectRoot, sqlPath);
            setDirectories(dirs);

            // If pre-filled path provided, validate and go to confirm
            if (params.path) {

                if (dirs.includes(params.path)) {

                    setSelectedDir(params.path);

                    // Get files in this directory
                    const dirFiles = (files ?? []).filter((f) =>
                        relative(projectRoot, f).startsWith(params.path + '/') ||
                        dirname(relative(projectRoot, f)) === params.path,
                    );
                    setSelectedDirFiles(dirFiles);
                    setFileCount(dirFiles.length);
                    setShowConfirmDialog(false);
                    setPhase('confirm');

                    return;

                }

            }

            setPhase('picker');

        };

        load();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, settings, projectRoot, sqlPath, params.path]);

    // Handle directory selection
    const handleSelect = useCallback((item: SelectListItem<string>) => {

        setSelectedDir(item.value);

        // Get files in this directory
        const dirFiles = allFiles.filter((f) =>
            relative(projectRoot, f).startsWith(item.value + '/') ||
            dirname(relative(projectRoot, f)) === item.value,
        );
        setSelectedDirFiles(dirFiles);
        setFileCount(dirFiles.length);
        setShowConfirmDialog(false);
        setPhase('confirm');

    }, [allFiles, projectRoot]);

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Track whether we should proceed to execution after status check
    const [proceedToExecute, setProceedToExecute] = useState(false);

    // Check files status before execution
    const checkDirFilesStatus = useCallback(async () => {

        if (!activeConfig || !activeConfigName || !stateManager || selectedDirFiles.length === 0) return;

        // If global force mode is enabled, skip the check and execute directly
        if (globalModes.force) {

            setForceRerun(true);
            setProceedToExecute(true);

            return;

        }

        setPhase('checking');

        // Resolve identity
        const identity = resolveIdentity({
            cryptoIdentity: cryptoIdentity ?? null,
        });

        // Test connection
        const testResult = await testConnection(activeConfig.connection);

        if (!testResult.ok) {

            setError(`Connection failed: ${testResult.error}`);
            setPhase('error');

            return;

        }

        // Create connection
        const [conn, connErr] = await attempt(() =>
            createConnection(activeConfig.connection, activeConfigName),
        );

        if (connErr || !conn) {

            setError(`Connection failed: ${connErr?.message ?? 'Unknown error'}`);
            setPhase('error');

            return;

        }

        try {

            const db = conn.db as Kysely<NoormDatabase>;

            const context: RunContext = {
                db,
                configName: activeConfigName,
                identity,
                projectRoot,
                config: activeConfig as unknown as Record<string, unknown>,
                secrets: stateManager.getAllSecrets(activeConfigName),
                globalSecrets: stateManager.getAllGlobalSecrets(),
            };

            const status = await checkFilesStatus(context, selectedDirFiles);
            setFilesStatus(status);

            // If any files were previously run (would be skipped), show rerun confirmation
            if (status.previouslyRunFiles.length > 0) {

                setPhase('rerun-confirm');

            }
            else {

                // All files are new or changed, proceed to execution
                setProceedToExecute(true);

            }

        }
        catch (err) {

            setError(err instanceof Error ? err.message : String(err));
            setPhase('error');

        }
        finally {

            await conn.destroy();

        }

    }, [activeConfig, activeConfigName, stateManager, selectedDirFiles, globalModes.force, cryptoIdentity, projectRoot]);

    // Execute selected files (actual execution)
    const executeDir = useCallback(async (force: boolean = false) => {

        if (!activeConfig || !activeConfigName || !stateManager || selectedDirFiles.length === 0) return;

        // Reset cancellation flag
        cancelledRef.current = false;

        setPhase('running');
        resetProgress(selectedDirFiles.length);

        // Resolve identity
        const identity = resolveIdentity({
            cryptoIdentity: cryptoIdentity ?? null,
        });

        // Test connection
        const testResult = await testConnection(activeConfig.connection);

        if (!testResult.ok) {

            setError(`Connection failed: ${testResult.error}`);
            setPhase('error');

            return;

        }

        // Check if cancelled during connection test
        if (cancelledRef.current) {

            setError('Execution cancelled');
            setPhase('error');

            return;

        }

        // Create connection
        const [conn, connErr] = await attempt(() =>
            createConnection(activeConfig.connection, activeConfigName),
        );

        if (connErr || !conn) {

            setError(`Connection failed: ${connErr?.message ?? 'Unknown error'}`);
            setPhase('error');

            return;

        }

        // Store connection ref for cancellation
        activeConnectionRef.current = conn;

        try {

            // Check if cancelled during connection creation
            if (cancelledRef.current) {

                setError('Execution cancelled');
                setPhase('error');

                return;

            }

            const db = conn.db as Kysely<NoormDatabase>;

            const context: RunContext = {
                db,
                configName: activeConfigName,
                identity,
                projectRoot,
                config: activeConfig as unknown as Record<string, unknown>,
                secrets: stateManager.getAllSecrets(activeConfigName),
                globalSecrets: stateManager.getAllGlobalSecrets(),
            };

            const options = {
                force: force || forceRerun || globalModes.force,
                dryRun: globalModes.dryRun,
                abortOnError: true,
            };

            await runFiles(context, selectedDirFiles, options);

            // Check if cancelled during execution
            if (cancelledRef.current) {

                setError('Execution cancelled');
                setPhase('error');

                return;

            }

            setPhase('complete');

        }
        catch (err) {

            // Don't show error if cancelled (connection destroyed intentionally)
            if (cancelledRef.current) {

                setError('Execution cancelled');

            }
            else {

                setError(err instanceof Error ? err.message : String(err));

            }

            setPhase('error');

        }
        finally {

            activeConnectionRef.current = null;
            await conn.destroy();

        }

    }, [activeConfig, activeConfigName, stateManager, selectedDirFiles, globalModes, forceRerun, resetProgress, projectRoot, cryptoIdentity]);

    // Cancel running execution
    const cancelExecution = useCallback(async () => {

        cancelledRef.current = true;

        if (activeConnectionRef.current) {

            showToast({ message: 'Cancelling execution...', variant: 'warning' });

            try {

                await activeConnectionRef.current.destroy();

            }
            catch {
                // Ignore destroy errors during cancellation
            }

            activeConnectionRef.current = null;

        }

    }, [showToast]);

    // Handle rerun confirmation
    const handleConfirmRerun = useCallback(() => {

        setForceRerun(true);
        executeDir(true);

    }, [executeDir]);

    // Handle cancel rerun (go back to file picker)
    const handleCancelRerun = useCallback(() => {

        setFilesStatus(null);
        setForceRerun(false);
        setShowConfirmDialog(false);
        setPhase('confirm');

    }, []);

    // Trigger execution when proceedToExecute becomes true
    useEffect(() => {

        if (proceedToExecute) {

            setProceedToExecute(false);
            executeDir(forceRerun);

        }

    }, [proceedToExecute, executeDir, forceRerun]);

    // Create directory items for SelectList
    const dirItems: SelectListItem<string>[] = useMemo(() => {

        return directories.map((dir) => {

            // Count files in this directory
            const count = allFiles.filter((f) =>
                relative(projectRoot, f).startsWith(dir + '/') ||
                dirname(relative(projectRoot, f)) === dir,
            ).length;

            return {
                key: dir,
                label: dir,
                description: `${count} files`,
                value: dir,
            };

        });

    }, [directories, allFiles, projectRoot]);

    // Convert file paths to relative for FilePicker display
    const relativeFiles = useMemo(() => {

        return selectedDirFiles.map((f) => relative(projectRoot, f));

    }, [selectedDirFiles, projectRoot]);

    // Handle file selection from FilePicker
    const handleFileSelect = useCallback((files: string[]) => {

        // Convert relative paths back to absolute for execution
        const absoluteFiles = files.map((f) => join(projectRoot, f));
        setSelectedDirFiles(absoluteFiles);
        setFileCount(absoluteFiles.length);
        setShowConfirmDialog(true);

    }, [projectRoot]);

    // Handle back from confirm dialog
    const handleBackToList = useCallback(() => {

        setShowConfirmDialog(false);

    }, []);

    // No active config
    if (!activeConfig) {

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler focusLabel="RunDirNoConfig" onEscape={back} />
                <Panel title="Run Directory" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Text color="yellow">No active configuration selected.</Text>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Loading
    if (phase === 'loading') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Run Directory" paddingX={1} paddingY={1}>
                    <Spinner label="Discovering directories..." />
                </Panel>
            </Box>
        );

    }

    // Error
    if (phase === 'error') {

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler focusLabel="RunDirError" onEscape={back} onRetry={() => executeDir(true)} />
                <Panel title="Run Directory" borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red">Error</Text>
                        <Text dimColor>{error}</Text>
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[r] Retry</Text>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Picker
    if (phase === 'picker') {

        const hasFiles = allFiles.length > 0;

        return (
            <Box flexDirection="column" gap={1}>
                {(globalModes.dryRun || globalModes.force) && (
                    <Box flexDirection="column">
                        {globalModes.dryRun && (
                            <Text color="yellow" bold>DRY RUN MODE</Text>
                        )}
                        {globalModes.force && (
                            <Text color="red" bold>FORCE MODE</Text>
                        )}
                    </Box>
                )}

                <Panel title="Select Directory" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        {hasFiles ? (
                            <>
                                <Text dimColor>
                                    Select a directory to execute all SQL files within
                                </Text>
                                <Box flexDirection="column" height={15}>
                                    <SelectList
                                        focusLabel="RunDirPicker"
                                        items={dirItems}
                                        onSelect={handleSelect}
                                        onCancel={handleCancel}
                                        visibleCount={10}
                                        emptyLabel="No directories found"
                                    />
                                </Box>
                            </>
                        ) : (
                            <>
                                <KeyHandler focusLabel="RunDirEmpty" onEscape={handleCancel} />
                                <Box flexDirection="column" gap={1}>
                                    <Text color="yellow">No SQL files found in {sqlPath}/</Text>
                                    <Text dimColor>
                                        Make sure your schema path is configured correctly in settings.
                                    </Text>
                                </Box>
                            </>
                        )}
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    {hasFiles && <Text dimColor>[Enter] Select</Text>}
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Confirm
    if (phase === 'confirm') {

        // Show confirm dialog
        if (showConfirmDialog) {

            return (
                <Box flexDirection="column" gap={1}>
                    <Panel title="Run Directory" paddingX={1} paddingY={1}>
                        <Box flexDirection="column" gap={1}>
                            <Box gap={2}>
                                <Text>Directory:</Text>
                                <Text bold color="cyan">{selectedDir}</Text>
                            </Box>
                            <Box gap={2}>
                                <Text>Files:</Text>
                                <Text bold color="green">{fileCount}</Text>
                            </Box>
                            <Box gap={2}>
                                <Text>Config:</Text>
                                <Text dimColor>{activeConfigName}</Text>
                            </Box>
                        </Box>
                    </Panel>

                    <Confirm
                        focusLabel="RunDirConfirm"
                        message={`Execute ${fileCount} files from ${selectedDir}?`}
                        onConfirm={checkDirFilesStatus}
                        onCancel={handleBackToList}
                    />
                </Box>
            );

        }

        // Show file picker for preview and selection
        if (fileCount === 0) {

            return (
                <Box flexDirection="column" gap={1}>
                    <KeyHandler focusLabel="RunDirNoFiles" onEscape={() => setPhase('picker')} />
                    <Panel title={`Files in ${selectedDir}`} borderColor="yellow" paddingX={1} paddingY={1}>
                        <Text color="yellow">No SQL files found in this directory.</Text>
                    </Panel>
                    <Box flexWrap="wrap" columnGap={2}>
                        <Text dimColor>[Esc] Back</Text>
                    </Box>
                </Box>
            );

        }

        return (
            <Box flexDirection="column" gap={1}>
                {(globalModes.dryRun || globalModes.force) && (
                    <Box flexDirection="column">
                        {globalModes.dryRun && (
                            <Text color="yellow" bold>DRY RUN MODE</Text>
                        )}
                        {globalModes.force && (
                            <Text color="red" bold>FORCE MODE</Text>
                        )}
                    </Box>
                )}

                <FilePicker
                    focusLabel="RunDirFilePicker"
                    files={relativeFiles}
                    selected={relativeFiles}
                    onSelect={handleFileSelect}
                    onCancel={() => setPhase('picker')}
                    visibleCount={10}
                />
            </Box>
        );

    }

    // Checking files status
    if (phase === 'checking') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Run Directory" paddingX={1} paddingY={1}>
                    <Spinner label={`Checking status of ${fileCount} files...`} />
                </Panel>
            </Box>
        );

    }

    // Rerun confirmation
    if (phase === 'rerun-confirm' && filesStatus) {

        const previouslyRunCount = filesStatus.previouslyRunFiles.length;
        const newCount = filesStatus.newFiles.length;
        const changedCount = filesStatus.changedFiles.length;
        const totalNew = newCount + changedCount;

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Files Previously Run" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Box gap={2}>
                            <Text>Directory:</Text>
                            <Text bold color="cyan">{selectedDir}</Text>
                        </Box>
                        <Box gap={2}>
                            <Text>Config:</Text>
                            <Text dimColor>{activeConfigName}</Text>
                        </Box>

                        <Box marginTop={1} flexDirection="column" gap={0}>
                            <Box gap={2}>
                                <Text color="yellow" bold>{previouslyRunCount}</Text>
                                <Text color="yellow">
                                    file{previouslyRunCount === 1 ? '' : 's'} previously run
                                </Text>
                            </Box>
                            {totalNew > 0 && (
                                <Box gap={2}>
                                    <Text color="green" bold>{totalNew}</Text>
                                    <Text color="green">
                                        file{totalNew === 1 ? '' : 's'} {changedCount > 0 ? 'new or changed' : 'new'}
                                    </Text>
                                </Box>
                            )}
                        </Box>

                        <Box marginTop={1}>
                            <Text dimColor>
                                Run all {fileCount} files including previously executed ones?
                            </Text>
                        </Box>
                    </Box>
                </Panel>

                <Confirm
                    focusLabel="RunDirRerunConfirm"
                    message={`Run all ${fileCount} files?`}
                    variant="warning"
                    onConfirm={handleConfirmRerun}
                    onCancel={handleCancelRerun}
                />
            </Box>
        );

    }

    // Running
    if (phase === 'running') {

        const processed = progress.filesRun + progress.filesSkipped + progress.filesFailed + progress.filesDryRun;
        const progressValue = fileCount > 0 ? processed / fileCount : 0;

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler
                    focusLabel="RunDirRunning"
                    onCancel={cancelExecution}
                />
                <Panel title="Running Directory" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        {progress.currentFile && (
                            <Text dimColor>{progress.currentFile.split('/').pop()}</Text>
                        )}

                        <Box width={50}>
                            <ProgressBar value={progressValue} />
                        </Box>

                        <Box gap={3}>
                            <Text><Text color="green">{progress.filesRun}</Text> run</Text>
                            <Text><Text color="yellow">{progress.filesSkipped}</Text> skipped</Text>
                            <Text><Text color="red">{progress.filesFailed}</Text> failed</Text>
                        </Box>
                    </Box>
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Cancel</Text>
                </Box>
            </Box>
        );

    }

    // Complete
    if (phase === 'complete') {

        const statusColor =
            progress.status === 'success' ? 'green' : progress.status === 'failed' ? 'red' : 'yellow';

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler focusLabel="RunDirComplete" onEscape={back} onRetry={() => executeDir(true)} />
                <Panel title="Directory Complete" borderColor={statusColor} paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Box gap={2}>
                            <Text>Directory:</Text>
                            <Text dimColor>{selectedDir}</Text>
                        </Box>

                        <Box gap={2}>
                            <Text>Status:</Text>
                            <Text bold color={statusColor}>
                                {progress.status?.toUpperCase() ?? 'COMPLETE'}
                            </Text>
                        </Box>

                        <Box gap={2}>
                            <Text>Duration:</Text>
                            <Text dimColor>{(progress.durationMs / 1000).toFixed(2)}s</Text>
                        </Box>

                        <Box marginTop={1} gap={3}>
                            <Text><Text color="green" bold>{progress.filesRun}</Text> run</Text>
                            <Text><Text color="yellow" bold>{progress.filesSkipped}</Text> skipped</Text>
                            <Text><Text color="red" bold>{progress.filesFailed}</Text> failed</Text>
                        </Box>

                        {progress.filesFailed > 0 && (
                            <Box flexDirection="column" marginTop={1}>
                                <Text bold color="red">Failed Files:</Text>
                                {progress.results
                                    .filter((r) => r.status === 'failed')
                                    .slice(0, 5)
                                    .map((r, i) => (
                                        <Text key={i} dimColor>
                                            {r.filepath.split('/').pop()}: {r.error}
                                        </Text>
                                    ))}
                            </Box>
                        )}
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[r] Retry</Text>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    return <Text>Unknown phase</Text>;

}
