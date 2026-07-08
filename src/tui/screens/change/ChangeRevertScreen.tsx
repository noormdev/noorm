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
import { revertChange } from '../../../core/change/executor.js';
import { createConnection } from '../../../core/connection/factory.js';

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
    const { activeConfig, activeConfigName, projectRoot, settings, identity: cryptoIdentity } = useAppContext();
    const check = activeConfig ? checkConfigPolicy('user', activeConfig, 'change:revert') : null;

    const changeName = params.name;

    const { currentFile, fileProgress } = useChangeProgress();

    const [step, setStep] = useState<RevertStep>('loading');
    const [change, setChange] = useState<Change | null>(null);
    const [result, setResult] = useState<ChangeResult | null>(null);
    const [error, setError] = useState<string | null>(null);


    // Load change info
    useAsyncEffect(async (isCancelled) => {

        if (!activeConfig || !changeName) {

            return;

        }

        const [_, err] = await attempt(async () => {

            const { changes, statuses } = await loadChangesWithStatus(
                activeConfig, activeConfigName ?? '', settings, projectRoot,
            );

            const found = changes.find((cs) => cs.name === changeName);

            if (!found) {

                throw new Error(`Change not found: ${changeName}`);

            }

            if (isCancelled()) return;

            const status = statuses.get(changeName);

            if (status?.status !== 'success') {

                throw new Error(`Change "${changeName}" is not applied`);

            }

            if (found.revertFiles.length === 0) {

                throw new Error(`Change "${changeName}" has no revert files`);

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

    // Handle revert
    const handleRevert = useCallback(async () => {

        if (!activeConfig || !change) return;

        setStep('reverting');

        const [_, err] = await attempt(async () => {

            const conn = await createConnection(
                activeConfig.connection,
                activeConfigName ?? '__revert__',
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

            setError(getErrorMessage(err));
            setStep('error');

        }

    }, [activeConfig, activeConfigName, change, cryptoIdentity]);

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

        return <MissingParamPanel title="Revert Change" param="change name" />;

    }

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Revert Change" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration.</Text>
            </Panel>
        );

    }

    // Denied by policy
    if (check && !check.allowed) {

        return (
            <Panel title="Revert Change" paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">{check.blockedReason}</Text>
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

        return (
            <Panel title="Revert Change" paddingX={2} paddingY={1} borderColor={isConfigGuarded(activeConfig) ? 'yellow' : undefined}>
                <Box flexDirection="column" gap={1}>
                    {confirmContent}
                    <SmartConfirm
                        requiresConfirmation={check?.requiresConfirmation ?? false}
                        confirmationPhrase={check?.confirmationPhrase}
                        configName={activeConfigName ?? 'config'}
                        action="revert this change"
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

        const progressValue = fileProgress.total > 0 ? fileProgress.current / fileProgress.total : 0;

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
