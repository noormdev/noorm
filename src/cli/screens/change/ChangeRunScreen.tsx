/**
 * ChangeRunScreen - apply a single change.
 *
 * Executes the change files for a pending change.
 * Requires confirmation for protected configs.
 *
 * @example
 * ```bash
 * noorm change:run add-user-roles    # Apply change
 * noorm change run add-user-roles    # Same thing
 * ```
 */
import { useState, useEffect, useCallback } from 'react';
import { readFile } from 'fs/promises';
import { Box, Text, useInput } from 'ink';
import { ProgressBar } from '@inkjs/ui';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { Change, ChangeResult } from '../../../core/change/types.js';
import type { NoormDatabase } from '../../../core/shared/index.js';
import type { Kysely } from 'kysely';

import { attempt } from '@logosdx/utils';
import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import {
    Panel,
    Spinner,
    StatusMessage,
    Confirm,
    ProtectedConfirm,
} from '../../components/index.js';
import { discoverChanges } from '../../../core/change/parser.js';
import { ChangeHistory } from '../../../core/change/history.js';
import { executeChange } from '../../../core/change/executor.js';
import { createConnection } from '../../../core/connection/factory.js';
import { resolveIdentity } from '../../../core/identity/resolver.js';
import { observer } from '../../../core/observer.js';

/** Default SQL template - files with only this content are considered empty */
const SQL_TEMPLATE = '-- TODO: Add SQL statements here\n';

/**
 * Check if a change has meaningful content in its files.
 * Returns null if valid, or an error message if files are empty/template-only.
 */
async function validateChangeContent(change: Change): Promise<string | null> {

    if (change.changeFiles.length === 0) {

        return 'Change has no files to execute';

    }

    let hasContent = false;

    for (const file of change.changeFiles) {

        // Skip .txt manifest files - they reference other files
        if (file.type === 'txt') {

            hasContent = true;

            continue;

        }

        const [content, err] = await attempt(() => readFile(file.path, 'utf-8'));

        if (err) {

            continue; // Skip files we can't read

        }

        const trimmed = content?.trim() ?? '';

        // Check if file has actual content (not empty, not just the template)
        if (trimmed && trimmed !== SQL_TEMPLATE.trim()) {

            hasContent = true;

            break;

        }

    }

    if (!hasContent) {

        return 'Change files are empty or contain only template placeholders. Edit the SQL files before running.';

    }

    return null;

}

/**
 * Run steps.
 */
type RunStep =
    | 'loading' // Finding change
    | 'confirm' // Awaiting confirmation
    | 'running' // Executing
    | 'complete' // Success
    | 'error'; // Error occurred

/**
 * ChangeRunScreen component.
 */
export function ChangeRunScreen({ params }: ScreenProps): ReactElement {

    const { navigate: _navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ChangeRun');
    const { activeConfig, activeConfigName, stateManager, identity: cryptoIdentity } = useAppContext();

    const changeName = params.name;

    const [step, setStep] = useState<RunStep>('loading');
    const [change, setChange] = useState<Change | null>(null);
    const [result, setResult] = useState<ChangeResult | null>(null);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [currentFile, setCurrentFile] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isProtected, setIsProtected] = useState(false);

    // Load change info
    useEffect(() => {

        if (!activeConfig || !changeName) {

            return;

        }

        let cancelled = false;

        const loadChange = async () => {

            const [_, err] = await attempt(async () => {

                // Find the change on disk
                const changes = await discoverChanges(
                    activeConfig.paths.changes,
                    activeConfig.paths.sql,
                );

                const found = changes.find((cs) => cs.name === changeName);

                if (!found) {

                    throw new Error(`Change not found: ${changeName}`);

                }

                // Check if already applied
                const conn = await createConnection(
                    activeConfig.connection,
                    activeConfigName ?? '__run__',
                );
                const db = conn.db as Kysely<NoormDatabase>;

                const history = new ChangeHistory(db, activeConfigName ?? '');
                const statuses = await history.getAllStatuses();
                const status = statuses.get(changeName);

                await conn.destroy();

                if (cancelled) return;

                if (status?.status === 'success') {

                    throw new Error(`Change "${changeName}" is already applied`);

                }

                // Validate change has actual content
                const contentError = await validateChangeContent(found);

                if (contentError) {

                    throw new Error(contentError);

                }

                setChange(found);
                setIsProtected(activeConfig.protected ?? false);
                setStep('confirm');

            });

            if (err) {

                if (!cancelled) {

                    setError(err instanceof Error ? err.message : String(err));
                    setStep('error');

                }

            }

        };

        loadChange();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, changeName]);

    // Subscribe to progress events
    useEffect(() => {

        const unsubFile = observer.on('change:file', (data) => {

            if (data.change === changeName) {

                setProgress({ current: data.index, total: data.total });
                setCurrentFile(data.filepath);

            }

        });

        return () => {

            unsubFile();

        };

    }, [changeName]);

    // Handle run
    const handleRun = useCallback(async () => {

        if (!activeConfig || !change || !stateManager) return;

        setStep('running');
        setProgress({ current: 0, total: change.changeFiles.length });

        const [_, err] = await attempt(async () => {

            const conn = await createConnection(
                activeConfig.connection,
                activeConfigName ?? '__run__',
            );
            const db = conn.db as Kysely<NoormDatabase>;

            // Resolve identity
            const identity = resolveIdentity({
                cryptoIdentity: cryptoIdentity ?? null,
            });

            // Build context
            const context = {
                db,
                configName: activeConfigName ?? '',
                identity,
                projectRoot: process.cwd(),
                changesDir: activeConfig.paths.changes,
                sqlDir: activeConfig.paths.sql,
            };

            // Execute change
            const result = await executeChange(context, change);

            await conn.destroy();

            setResult(result);
            setStep(result.status === 'success' ? 'complete' : 'error');

            if (result.status !== 'success') {

                setError(result.error ?? 'Execution failed');

            }

        });

        if (err) {

            setError(err instanceof Error ? err.message : String(err));
            setStep('error');

        }

    }, [activeConfig, activeConfigName, change, stateManager]);

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Keyboard handling
    useInput((_input, _key) => {

        if (!isFocused) return;

        if (step === 'complete' || step === 'error') {

            back();

        }

    });

    // No change name provided
    if (!changeName) {

        return (
            <Panel title="Run Change" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No change name provided.</Text>
            </Panel>
        );

    }

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Run Change" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration.</Text>
            </Panel>
        );

    }

    // Loading
    if (step === 'loading') {

        return (
            <Panel title="Run Change" paddingX={2} paddingY={1}>
                <Spinner label="Loading change..." />
            </Panel>
        );

    }

    // Confirm
    if (step === 'confirm' && change) {

        const confirmContent = (
            <Box flexDirection="column" gap={1}>
                <Text>
                    Run change:{' '}
                    <Text bold color="cyan">
                        {changeName}
                    </Text>
                </Text>
                <Text>
                    On config: <Text bold>{activeConfigName}</Text>
                </Text>
                <Text dimColor>Files to execute: {change.changeFiles.length}</Text>
            </Box>
        );

        if (isProtected) {

            return (
                <Panel title="Run Change" paddingX={2} paddingY={1} borderColor="yellow">
                    <Box flexDirection="column" gap={1}>
                        {confirmContent}
                        <ProtectedConfirm
                            configName={activeConfigName ?? 'config'}
                            action="apply this change"
                            onConfirm={handleRun}
                            onCancel={handleCancel}
                            isFocused={isFocused}
                        />
                    </Box>
                </Panel>
            );

        }

        return (
            <Panel title="Run Change" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    {confirmContent}
                    <Confirm
                        message="Apply this change?"
                        onConfirm={handleRun}
                        onCancel={handleCancel}
                        isFocused={isFocused}
                    />
                </Box>
            </Panel>
        );

    }

    // Running
    if (step === 'running') {

        const progressValue = progress.total > 0 ? progress.current / progress.total : 0;

        return (
            <Panel title="Run Change" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>
                        Applying:{' '}
                        <Text bold color="cyan">
                            {changeName}
                        </Text>
                    </Text>

                    <Box width={50}>
                        <ProgressBar value={progressValue} />
                    </Box>

                    <Text dimColor>
                        {progress.current}/{progress.total} files
                        {currentFile && ` - ${currentFile.split('/').pop()}`}
                    </Text>
                </Box>
            </Panel>
        );

    }

    // Complete
    if (step === 'complete' && result) {

        return (
            <Panel title="Run Change" paddingX={2} paddingY={1} borderColor="green">
                <Box flexDirection="column" gap={1}>
                    <StatusMessage variant="success">
                        Change "{changeName}" applied successfully!
                    </StatusMessage>

                    <Text dimColor>
                        Duration: {result.durationMs}ms | Files: {result.files?.length ?? 0}
                    </Text>

                    <Box marginTop={1}>
                        <Text dimColor>Press any key to continue...</Text>
                    </Box>
                </Box>
            </Panel>
        );

    }

    // Error
    const failedFile = result?.files?.find((f) => f.status === 'failed');

    return (
        <Panel title="Run Change" paddingX={2} paddingY={1} borderColor="red">
            <Box flexDirection="column" gap={1}>
                <StatusMessage variant="error">Failed to apply change</StatusMessage>

                {/* Show the actual error */}
                {failedFile && (
                    <Box flexDirection="column" marginTop={1}>
                        <Text color="red" bold>
                            Error in {failedFile.filepath.split('/').pop()}:
                        </Text>
                        <Text color="red" wrap="wrap">
                            {failedFile.error}
                        </Text>
                    </Box>
                )}

                {/* Fallback to generic error if no failed file */}
                {!failedFile && error && (
                    <Box flexDirection="column" marginTop={1}>
                        <Text color="red" wrap="wrap">
                            {error}
                        </Text>
                    </Box>
                )}

                {result?.files && result.files.length > 0 && (
                    <Box flexDirection="column" marginTop={1}>
                        <Text dimColor bold>File execution summary:</Text>
                        {result.files.map((f, i) => {

                            const filename = f.filepath.split('/').pop();
                            const icon = f.status === 'success' ? '✓' : f.status === 'failed' ? '✗' : '○';
                            const color = f.status === 'success' ? 'green' : f.status === 'failed' ? 'red' : 'yellow';

                            return (
                                <Text key={i} color={color}>
                                    {icon} {filename}
                                    {f.status === 'failed' && f.error && (
                                        <Text dimColor> - {f.error.slice(0, 60)}{f.error.length > 60 ? '...' : ''}</Text>
                                    )}
                                </Text>
                            );

                        })}
                    </Box>
                )}

                <Box marginTop={1}>
                    <Text dimColor>Press any key to continue...</Text>
                </Box>
            </Box>
        </Panel>
    );

}
