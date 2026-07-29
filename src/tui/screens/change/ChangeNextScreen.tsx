/**
 * ChangeNextScreen - apply next N pending changes.
 *
 * Applies pending changes in chronological order.
 *
 * @example
 * ```bash
 * noorm change:next 1    # Apply next 1 change (default)
 * noorm change:next 5    # Apply next 5 changes
 * noorm change next      # Same as next 1
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput, ProgressBar } from '@inkjs/ui';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { ChangeListItem } from '../../../core/change/types.js';
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
    StatusList,
} from '../../components/index.js';
import { checkConfigPolicy } from '../../../core/policy/index.js';
import { useChangeProgress, useAsyncEffect } from '../../hooks/index.js';
import { getErrorMessage, loadChangesWithStatus, buildPendingChangeList, createChangeManager, isConfigGuarded } from '../../utils/index.js';
import { createConnection } from '../../../core/connection/factory.js';

/**
 * Next steps.
 */
type NextStep =
    | 'loading' // Loading pending changes
    | 'input' // Entering count
    | 'confirm' // Awaiting confirmation
    | 'running' // Executing
    | 'complete' // Success
    | 'error'; // Error occurred

/**
 * ChangeNextScreen component.
 */
export function ChangeNextScreen({ params }: ScreenProps): ReactElement {

    const { navigate: _navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ChangeNext');
    const { activeConfig, activeConfigName, projectRoot, settings, stateManager, identity: cryptoIdentity, globalModes } = useAppContext();
    const check = activeConfig ? checkConfigPolicy('user', activeConfig, 'change:run') : null;

    // Pre-fill count from params
    const initialCount = params.count ? parseInt(String(params.count), 10) : 1;

    const { results, currentChange, progress, reset: resetProgress } = useChangeProgress();

    const [step, setStep] = useState<NextStep>('loading');
    const [pendingChanges, setPendingChanges] = useState<ChangeListItem[]>([]);
    const [count, setCount] = useState(initialCount);
    const [countInput, setCountInput] = useState(String(initialCount));
    const [error, setError] = useState<string | null>(null);


    // Load pending changes
    useAsyncEffect(async (isCancelled) => {

        if (!activeConfig) return;

        const [_, err] = await attempt(async () => {

            const { changes, statuses } = await loadChangesWithStatus(
                activeConfig, activeConfigName ?? '', settings, projectRoot,
            );

            if (isCancelled()) return;

            const pending = buildPendingChangeList(changes, statuses);

            setPendingChanges(pending);

            if (pending.length === 0) {

                setError('No pending changes');
                setStep('error');

            }
            else if (initialCount > 0) {

                setStep('confirm');

            }
            else {

                setStep('input');

            }

        });

        if (err) {

            if (!isCancelled()) {

                setError(getErrorMessage(err));
                setStep('error');

            }

        }

    }, [activeConfig, activeConfigName, initialCount]);

    // Changes to apply
    const changesToApply = useMemo(() => {

        return pendingChanges.slice(0, count);

    }, [pendingChanges, count]);

    // Handle count input submit
    const handleCountSubmit = useCallback(() => {

        const parsed = parseInt(countInput, 10);

        if (isNaN(parsed) || parsed < 1) {

            return;

        }

        setCount(Math.min(parsed, pendingChanges.length));
        setStep('confirm');

    }, [countInput, pendingChanges.length]);

    // Handle run
    const handleRun = useCallback(async () => {

        if (!activeConfig || !stateManager || changesToApply.length === 0) return;

        setStep('running');
        resetProgress(changesToApply.length);

        const [_, err] = await attempt(async () => {

            const conn = await createConnection(
                activeConfig.connection,
                activeConfigName ?? '__next__',
            );
            const db = conn.db as Kysely<NoormDatabase>;

            // Create manager and run next N
            const manager = createChangeManager({
                db,
                configName: activeConfigName ?? '',
                projectRoot,
                settings,
                cryptoIdentity,
                activeConfig,
            });

            const result = await manager.next(count, { dryRun: globalModes.dryRun, force: globalModes.force });

            await conn.destroy();

            if (result.failed > 0) {

                setError(`${result.failed} change(s) failed`);
                setStep('error');

            }
            else {

                setStep('complete');

            }

        });

        if (err) {

            setError(getErrorMessage(err));
            setStep('error');

        }

    }, [activeConfig, activeConfigName, stateManager, changesToApply, count, globalModes]);

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        if (step === 'input') {

            if (key.return) {

                handleCountSubmit();

            }
            else if (key.escape) {

                back();

            }

        }

        if (step === 'complete' || step === 'error') {

            back();

        }

    });

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Apply Next Changes" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration.</Text>
            </Panel>
        );

    }

    // Denied by policy
    if (check && !check.allowed) {

        return (
            <Panel title="Apply Next Changes" paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">{check.blockedReason}</Text>
            </Panel>
        );

    }

    // Loading
    if (step === 'loading') {

        return (
            <Panel title="Apply Next Changes" paddingX={2} paddingY={1}>
                <Spinner label="Loading pending changes..." />
            </Panel>
        );

    }

    // Input
    if (step === 'input') {

        return (
            <Panel title="Apply Next Changes" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>
                        Pending changes: <Text bold>{pendingChanges.length}</Text>
                    </Text>

                    <Box marginTop={1}>
                        <Text>How many to apply? </Text>
                        <TextInput
                            placeholder="1"
                            defaultValue={countInput}
                            onChange={setCountInput}
                            isDisabled={!isFocused}
                        />
                    </Box>

                    <Box marginTop={1} gap={2}>
                        <Text dimColor>[Enter] Continue</Text>
                        <Text dimColor>[Esc] Cancel</Text>
                    </Box>
                </Box>
            </Panel>
        );

    }

    // Confirm
    if (step === 'confirm') {

        const confirmContent = (
            <Box flexDirection="column" gap={1}>
                <Text>
                    Apply{' '}
                    <Text bold color="cyan">
                        {count}
                    </Text>{' '}
                    change(s):
                </Text>

                <Box flexDirection="column" marginTop={1}>
                    {changesToApply.slice(0, 5).map((cs) => (
                        <Text key={cs.name} dimColor>
                            {' '}
                            • {cs.name}
                        </Text>
                    ))}
                    {changesToApply.length > 5 && (
                        <Text dimColor> ... and {changesToApply.length - 5} more</Text>
                    )}
                </Box>
            </Box>
        );

        return (
            <Panel title="Apply Next Changes" paddingX={2} paddingY={1} borderColor={isConfigGuarded(activeConfig) ? 'yellow' : undefined}>
                <Box flexDirection="column" gap={1}>
                    {confirmContent}
                    <SmartConfirm
                        requiresConfirmation={check?.requiresConfirmation ?? false}
                        confirmationPhrase={check?.confirmationPhrase}
                        configName={activeConfigName ?? 'config'}
                        action="apply these changes"
                        message="Apply these changes?"
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
            <Panel title="Apply Next Changes" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>Applying changes...</Text>

                    <Box width={50}>
                        <ProgressBar value={progressValue} />
                    </Box>

                    <Text dimColor>
                        {progress.current}/{progress.total}
                        {currentChange && ` - ${currentChange}`}
                    </Text>

                    {results.length > 0 && (
                        <Box marginTop={1}>
                            <StatusList items={results} />
                        </Box>
                    )}
                </Box>
            </Panel>
        );

    }

    // Complete
    if (step === 'complete') {

        const successCount = results.filter((r) => r.status === 'success').length;

        return (
            <Panel title="Apply Next Changes" paddingX={2} paddingY={1} borderColor="green">
                <Box flexDirection="column" gap={1}>
                    <StatusMessage variant="success">
                        Applied {successCount} change(s) successfully!
                    </StatusMessage>

                    <StatusList items={results} />

                    <Box marginTop={1}>
                        <Text dimColor>Press any key to continue...</Text>
                    </Box>
                </Box>
            </Panel>
        );

    }

    // Error
    return (
        <Panel title="Apply Next Changes" paddingX={2} paddingY={1} borderColor="red">
            <Box flexDirection="column" gap={1}>
                <StatusMessage variant="error">{error}</StatusMessage>

                {results.length > 0 && <StatusList items={results} />}

                <Box marginTop={1}>
                    <Text dimColor>Press any key to continue...</Text>
                </Box>
            </Box>
        </Panel>
    );

}
