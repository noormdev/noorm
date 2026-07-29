/**
 * ChangeFFScreen - fast-forward all pending changes.
 *
 * Applies all pending changes in chronological order.
 *
 * @example
 * ```bash
 * noorm change:ff    # Apply all pending changes
 * noorm change ff    # Same thing
 * ```
 */
import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { ProgressBar } from '@inkjs/ui';

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
import { validateChangeContent } from '../../../core/change/validation.js';
import { createConnection } from '../../../core/connection/factory.js';

/**
 * FF steps.
 */
type FFStep =
    | 'loading' // Loading pending changes
    | 'confirm' // Awaiting confirmation
    | 'running' // Executing
    | 'complete' // Success
    | 'error'; // Error occurred

/**
 * ChangeFFScreen component.
 */
export function ChangeFFScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate: _navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ChangeFF');
    const { activeConfig, activeConfigName, projectRoot, settings, stateManager, identity: cryptoIdentity, globalModes } = useAppContext();
    const check = activeConfig ? checkConfigPolicy('user', activeConfig, 'change:ff') : null;

    const { results, currentChange, progress, reset: resetProgress } = useChangeProgress();

    const [step, setStep] = useState<FFStep>('loading');
    const [pendingChanges, setPendingChanges] = useState<ChangeListItem[]>([]);
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

            // Validate all pending changes have actual content
            const emptyChanges: string[] = [];

            for (const cs of changes.filter((c) => pending.some((p) => p.name === c.name))) {

                const contentError = await validateChangeContent(cs);

                if (contentError) {

                    emptyChanges.push(cs.name);

                }

            }

            if (emptyChanges.length > 0) {

                const names = emptyChanges.slice(0, 3).join(', ');
                const more = emptyChanges.length > 3 ? ` and ${emptyChanges.length - 3} more` : '';

                throw new Error(
                    `Cannot fast-forward: ${names}${more} have empty or template-only files. Edit the SQL files before running.`,
                );

            }

            setPendingChanges(pending);

            if (pending.length === 0) {

                setError('No pending changes');
                setStep('error');

            }
            else {

                setStep('confirm');

            }

        });

        if (err) {

            if (!isCancelled()) {

                setError(getErrorMessage(err));
                setStep('error');

            }

        }

    }, [activeConfig, activeConfigName]);

    // Handle run
    const handleRun = useCallback(async () => {

        if (!activeConfig || !stateManager || pendingChanges.length === 0) return;

        setStep('running');
        resetProgress(pendingChanges.length);

        const [_, err] = await attempt(async () => {

            const conn = await createConnection(
                activeConfig.connection,
                activeConfigName ?? '__ff__',
            );
            const db = conn.db as Kysely<NoormDatabase>;

            const manager = createChangeManager({
                db,
                configName: activeConfigName ?? '',
                projectRoot,
                settings,
                cryptoIdentity,
                activeConfig,
            });

            const result = await manager.ff({ dryRun: globalModes.dryRun, force: globalModes.force });

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

    }, [activeConfig, activeConfigName, stateManager, cryptoIdentity, settings, pendingChanges, globalModes]);

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

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Fast-Forward" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration.</Text>
            </Panel>
        );

    }

    // Denied by policy
    if (check && !check.allowed) {

        return (
            <Panel title="Fast-Forward" paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">{check.blockedReason}</Text>
            </Panel>
        );

    }

    // Loading
    if (step === 'loading') {

        return (
            <Panel title="Fast-Forward" paddingX={2} paddingY={1}>
                <Spinner label="Loading pending changes..." />
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
                        {pendingChanges.length}
                    </Text>{' '}
                    pending change(s):
                </Text>

                <Box flexDirection="column" marginTop={1}>
                    {pendingChanges.slice(0, 5).map((cs) => (
                        <Text key={cs.name} dimColor>
                            {' '}
                            • {cs.name}
                        </Text>
                    ))}
                    {pendingChanges.length > 5 && (
                        <Text dimColor> ... and {pendingChanges.length - 5} more</Text>
                    )}
                </Box>
            </Box>
        );

        return (
            <Panel title="Fast-Forward" paddingX={2} paddingY={1} borderColor={isConfigGuarded(activeConfig) ? 'yellow' : undefined}>
                <Box flexDirection="column" gap={1}>
                    {confirmContent}
                    <SmartConfirm
                        requiresConfirmation={check?.requiresConfirmation ?? false}
                        confirmationPhrase={check?.confirmationPhrase}
                        configName={activeConfigName ?? 'config'}
                        action="apply all pending changes"
                        message="Apply all pending changes?"
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
            <Panel title="Fast-Forward" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>Applying all pending changes...</Text>

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
            <Panel title="Fast-Forward" paddingX={2} paddingY={1} borderColor="green">
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
        <Panel title="Fast-Forward" paddingX={2} paddingY={1} borderColor="red">
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
