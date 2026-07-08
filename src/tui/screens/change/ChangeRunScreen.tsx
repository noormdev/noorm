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
import { useState, useCallback } from 'react';
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
    SmartConfirm,
    MissingParamPanel,
} from '../../components/index.js';
import { checkConfigPolicy } from '../../../core/policy/index.js';
import { useChangeProgress, useAsyncEffect } from '../../hooks/index.js';
import { getErrorMessage,
    loadChangesWithStatus,
    resolveScreenIdentity,
    resolveChangesDir,
    resolveSqlDir,
    isConfigGuarded,
} from '../../utils/index.js';
import { executeChange } from '../../../core/change/executor.js';
import { validateChangeContent } from '../../../core/change/validation.js';
import { createConnection } from '../../../core/connection/factory.js';

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
    const { activeConfig, activeConfigName, projectRoot, settings, stateManager, identity: cryptoIdentity } = useAppContext();
    const check = activeConfig ? checkConfigPolicy('user', activeConfig, 'change:run') : null;

    const changeName = params.name;

    const { currentFile, fileProgress } = useChangeProgress();

    const [step, setStep] = useState<RunStep>('loading');
    const [change, setChange] = useState<Change | null>(null);
    const [result, setResult] = useState<ChangeResult | null>(null);
    const [error, setError] = useState<string | null>(null);


    // Load change info
    useAsyncEffect(async (isCancelled) => {

        if (!activeConfig || !changeName) {

            return;

        }

        const [_, err] = await attempt(async () => {

            const { changes } = await loadChangesWithStatus(
                activeConfig, activeConfigName ?? '', settings, projectRoot,
            );

            const found = changes.find((cs) => cs.name === changeName);

            if (!found) {

                throw new Error(`Change not found: ${changeName}`);

            }

            if (isCancelled()) return;

            // Validate change has actual content
            const contentError = await validateChangeContent(found);

            if (contentError) {

                throw new Error(contentError);

            }

            setChange(found);
            setStep('confirm');

        });

        if (err) {

            if (!isCancelled()) {

                setError(getErrorMessage(err));
                setStep('error');

            }

        }

    }, [activeConfig, activeConfigName, changeName]);

    // Handle run
    const handleRun = useCallback(async () => {

        if (!activeConfig || !change || !stateManager) return;

        setStep('running');

        const [_, err] = await attempt(async () => {

            const conn = await createConnection(
                activeConfig.connection,
                activeConfigName ?? '__run__',
            );
            const db = conn.db as Kysely<NoormDatabase>;

            // Build context
            const context = {
                db,
                configName: activeConfigName ?? '',
                identity: resolveScreenIdentity(cryptoIdentity),
                projectRoot,
                changesDir: resolveChangesDir(projectRoot, settings),
                sqlDir: resolveSqlDir(projectRoot, settings),
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

            setError(getErrorMessage(err));
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

        return <MissingParamPanel title="Run Change" param="change name" />;

    }

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Run Change" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration.</Text>
            </Panel>
        );

    }

    // Denied by policy
    if (check && !check.allowed) {

        return (
            <Panel title="Run Change" paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">{check.blockedReason}</Text>
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

        return (
            <Panel title="Run Change" paddingX={2} paddingY={1} borderColor={isConfigGuarded(activeConfig) ? 'yellow' : undefined}>
                <Box flexDirection="column" gap={1}>
                    {confirmContent}
                    <SmartConfirm
                        requiresConfirmation={check?.requiresConfirmation ?? false}
                        confirmationPhrase={check?.confirmationPhrase}
                        configName={activeConfigName ?? 'config'}
                        action="apply this change"
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

        const progressValue = fileProgress.total > 0 ? fileProgress.current / fileProgress.total : 0;

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
                        {fileProgress.current}/{fileProgress.total} files
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
                                <Box key={i} flexDirection="column">
                                    <Text color={color}>
                                        {icon} {filename}
                                    </Text>
                                    {f.status === 'failed' && f.error && (
                                        <Box marginLeft={2} flexDirection="column">
                                            {f.error.split('\n').map((line, j) => (
                                                <Text key={j} color="red" dimColor>
                                                    {line}
                                                </Text>
                                            ))}
                                        </Box>
                                    )}
                                </Box>
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
