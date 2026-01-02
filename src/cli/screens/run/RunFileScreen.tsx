/**
 * RunFileScreen - execute a single SQL file.
 *
 * Uses a file picker to select from discovered SQL files.
 *
 * @example
 * ```bash
 * noorm run file           # Opens this screen
 * noorm run file schema/tables/users.sql  # With pre-filled path
 * ```
 */
import { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { join, relative } from 'path';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useSettings, useGlobalModes, useAppContext } from '../../app-context.js';
import { Panel, Spinner, Confirm, SearchableList, useToast } from '../../components/index.js';
import { useRunProgress } from '../../hooks/index.js';
import { discoverFiles, runFile } from '../../../core/runner/index.js';
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
 * RunFileScreen component.
 */
export function RunFileScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { activeConfig, activeConfigName, stateManager } = useAppContext();
    const { settings } = useSettings();
    const globalModes = useGlobalModes();
    const { showToast } = useToast();
    const { state: progress, reset: resetProgress } = useRunProgress();

    const [phase, setPhase] = useState<Phase>('loading');
    const [allFiles, setAllFiles] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(params.path ?? null);
    const [error, setError] = useState<string | null>(null);

    const projectRoot = process.cwd();

    // Load files on mount
    useEffect(() => {

        if (!activeConfig || !settings) return;

        let cancelled = false;

        const load = async () => {

            setPhase('loading');

            const schemaPath = settings.paths?.schema ?? 'schema';
            const schemaFullPath = join(projectRoot, schemaPath);

            const [files, err] = await attempt(() => discoverFiles(schemaFullPath));

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

    // Execute file
    const executeFile = useCallback(async () => {

        if (!activeConfig || !activeConfigName || !stateManager || !selectedFile) return;

        setPhase('running');
        resetProgress(1);

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
            };

            await runFile(context, selectedFile, options);
            setPhase('complete');

        }
        catch (err) {

            setError(err instanceof Error ? err.message : String(err));
            setPhase('error');

        }
        finally {

            await conn.destroy();

        }

    }, [activeConfig, activeConfigName, stateManager, selectedFile, globalModes, resetProgress, projectRoot]);

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
                <EscapeHandler onEscape={back} />
                <Panel title="Run File" borderColor="yellow" paddingX={1} paddingY={1}>
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
                <EscapeHandler onEscape={back} />
                <Panel title="Run File" borderColor="red" paddingX={1} paddingY={1}>
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
        const schemaPath = settings?.paths?.schema ?? 'schema';

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
                    onConfirm={executeFile}
                    onCancel={() => setPhase('picker')}
                />
            </Box>
        );

    }

    // Running
    if (phase === 'running') {

        const displayPath = selectedFile ? relative(projectRoot, selectedFile) : '';

        return (
            <Box flexDirection="column" gap={1}>
                <EscapeHandler
                    toastMessage="Cannot cancel running file"
                    showToast={showToast}
                />
                <Panel title="Running File" paddingX={1} paddingY={1}>
                    <Spinner label={`Executing ${displayPath}...`} />
                </Panel>
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
                <EscapeHandler onEscape={back} />
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

                <Box gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    return <Text>Unknown phase</Text>;

}
