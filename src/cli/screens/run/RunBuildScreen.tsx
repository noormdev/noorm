/**
 * RunBuildScreen - execute schema build.
 *
 * Multi-phase screen for running all SQL files with settings integration:
 * 1. loading: Load settings, compute effective paths, discover files
 * 2. confirm: Show summary, confirm execution
 * 3. running: Show progress with current file
 * 4. complete: Show results summary
 *
 * Respects global modes (dry-run, force) from status bar.
 *
 * @example
 * ```bash
 * noorm run build     # Opens this screen
 * ```
 */
import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { ProgressBar } from '@inkjs/ui';
import { join } from 'path';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useActiveConfig, useSettings, useGlobalModes, useAppContext } from '../../app-context.js';
import { Panel, Spinner, Confirm, ProtectedConfirm, useToast } from '../../components/index.js';
import { useRunProgress } from '../../hooks/index.js';
import { getEffectiveBuildPaths } from '../../../core/settings/rules.js';
import { discoverFiles, runBuild } from '../../../core/runner/index.js';
import { filterFilesByPaths } from '../../../core/shared/index.js';
import { createConnection, testConnection } from '../../../core/connection/index.js';
import { resolveIdentity } from '../../../core/identity/index.js';
import { attempt } from '@logosdx/utils';

import type { NoormDatabase } from '../../../core/shared/index.js';
import type { Kysely } from 'kysely';
import type { RunContext } from '../../../core/runner/index.js';

type Phase = 'loading' | 'confirm' | 'running' | 'complete' | 'error';

/**
 * RunBuildScreen component.
 */
export function RunBuildScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('RunBuild');
    const { activeConfig, activeConfigName, stateManager } = useAppContext();
    const { settings } = useSettings();
    const globalModes = useGlobalModes();
    const { showToast } = useToast();
    const { state: progress, reset: resetProgress } = useRunProgress();

    const [phase, setPhase] = useState<Phase>('loading');
    const [files, setFiles] = useState<string[]>([]);
    const [schemaPath, setSchemaPath] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    // Load settings and discover files
    useEffect(() => {

        if (!activeConfig || !activeConfigName || !settings) {

            return;

        }

        let cancelled = false;

        const load = async () => {

            setPhase('loading');
            setError(null);

            // Get project root
            const projectRoot = process.cwd();
            const schema = settings.paths?.schema ?? 'schema';
            setSchemaPath(schema);

            // Get effective build paths
            const buildInclude = settings.build?.include ?? ['schema'];
            const buildExclude = settings.build?.exclude ?? [];
            const rules = settings.rules ?? [];

            const configForMatch = {
                name: activeConfigName,
                protected: activeConfig.protected ?? false,
                isTest: activeConfig.isTest ?? false,
                type: activeConfig.type,
            };

            const effectivePaths = getEffectiveBuildPaths(
                buildInclude,
                buildExclude,
                rules,
                configForMatch,
            );

            // Discover all SQL files in schema path
            const schemaFullPath = join(projectRoot, schema);
            const [allFiles, discoverErr] = await attempt(() => discoverFiles(schemaFullPath));

            if (cancelled) return;

            if (discoverErr) {

                setError(`Failed to discover files: ${discoverErr.message}`);
                setPhase('error');

                return;

            }

            // Filter by effective paths
            const filteredFiles = filterFilesByPaths(
                allFiles ?? [],
                projectRoot,
                effectivePaths.include,
                effectivePaths.exclude,
            );

            setFiles(filteredFiles);
            setPhase('confirm');

        };

        load();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, settings]);

    // Execute build
    const executeBuild = useCallback(async () => {

        if (!activeConfig || !activeConfigName || !stateManager) return;

        setPhase('running');
        resetProgress(files.length);

        const projectRoot = process.cwd();

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

            // Build run context
            const context: RunContext = {
                db,
                configName: activeConfigName,
                identity,
                projectRoot,
                config: activeConfig as unknown as Record<string, unknown>,
                secrets: stateManager.getAllSecrets(activeConfigName),
                globalSecrets: stateManager.getAllGlobalSecrets(),
            };

            // Run options from global modes
            const options = {
                force: globalModes.force,
                dryRun: globalModes.dryRun,
                abortOnError: true,
            };

            // Run build with filtered files
            await runBuild(context, schemaPath, options);

            setPhase('complete');

        }
        catch (err) {

            setError(err instanceof Error ? err.message : String(err));
            setPhase('error');

        }
        finally {

            await conn.destroy();

        }

    }, [
        activeConfig,
        activeConfigName,
        stateManager,
        files,
        schemaPath,
        globalModes,
        resetProgress,
    ]);

    // Keyboard shortcuts
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            if (phase === 'running') {

                showToast({ message: 'Cannot cancel running build', variant: 'warning' });

                return;

            }

            back();

            return;

        }

    });

    // No active config
    if (!activeConfig) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Run Build" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">No active configuration selected.</Text>
                        <Text dimColor>Select a configuration first.</Text>
                    </Box>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Loading phase
    if (phase === 'loading') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Run Build" paddingX={1} paddingY={1}>
                    <Spinner label="Discovering SQL files..." />
                </Panel>
            </Box>
        );

    }

    // Error phase
    if (phase === 'error') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Run Build" borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red">Build Failed</Text>
                        <Text dimColor>{error}</Text>
                    </Box>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Confirm phase
    if (phase === 'confirm') {

        return (
            <Box flexDirection="column" gap={1}>
                {/* Global mode warnings */}
                {(globalModes.dryRun || globalModes.force) && (
                    <Box flexDirection="column">
                        {globalModes.dryRun && (
                            <Text color="yellow" bold>
                                DRY RUN MODE - Files will render to tmp/ without executing
                            </Text>
                        )}
                        {globalModes.force && (
                            <Text color="red" bold>
                                FORCE MODE - All files will run regardless of checksum
                            </Text>
                        )}
                    </Box>
                )}

                <Panel title="Run Build" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Box gap={2}>
                            <Text>Config:</Text>
                            <Text bold color="cyan">
                                {activeConfigName}
                            </Text>
                        </Box>

                        <Box gap={2}>
                            <Text>Schema Path:</Text>
                            <Text dimColor>{schemaPath}</Text>
                        </Box>

                        <Box gap={2}>
                            <Text>Files to run:</Text>
                            <Text bold color="green">
                                {files.length}
                            </Text>
                        </Box>
                    </Box>
                </Panel>

{activeConfig.protected ? (
                    <ProtectedConfirm
                        focusLabel="RunBuildConfirm"
                        configName={activeConfigName ?? ''}
                        action="run build"
                        onConfirm={executeBuild}
                        onCancel={back}
                    />
                ) : (
                    <Confirm
                        focusLabel="RunBuildConfirm"
                        message={`Run ${files.length} SQL files on ${activeConfigName}?`}
                        onConfirm={executeBuild}
                        onCancel={back}
                    />
                )}
            </Box>
        );

    }

    // Running phase
    if (phase === 'running') {

        const processed = progress.filesRun + progress.filesSkipped + progress.filesFailed + progress.filesDryRun;
        const progressValue = files.length > 0 ? processed / files.length : 0;

        return (
            <Box flexDirection="column" gap={1}>
                {/* Global mode warnings */}
                {(globalModes.dryRun || globalModes.force) && (
                    <Box flexDirection="column">
                        {globalModes.dryRun && (
                            <Text color="yellow" bold>
                                DRY RUN MODE
                            </Text>
                        )}
                        {globalModes.force && (
                            <Text color="red" bold>
                                FORCE MODE
                            </Text>
                        )}
                    </Box>
                )}

                <Panel title="Running Build" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Box gap={2}>
                            <Text>Config:</Text>
                            <Text bold color="cyan">
                                {activeConfigName}
                            </Text>
                        </Box>

                        {progress.currentFile && (
                            <Box gap={2}>
                                <Text>Current:</Text>
                                <Text dimColor>{progress.currentFile.split('/').pop()}</Text>
                            </Box>
                        )}

                        <Box marginTop={1} width={50}>
                            <ProgressBar value={progressValue} />
                        </Box>

                        <Box gap={3}>
                            <Text>
                                <Text color="green">{progress.filesRun}</Text> run
                            </Text>
                            <Text>
                                <Text color="yellow">{progress.filesSkipped}</Text> skipped
                            </Text>
                            <Text>
                                <Text color="red">{progress.filesFailed}</Text> failed
                            </Text>
                            {globalModes.dryRun && (
                                <Text>
                                    <Text color="cyan">{progress.filesDryRun}</Text> rendered
                                </Text>
                            )}
                        </Box>
                    </Box>
                </Panel>
            </Box>
        );

    }

    // Complete phase
    if (phase === 'complete') {

        const statusColor =
            progress.status === 'success' ? 'green' : progress.status === 'failed' ? 'red' : 'yellow';

        return (
            <Box flexDirection="column" gap={1}>
                <Panel
                    title="Build Complete"
                    borderColor={statusColor}
                    paddingX={1}
                    paddingY={1}
                >
                    <Box flexDirection="column" gap={1}>
                        <Box gap={2}>
                            <Text>Status:</Text>
                            <Text bold color={statusColor}>
                                {progress.status?.toUpperCase()}
                            </Text>
                        </Box>

                        <Box gap={2}>
                            <Text>Duration:</Text>
                            <Text dimColor>{(progress.durationMs / 1000).toFixed(2)}s</Text>
                        </Box>

                        <Box marginTop={1} gap={3}>
                            <Text>
                                <Text color="green" bold>
                                    {progress.filesRun}
                                </Text>{' '}
                                run
                            </Text>
                            <Text>
                                <Text color="yellow" bold>
                                    {progress.filesSkipped}
                                </Text>{' '}
                                skipped
                            </Text>
                            <Text>
                                <Text color="red" bold>
                                    {progress.filesFailed}
                                </Text>{' '}
                                failed
                            </Text>
                            {progress.filesDryRun > 0 && (
                                <Text>
                                    <Text color="cyan" bold>
                                        {progress.filesDryRun}
                                    </Text>{' '}
                                    rendered
                                </Text>
                            )}
                        </Box>

                        {progress.filesFailed > 0 && (
                            <Box flexDirection="column" marginTop={1}>
                                <Text bold color="red">
                                    Failed Files:
                                </Text>
                                {progress.results
                                    .filter((r) => r.status === 'failed')
                                    .slice(0, 5)
                                    .map((r, i) => (
                                        <Text key={i} dimColor>
                                            {r.filepath.split('/').pop()}: {r.error}
                                        </Text>
                                    ))}
                                {progress.results.filter((r) => r.status === 'failed').length >
                                    5 && (
                                    <Text dimColor>
                                        ...and{' '}
                                        {progress.results.filter((r) => r.status === 'failed')
                                            .length - 5}{' '}
                                        more
                                    </Text>
                                )}
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
