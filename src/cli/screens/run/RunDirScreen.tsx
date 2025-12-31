/**
 * RunDirScreen - execute all SQL files in a directory.
 *
 * Uses a directory picker to select from discovered directories.
 *
 * @example
 * ```bash
 * noorm run dir              # Opens this screen
 * noorm run dir schema/tables  # With pre-filled path
 * ```
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { ProgressBar } from '@inkjs/ui';
import { join, relative, dirname } from 'path';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useActiveConfig, useSettings, useGlobalModes, useAppContext } from '../../app-context.js';
import { Panel, Spinner, Confirm, SelectList, FilePicker, useToast } from '../../components/index.js';
import { useRunProgress } from '../../hooks/index.js';
import { discoverFiles, runFiles } from '../../../core/runner/index.js';
import { createConnection, testConnection } from '../../../core/connection/index.js';
import { resolveIdentity } from '../../../core/identity/index.js';
import { attempt } from '@logosdx/utils';

import type { NoormDatabase } from '../../../core/shared/index.js';
import type { Kysely } from 'kysely';
import type { RunContext } from '../../../core/runner/index.js';
import type { SelectListItem } from '../../components/index.js';

type Phase = 'loading' | 'picker' | 'confirm' | 'running' | 'complete' | 'error';

/**
 * Simple component that handles Escape key to go back.
 */
function EscapeHandler({
    onEscape,
    toastMessage,
    showToast,
}: {
    onEscape?: () => void;
    toastMessage?: string;
    showToast?: (opts: { message: string; variant: 'warning' }) => void;
}): null {

    const { isFocused } = useFocusScope('EscapeHandler');

    useInput((_, key) => {

        if (!isFocused) return;

        if (key.escape) {

            if (toastMessage && showToast) {

                showToast({ message: toastMessage, variant: 'warning' });

            }
            else if (onEscape) {

                onEscape();

            }

        }

    });

    return null;

}

/**
 * Extract unique directories from file paths.
 * Returns directories relative to the project root.
 */
function extractDirectories(files: string[], projectRoot: string, schemaPath: string): string[] {

    const dirs = new Set<string>();

    // Always include the schema path itself as an option
    dirs.add(schemaPath);

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
    const { activeConfig, activeConfigName, stateManager } = useAppContext();
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

    const projectRoot = process.cwd();
    const schemaPath = settings?.paths?.schema ?? 'schema';

    // Load files and extract directories on mount
    useEffect(() => {

        if (!activeConfig || !settings) return;

        let cancelled = false;

        const load = async () => {

            setPhase('loading');

            const schemaFullPath = join(projectRoot, schemaPath);

            const [files, err] = await attempt(() => discoverFiles(schemaFullPath));

            if (cancelled) return;

            if (err) {

                setError(`Failed to discover files: ${err.message}`);
                setPhase('error');

                return;

            }

            setAllFiles(files ?? []);

            const dirs = extractDirectories(files ?? [], projectRoot, schemaPath);
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

    }, [activeConfig, settings, projectRoot, schemaPath, params.path]);

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

    // Execute selected files
    const executeDir = useCallback(async () => {

        if (!activeConfig || !activeConfigName || !stateManager || selectedDirFiles.length === 0) return;

        setPhase('running');
        resetProgress(selectedDirFiles.length);

        // Resolve identity
        const identity = resolveIdentity({
            cryptoIdentity: stateManager.getIdentity() ?? null,
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

            const options = {
                force: globalModes.force,
                dryRun: globalModes.dryRun,
                abortOnError: true,
            };

            await runFiles(context, selectedDirFiles, options);
            setPhase('complete');

        }
        catch (err) {

            setError(err instanceof Error ? err.message : String(err));
            setPhase('error');

        }
        finally {

            await conn.destroy();

        }

    }, [activeConfig, activeConfigName, stateManager, selectedDirFiles, globalModes, resetProgress, projectRoot]);

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
                <EscapeHandler onEscape={back} />
                <Panel title="Run Directory" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Text color="yellow">No active configuration selected.</Text>
                </Panel>
                <Box gap={2}>
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
                <EscapeHandler onEscape={back} />
                <Panel title="Run Directory" borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red">Error</Text>
                        <Text dimColor>{error}</Text>
                    </Box>
                </Panel>
                <Box gap={2}>
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
                                <EscapeHandler onEscape={handleCancel} />
                                <Box flexDirection="column" gap={1}>
                                    <Text color="yellow">No SQL files found in {schemaPath}/</Text>
                                    <Text dimColor>
                                        Make sure your schema path is configured correctly in settings.
                                    </Text>
                                </Box>
                            </>
                        )}
                    </Box>
                </Panel>

                <Box gap={2}>
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
                        onConfirm={executeDir}
                        onCancel={handleBackToList}
                    />
                </Box>
            );

        }

        // Show file picker for preview and selection
        if (fileCount === 0) {

            return (
                <Box flexDirection="column" gap={1}>
                    <EscapeHandler onEscape={() => setPhase('picker')} />
                    <Panel title={`Files in ${selectedDir}`} borderColor="yellow" paddingX={1} paddingY={1}>
                        <Text color="yellow">No SQL files found in this directory.</Text>
                    </Panel>
                    <Box gap={2}>
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

    // Running
    if (phase === 'running') {

        const processed = progress.filesRun + progress.filesSkipped + progress.filesFailed + progress.filesDryRun;
        const progressValue = fileCount > 0 ? processed / fileCount : 0;

        return (
            <Box flexDirection="column" gap={1}>
                <EscapeHandler
                    toastMessage="Cannot cancel running directory"
                    showToast={showToast}
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
            </Box>
        );

    }

    // Complete
    if (phase === 'complete') {

        const statusColor =
            progress.status === 'success' ? 'green' : progress.status === 'failed' ? 'red' : 'yellow';

        return (
            <Box flexDirection="column" gap={1}>
                <EscapeHandler onEscape={back} />
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

                <Box gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    return <Text>Unknown phase</Text>;

}
