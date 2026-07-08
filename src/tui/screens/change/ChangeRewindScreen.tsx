/**
 * ChangeRewindScreen - revert multiple changes.
 *
 * Reverts changes in reverse chronological order.
 * Can specify count or target change name.
 *
 * @example
 * ```bash
 * noorm change:rewind 3                    # Revert last 3 applied
 * noorm change:rewind 2025-01-15-add-users # Revert to (including) this change
 * noorm change rewind                      # Interactive mode
 * ```
 */
import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput, ProgressBar } from '@inkjs/ui';

import type { ReactElement } from 'react';
import { isNumericString, type ScreenProps } from '../../types.js';
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
import { getErrorMessage, loadChangesWithStatus, buildAppliedChangeList, createChangeManager, isConfigGuarded } from '../../utils/index.js';
import { createConnection } from '../../../core/connection/factory.js';

/**
 * Rewind steps.
 */
type RewindStep =
    | 'loading' // Loading applied changes
    | 'input' // Entering count or name
    | 'confirm' // Awaiting confirmation
    | 'running' // Executing
    | 'complete' // Success
    | 'error'; // Error occurred

/**
 * ChangeRewindScreen component.
 */
export function ChangeRewindScreen({ params }: ScreenProps): ReactElement {

    const { navigate: _navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ChangeRewind');
    const { activeConfig, activeConfigName, projectRoot, settings, stateManager, identity: cryptoIdentity } = useAppContext();
    const check = activeConfig ? checkConfigPolicy('user', activeConfig, 'change:revert') : null;

    // Pre-fill from params - can be count or change name
    const target = params.count ? String(params.count) : (params.name ?? '');

    const { results, currentChange, progress, reset: resetProgress } = useChangeProgress();

    const [step, setStep] = useState<RewindStep>('loading');
    const [appliedChanges, setAppliedChanges] = useState<ChangeListItem[]>([]);
    const [changesToRevert, setChangesToRevert] = useState<ChangeListItem[]>([]);
    const [targetInput, setTargetInput] = useState(target);
    const [error, setError] = useState<string | null>(null);


    // Load applied changes
    useAsyncEffect(async (isCancelled) => {

        if (!activeConfig) return;

        const [_, err] = await attempt(async () => {

            const { changes, statuses } = await loadChangesWithStatus(
                activeConfig, activeConfigName ?? '', settings, projectRoot,
            );

            if (isCancelled()) return;

            const applied = buildAppliedChangeList(changes, statuses);

            setAppliedChanges(applied);

            if (applied.length === 0) {

                setError('No applied changes to revert');
                setStep('error');

            }
            else if (target) {

                // Parse target and determine changes to revert
                const parsed = parseTarget(target, applied);

                if (parsed.error) {

                    setError(parsed.error);
                    setStep('error');

                }
                else {

                    setChangesToRevert(parsed.changes);
                    setStep('confirm');

                }

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

    }, [activeConfig, activeConfigName, target]);

    // Parse target (count or change name)
    const parseTarget = (
        input: string,
        applied: ChangeListItem[],
    ): { changes: ChangeListItem[]; error?: string } => {

        // Try as number (only if entire input is digits)
        if (isNumericString(input)) {

            const count = parseInt(input, 10);

            if (count > applied.length) {

                return {
                    changes: [],
                    error: `Only ${applied.length} applied changes available`,
                };

            }

            return { changes: applied.slice(0, count) };

        }

        // Try as change name
        const targetIndex = applied.findIndex((cs) => cs.name === input);

        if (targetIndex === -1) {

            return { changes: [], error: `Change not found or not applied: ${input}` };

        }

        // Return all changes from newest to target (inclusive)
        return { changes: applied.slice(0, targetIndex + 1) };

    };

    // Handle target input submit
    const handleTargetSubmit = useCallback(() => {

        if (!targetInput.trim()) {

            return;

        }

        const parsed = parseTarget(targetInput.trim(), appliedChanges);

        if (parsed.error) {

            setError(parsed.error);
            setStep('error');

        }
        else {

            setChangesToRevert(parsed.changes);
            setStep('confirm');

        }

    }, [targetInput, appliedChanges]);

    // Handle rewind
    const handleRewind = useCallback(async () => {

        if (!activeConfig || !stateManager || changesToRevert.length === 0) return;

        setStep('running');
        resetProgress(changesToRevert.length);

        const [_, err] = await attempt(async () => {

            const conn = await createConnection(
                activeConfig.connection,
                activeConfigName ?? '__rewind__',
            );
            const db = conn.db as Kysely<NoormDatabase>;

            // Create manager and rewind
            const manager = createChangeManager({
                db,
                configName: activeConfigName ?? '',
                projectRoot,
                settings,
                cryptoIdentity,
                activeConfig,
            });

            const result = await manager.rewind(changesToRevert.length);

            await conn.destroy();

            if (result.failed > 0) {

                setError(`${result.failed} revert(s) failed`);
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

    }, [activeConfig, activeConfigName, stateManager, changesToRevert]);

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        if (step === 'input') {

            if (key.return) {

                handleTargetSubmit();

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
            <Panel title="Rewind Changes" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration.</Text>
            </Panel>
        );

    }

    // Denied by policy
    if (check && !check.allowed) {

        return (
            <Panel title="Rewind Changes" paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">{check.blockedReason}</Text>
            </Panel>
        );

    }

    // Loading
    if (step === 'loading') {

        return (
            <Panel title="Rewind Changes" paddingX={2} paddingY={1}>
                <Spinner label="Loading applied changes..." />
            </Panel>
        );

    }

    // Input
    if (step === 'input') {

        return (
            <Panel title="Rewind Changes" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>
                        Applied changes: <Text bold>{appliedChanges.length}</Text>
                    </Text>

                    <Box flexDirection="column" marginTop={1}>
                        <Text dimColor>Recent applied (newest first):</Text>
                        {appliedChanges.slice(0, 5).map((cs) => (
                            <Text key={cs.name} dimColor>
                                {' '}
                                • {cs.name}
                            </Text>
                        ))}
                    </Box>

                    <Box marginTop={1}>
                        <Text>Revert (count or name): </Text>
                        <TextInput
                            placeholder="1 or change-name"
                            defaultValue={targetInput}
                            onChange={setTargetInput}
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
                    Revert{' '}
                    <Text bold color="yellow">
                        {changesToRevert.length}
                    </Text>{' '}
                    change(s):
                </Text>

                <Box flexDirection="column" marginTop={1}>
                    {changesToRevert.slice(0, 5).map((cs) => (
                        <Text key={cs.name} dimColor>
                            {' '}
                            • {cs.name}
                        </Text>
                    ))}
                    {changesToRevert.length > 5 && (
                        <Text dimColor> ... and {changesToRevert.length - 5} more</Text>
                    )}
                </Box>

                <Text color="yellow">This will revert in reverse order (newest first).</Text>
            </Box>
        );

        return (
            <Panel title="Rewind Changes" paddingX={2} paddingY={1} borderColor={isConfigGuarded(activeConfig) ? 'yellow' : undefined}>
                <Box flexDirection="column" gap={1}>
                    {confirmContent}
                    <SmartConfirm
                        requiresConfirmation={check?.requiresConfirmation ?? false}
                        confirmationPhrase={check?.confirmationPhrase}
                        configName={activeConfigName ?? 'config'}
                        action="revert these changes"
                        message="Revert these changes?"
                        onConfirm={handleRewind}
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
            <Panel title="Rewind Changes" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>Reverting changes...</Text>

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
            <Panel title="Rewind Changes" paddingX={2} paddingY={1} borderColor="green">
                <Box flexDirection="column" gap={1}>
                    <StatusMessage variant="success">
                        Reverted {successCount} change(s) successfully!
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
        <Panel title="Rewind Changes" paddingX={2} paddingY={1} borderColor="red">
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
