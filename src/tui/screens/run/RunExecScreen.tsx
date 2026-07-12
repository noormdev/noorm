/**
 * RunExecScreen - interactive file picker for selective execution.
 *
 * Allows users to browse and select specific SQL files to execute.
 *
 * Phases:
 * 1. loading: Discover SQL files in schema path
 * 2. picker: Show file list for selection
 * 3. confirm: Confirm selected files
 * 4. running: Show progress
 * 5. complete: Show results
 *
 * @example
 * ```bash
 * noorm run exec     # Opens this screen
 * ```
 */
import { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { ProgressBar } from '@inkjs/ui';
import { join, relative } from 'path';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useSettings, useGlobalModes, useAppContext } from '../../app-context.js';
import { Panel, Spinner, SelectList, type SelectListItem, Confirm, KeyHandler, useToast } from '../../components/index.js';
import { useRunProgress, useAsyncEffect } from '../../hooks/index.js';
import { discoverFiles, runFiles } from '../../../core/runner/index.js';
import { getErrorMessage, resolveScreenIdentity, buildRunContext, withScreenConnection } from '../../utils/index.js';
import { attempt } from '@logosdx/utils';

type Phase = 'loading' | 'picker' | 'confirm' | 'running' | 'complete' | 'error';

/**
 * RunExecScreen component.
 */
export function RunExecScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    // Don't use focus scope at screen level - SelectList owns focus in picker phase
    const { activeConfig, activeConfigName, stateManager, identity: cryptoIdentity } = useAppContext();
    const { settings } = useSettings();
    const globalModes = useGlobalModes();
    const { showToast } = useToast();
    const { state: progress, reset: resetProgress } = useRunProgress();

    const [phase, setPhase] = useState<Phase>('loading');
    const [allFiles, setAllFiles] = useState<string[]>([]);
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const projectRoot = process.cwd();

    // Load files
    useAsyncEffect(async (isCancelled) => {

        if (!activeConfig || !settings) return;

        setPhase('loading');

        const sqlPath = settings.paths?.sql ?? 'sql';
        const sqlFullPath = join(projectRoot, sqlPath);

        const [files, err] = await attempt(() => discoverFiles(sqlFullPath));

        if (isCancelled()) return;

        if (err) {

            setError(`Failed to discover files: ${err.message}`);
            setPhase('error');

            return;

        }

        setAllFiles(files ?? []);
        setPhase('picker');

    }, [activeConfig, settings, projectRoot]);

    // Toggle file selection
    const toggleFile = useCallback((item: SelectListItem<string>) => {

        const file = item.value;
        setSelectedFiles((prev) => {

            const next = new Set(prev);

            if (next.has(file)) {

                next.delete(file);

            }
            else {

                next.add(file);

            }

            return next;

        });

    }, []);

    // Execute selected files
    const executeFiles = useCallback(async () => {

        if (!activeConfig || !activeConfigName || !stateManager) return;

        const filesToRun = Array.from(selectedFiles);
        setPhase('running');
        resetProgress(filesToRun.length);

        // Resolve identity
        const identity = resolveScreenIdentity(cryptoIdentity);

        const [, err] = await withScreenConnection(
            activeConfig.connection, activeConfigName,
            async (db) => {

                const context = buildRunContext({
                    db, configName: activeConfigName, identity,
                    projectRoot, activeConfig,
                    stateManager, dialect: activeConfig.connection.dialect,
                });

                const options = {
                    force: globalModes.force,
                    dryRun: globalModes.dryRun,
                };

                // Run all files as a single batch operation
                await runFiles(context, filesToRun, options);

            },
        );

        if (err) {

            setError(getErrorMessage(err));
            setPhase('error');

            return;

        }

        setPhase('complete');

    }, [activeConfig, activeConfigName, stateManager, selectedFiles, globalModes, resetProgress, projectRoot]);

    // Submit selection (Enter in picker)
    const handleSubmit = useCallback(() => {

        if (selectedFiles.size > 0) {

            setPhase('confirm');

        }
        else {

            showToast({ message: 'Select at least one file', variant: 'warning' });

        }

    }, [selectedFiles.size, showToast]);

    // Cancel/back handler
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Create file items for SelectList
    const fileItems: SelectListItem<string>[] = allFiles.map((file) => {

        const relativePath = relative(projectRoot, file);
        const isChecked = selectedFiles.has(file);

        return {
            key: file,
            label: `[${isChecked ? 'x' : ' '}] ${relativePath}`,
            value: file,
        };

    });

    // No active config
    if (!activeConfig) {

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler focusLabel="RunExecNoConfig" onEscape={back} />
                <Panel title="Execute Files" borderColor="yellow" paddingX={1} paddingY={1}>
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
                <Panel title="Execute Files" paddingX={1} paddingY={1}>
                    <Spinner label="Discovering SQL files..." />
                </Panel>
            </Box>
        );

    }

    // Error
    if (phase === 'error') {

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler focusLabel="RunExecError" onEscape={back} onRetry={executeFiles} />
                <Panel title="Execute Files" borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red">Error</Text>
                        <Box marginLeft={2} flexDirection="column">
                            {error?.split('\n').map((line, i) => (
                                <Text key={i} dimColor>
                                    {line}
                                </Text>
                            ))}
                        </Box>
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

                <Panel title="Select Files" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text dimColor>
                            Space to toggle, Enter to confirm ({selectedFiles.size} selected)
                        </Text>
                        <Box flexDirection="column" height={15}>
                            <SelectList
                                focusLabel="RunExecPicker"
                                items={fileItems}
                                multiSelect={true}
                                onToggle={toggleFile}
                                onSubmit={handleSubmit}
                                onCancel={handleCancel}
                                visibleCount={10}
                            />
                        </Box>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Space] Toggle</Text>
                    <Text dimColor>[Enter] Confirm</Text>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Confirm
    if (phase === 'confirm') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Confirm Execution" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text>
                            Files to run: <Text bold color="cyan">{selectedFiles.size}</Text>
                        </Text>
                    </Box>
                </Panel>

                <Confirm
                    focusLabel="RunExecConfirm"
                    message={`Execute ${selectedFiles.size} files on ${activeConfigName}?`}
                    onConfirm={executeFiles}
                    onCancel={() => setPhase('picker')}
                />
            </Box>
        );

    }

    // Running
    if (phase === 'running') {

        const processed = progress.filesRun + progress.filesSkipped + progress.filesFailed + progress.filesDryRun;
        const progressValue = selectedFiles.size > 0 ? processed / selectedFiles.size : 0;

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler
                    focusLabel="RunExecRunning"
                    onEscape={() => showToast({ message: 'Cannot cancel running files', variant: 'warning' })}
                />
                <Panel title="Running Files" paddingX={1} paddingY={1}>
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

        return (
            <Box flexDirection="column" gap={1}>
                <KeyHandler focusLabel="RunExecComplete" onEscape={back} onRetry={executeFiles} />
                <Panel title="Execution Complete" borderColor="green" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Box gap={2}>
                            <Text>Duration:</Text>
                            <Text dimColor>{(progress.durationMs / 1000).toFixed(2)}s</Text>
                        </Box>

                        <Box gap={3}>
                            <Text><Text color="green" bold>{progress.filesRun}</Text> run</Text>
                            <Text><Text color="yellow" bold>{progress.filesSkipped}</Text> skipped</Text>
                            <Text><Text color="red" bold>{progress.filesFailed}</Text> failed</Text>
                        </Box>
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
