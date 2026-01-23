/**
 * RunFileScreen - execute a single SQL file.
 *
 * Uses a file picker to select from discovered SQL files.
 *
 * @example
 * ```bash
 * noorm run file           # Opens this screen
 * noorm run file sql/tables/users.sql  # With pre-filled path
 * ```
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { join, relative } from 'path';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useSettings, useGlobalModes, useAppContext } from '../../app-context.js';
import { Panel, Spinner, Confirm, SearchableList, useToast } from '../../components/index.js';
import { useRunProgress } from '../../hooks/index.js';
import { discoverFiles, runFile, checkFilesStatus } from '../../../core/runner/index.js';
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
 * RunFileScreen component.
 */
export function RunFileScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { activeConfig, activeConfigName, stateManager, identity: cryptoIdentity } = useAppContext();
    const { settings } = useSettings();
    const globalModes = useGlobalModes();
    const { showToast } = useToast();
    const { state: progress, reset: resetProgress } = useRunProgress();

    const [phase, setPhase] = useState<Phase>('loading');
    const [allFiles, setAllFiles] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(params.path ?? null);
    const [error, setError] = useState<string | null>(null);
    const [_fileStatus, setFileStatus] = useState<FilesStatusResult | null>(null);
    const [forceRerun, setForceRerun] = useState(false);

    // Refs for cancellation support
    const activeConnectionRef = useRef<{ destroy: () => Promise<void> } | null>(null);
    const cancelledRef = useRef(false);

    const projectRoot = process.cwd();

    // Load files on mount
    useEffect(() => {

        if (!activeConfig || !settings) return;

        let cancelled = false;

        const load = async () => {

            setPhase('loading');

            const sqlPath = settings.paths?.sql ?? 'sql';
            const sqlFullPath = join(projectRoot, sqlPath);

            const [files, err] = await attempt(() => discoverFiles(sqlFullPath));

            if (cancelled) return;

            if (err) {

                setError(`Failed to discover files: ${err.message}`);
                setPhase('error');

                return;

            }

            setAllFiles(files ?? []);

            // If pre-filled path provided, validate and go to confirm
            if (params.path) {

                const fullPath = join(projectRoot, params.path);
                const found = files?.find((f) => f === fullPath || relative(projectRoot, f) === params.path);

                if (found) {

                    setSelectedFile(found);
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

    }, [activeConfig, settings, projectRoot, params.path]);

    // Handle file selection
    const handleSelect = useCallback((item: SelectListItem<string>) => {

        setSelectedFile(item.value);
        setPhase('confirm');

    }, []);

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Track whether we should proceed to execution after status check
    const [proceedToExecute, setProceedToExecute] = useState(false);

    // Check file status before execution
    const checkFileStatus = useCallback(async () => {

        if (!activeConfig || !activeConfigName || !stateManager || !selectedFile) return;

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

            const status = await checkFilesStatus(context, [selectedFile]);
            setFileStatus(status);

            // If file was previously run (would be skipped), show rerun confirmation
            if (status.previouslyRunFiles.length > 0) {

                setPhase('rerun-confirm');

            }
            else {

                // File is new or changed, proceed to execution
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

    }, [activeConfig, activeConfigName, stateManager, selectedFile, globalModes.force, cryptoIdentity, projectRoot]);

    // Execute file (actual execution)
    const executeFile = useCallback(async (force: boolean = false) => {

        if (!activeConfig || !activeConfigName || !stateManager || !selectedFile) return;

        // Reset cancellation flag
        cancelledRef.current = false;

        setPhase('running');
        resetProgress(1);

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
            };

            await runFile(context, selectedFile, options);

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

    }, [activeConfig, activeConfigName, stateManager, selectedFile, globalModes, forceRerun, resetProgress, projectRoot, cryptoIdentity]);

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
        executeFile(true);

    }, [executeFile]);

    // Handle cancel rerun (go back to picker)
    const handleCancelRerun = useCallback(() => {

        setFileStatus(null);
        setForceRerun(false);
        setPhase('picker');

    }, []);

    // Trigger execution when proceedToExecute becomes true
    useEffect(() => {

        if (proceedToExecute) {

            setProceedToExecute(false);
            executeFile(forceRerun);

        }

    }, [proceedToExecute, executeFile, forceRerun]);

    // Create file items for SearchableList
    const fileItems: SelectListItem<string>[] = allFiles.map((file) => {

        const relativePath = relative(projectRoot, file);

        return {
            key: file,
            label: relativePath,
            value: file,
        };

    });

    // No active config
    if (!activeConfig) {

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler focusLabel="RunFileBack" onEscape={back} />
                <Panel title="Run File" borderColor="yellow" paddingX={1} paddingY={1}>
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
                <Panel title="Run File" paddingX={1} paddingY={1}>
                    <Spinner label="Discovering SQL files..." />
                </Panel>
            </Box>
        );

    }

    // Error
    if (phase === 'error') {

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler
                    focusLabel="RunFileError"
                    onEscape={back}
                    onRetry={() => executeFile(true)}
                />
                <Panel title="Run File" borderColor="red" paddingX={1} paddingY={1}>
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
        const sqlPath = settings?.paths?.sql ?? 'sql';

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

                <Panel title="Select File" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        {hasFiles ? (
                            <>
                                <Text dimColor>
                                    Select a SQL file to execute
                                </Text>
                                <Box flexDirection="column" height={15}>
                                    <SearchableList
                                        focusLabel="RunFilePicker"
                                        items={fileItems}
                                        onSelect={handleSelect}
                                        onCancel={handleCancel}
                                        visibleCount={10}
                                        searchPlaceholder="Filter files..."
                                        emptyLabel="No SQL files found"
                                    />
                                </Box>
                            </>
                        ) : (
                            <>
                                <KeyHandler focusLabel="RunFileEmpty" onEscape={handleCancel} />
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
                    {hasFiles && (
                        <>
                            <Text dimColor>[/] Search</Text>
                            <Text dimColor>[Enter] Select</Text>
                        </>
                    )}
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Confirm
    if (phase === 'confirm') {

        const displayPath = selectedFile ? relative(projectRoot, selectedFile) : '';

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Run File" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Box gap={2}>
                            <Text>File:</Text>
                            <Text bold color="cyan">{displayPath}</Text>
                        </Box>
                        <Box gap={2}>
                            <Text>Config:</Text>
                            <Text dimColor>{activeConfigName}</Text>
                        </Box>
                    </Box>
                </Panel>

                <Confirm
                    focusLabel="RunFileConfirm"
                    message={`Execute ${displayPath}?`}
                    onConfirm={checkFileStatus}
                    onCancel={() => setPhase('picker')}
                />
            </Box>
        );

    }

    // Checking file status
    if (phase === 'checking') {

        const displayPath = selectedFile ? relative(projectRoot, selectedFile) : '';

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Run File" paddingX={1} paddingY={1}>
                    <Spinner label={`Checking status of ${displayPath}...`} />
                </Panel>
            </Box>
        );

    }

    // Rerun confirmation
    if (phase === 'rerun-confirm') {

        const displayPath = selectedFile ? relative(projectRoot, selectedFile) : '';

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="File Previously Run" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Box gap={2}>
                            <Text>File:</Text>
                            <Text bold color="cyan">{displayPath}</Text>
                        </Box>
                        <Box gap={2}>
                            <Text>Config:</Text>
                            <Text dimColor>{activeConfigName}</Text>
                        </Box>
                        <Box marginTop={1}>
                            <Text color="yellow">
                                This file was previously executed and hasn't changed.
                            </Text>
                        </Box>
                    </Box>
                </Panel>

                <Confirm
                    focusLabel="RunFileRerunConfirm"
                    message="Run this file again?"
                    variant="warning"
                    onConfirm={handleConfirmRerun}
                    onCancel={handleCancelRerun}
                />
            </Box>
        );

    }

    // Running
    if (phase === 'running') {

        const displayPath = selectedFile ? relative(projectRoot, selectedFile) : '';

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler
                    focusLabel="RunFileRunning"
                    onCancel={cancelExecution}
                />
                <Panel title="Running File" paddingX={1} paddingY={1}>
                    <Spinner label={`Executing ${displayPath}...`} />
                </Panel>
                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Cancel</Text>
                </Box>
            </Box>
        );

    }

    // Complete
    if (phase === 'complete') {

        const result = progress.results[0];
        const statusColor = result?.status === 'failed' ? 'red' : 'green';
        const displayPath = selectedFile ? relative(projectRoot, selectedFile) : '';

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler
                    focusLabel="RunFileComplete"
                    onEscape={back}
                    onRetry={() => executeFile(true)}
                />
                <Panel title="File Complete" borderColor={statusColor} paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Box gap={2}>
                            <Text>File:</Text>
                            <Text dimColor>{displayPath}</Text>
                        </Box>

                        <Box gap={2}>
                            <Text>Status:</Text>
                            <Text bold color={statusColor}>
                                {result?.status?.toUpperCase() ?? 'COMPLETE'}
                            </Text>
                        </Box>

                        <Box gap={2}>
                            <Text>Duration:</Text>
                            <Text dimColor>{(progress.durationMs / 1000).toFixed(2)}s</Text>
                        </Box>

                        {result?.status === 'skipped' && (
                            <Box gap={2}>
                                <Text>Reason:</Text>
                                <Text dimColor>{result.skipReason}</Text>
                            </Box>
                        )}

                        {result?.error && (
                            <Box flexDirection="column" marginTop={1}>
                                <Text color="red">Error:</Text>
                                <Text dimColor>{result.error}</Text>
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
