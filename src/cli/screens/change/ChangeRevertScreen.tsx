/**
 * ChangeRevertScreen - rollback a single change.
 *
 * Executes the revert files for an applied change.
 * Requires confirmation for protected configs.
 *
 * @example
 * ```bash
 * noorm change:revert add-user-roles    # Revert change
 * noorm change revert add-user-roles    # Same thing
 * ```
 */
import { useState, useEffect, useCallback } from 'react';
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
import { revertChange } from '../../../core/change/executor.js';
import { createConnection } from '../../../core/connection/factory.js';
import { resolveIdentity } from '../../../core/identity/resolver.js';
import { observer } from '../../../core/observer.js';

/**
 * Revert steps.
 */
type RevertStep =
    | 'loading' // Finding change
    | 'confirm' // Awaiting confirmation
    | 'reverting' // Executing
    | 'complete' // Success
    | 'error'; // Error occurred

/**
 * ChangeRevertScreen component.
 */
export function ChangeRevertScreen({ params }: ScreenProps): ReactElement {

    const { navigate: _navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ChangeRevert');
    const { activeConfig, activeConfigName, stateManager } = useAppContext();

    const changeName = params.name;

    const [step, setStep] = useState<RevertStep>('loading');
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

                // Check if applied
                const conn = await createConnection(
                    activeConfig.connection,
                    activeConfigName ?? '__revert__',
                );
                const db = conn.db as Kysely<NoormDatabase>;

                const history = new ChangeHistory(db, activeConfigName ?? '');
                const statuses = await history.getAllStatuses();
                const status = statuses.get(changeName);

                await conn.destroy();

                if (cancelled) return;

                if (status?.status !== 'success') {

                    throw new Error(`Change "${changeName}" is not applied`);

                }

                if (found.revertFiles.length === 0) {

                    throw new Error(`Change "${changeName}" has no revert files`);

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

    // Handle revert
    const handleRevert = useCallback(async () => {

        if (!activeConfig || !change || !stateManager) return;

        setStep('reverting');
        setProgress({ current: 0, total: change.revertFiles.length });

        const [_, err] = await attempt(async () => {

            const conn = await createConnection(
                activeConfig.connection,
                activeConfigName ?? '__revert__',
            );
            const db = conn.db as Kysely<NoormDatabase>;

            // Resolve identity
            const identity = resolveIdentity({
                cryptoIdentity: stateManager?.getIdentity() ?? null,
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

            // Execute revert
            const result = await revertChange(context, change);

            await conn.destroy();

            setResult(result);
            setStep(result.status === 'success' ? 'complete' : 'error');

            if (result.status !== 'success') {

                setError(result.error ?? 'Revert failed');

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
            <Panel title="Revert Change" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No change name provided.</Text>
            </Panel>
        );

    }

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Revert Change" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration.</Text>
            </Panel>
        );

    }

    // Loading
    if (step === 'loading') {

        return (
            <Panel title="Revert Change" paddingX={2} paddingY={1}>
                <Spinner label="Loading change..." />
            </Panel>
        );

    }

    // Confirm
    if (step === 'confirm' && change) {

        const confirmContent = (
            <Box flexDirection="column" gap={1}>
                <Text>
                    Revert change:{' '}
                    <Text bold color="yellow">
                        {changeName}
                    </Text>
                </Text>
                <Text>
                    On config: <Text bold>{activeConfigName}</Text>
                </Text>
                <Text dimColor>Revert files to execute: {change.revertFiles.length}</Text>
            </Box>
        );

        if (isProtected) {

            return (
                <Panel title="Revert Change" paddingX={2} paddingY={1} borderColor="yellow">
                    <Box flexDirection="column" gap={1}>
                        {confirmContent}
                        <ProtectedConfirm
                            configName={activeConfigName ?? 'config'}
                            action="revert this change"
                            onConfirm={handleRevert}
                            onCancel={handleCancel}
                            isFocused={isFocused}
                        />
                    </Box>
                </Panel>
            );

        }

        return (
            <Panel title="Revert Change" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    {confirmContent}
                    <Confirm
                        message="Revert this change?"
                        onConfirm={handleRevert}
                        onCancel={handleCancel}
                        isFocused={isFocused}
                    />
                </Box>
            </Panel>
        );

    }

    // Reverting
    if (step === 'reverting') {

        const progressValue = progress.total > 0 ? progress.current / progress.total : 0;

        return (
            <Panel title="Revert Change" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>
                        Reverting:{' '}
                        <Text bold color="yellow">
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
            <Panel title="Revert Change" paddingX={2} paddingY={1} borderColor="green">
                <Box flexDirection="column" gap={1}>
                    <StatusMessage variant="success">
                        Change "{changeName}" reverted successfully!
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
    return (
        <Panel title="Revert Change" paddingX={2} paddingY={1} borderColor="red">
            <Box flexDirection="column" gap={1}>
                <StatusMessage variant="error">Failed to revert change: {error}</StatusMessage>

                {result?.files && (
                    <Box flexDirection="column">
                        <Text dimColor>Executed files:</Text>
                        {result.files.map((f, i) => (
                            <Text key={i} color={f.status === 'success' ? 'green' : 'red'}>
                                {f.status === 'success' ? '✓' : '✗'} {f.filepath.split('/').pop()}
                            </Text>
                        ))}
                    </Box>
                )}

                <Box marginTop={1}>
                    <Text dimColor>Press any key to continue...</Text>
                </Box>
            </Box>
        </Panel>
    );

}
