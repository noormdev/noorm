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
import { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { ProgressBar } from '@inkjs/ui';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { ChangeManager } from '../../../core/change/manager.js';
import type { BatchChangeOptions, ChangeListItem, ChangeResult } from '../../../core/change/types.js';
import type { NoormDatabase } from '../../../core/shared/index.js';
import type { Kysely } from 'kysely';

import { attempt } from '@logosdx/utils';
import { useRouter } from '../../router.js';
import { useBusy, useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import {
    Panel,
    Spinner,
    StatusMessage,
    SmartConfirm,
    Confirm,
    SelectList,
    StatusList,
    StatementProgress,
} from '../../components/index.js';
import { checkConfigPolicy } from '../../../core/policy/index.js';
import { useChangeProgress, useAsyncEffect } from '../../hooks/index.js';
import {
    getErrorMessage,
    loadChangesWithStatus,
    buildPendingChangeList,
    createChangeManager,
    isConfigGuarded,
    progressPercentage,
} from '../../utils/index.js';
import { validateChangeContent } from '../../../core/change/validation.js';
import { createConnection } from '../../../core/connection/factory.js';
import { Hotkey } from '../../components/layout/Hotkey.js';
import { isMouseReport } from '../../mouse.js';

/**
 * FF steps.
 */
type FFStep =
    | 'loading' // Loading pending changes
    | 'confirm' // Awaiting confirmation
    | 'running' // Executing
    | 'complete' // Success
    | 'error'; // Error occurred

type RetirementFailures = Parameters<NonNullable<BatchChangeOptions['confirmRetirement']>>[0];

function formatFailures(changes: ChangeResult[]): string {

    return changes
        .filter((change) => change.status === 'failed' && change.error)
        .map((change) => `${change.name}: ${change.error}`)
        .join('\n');

}

/**
 * ChangeFFScreen component.
 */
export function ChangeFFScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate: _navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ChangeFF');
    const { activeConfig, activeConfigName, projectRoot, settings, stateManager, identity: cryptoIdentity, globalModes } = useAppContext();
    const check = activeConfig ? checkConfigPolicy('user', activeConfig, 'change:ff') : null;

    const { results, currentChange, progress, statement, reset: resetProgress } = useChangeProgress();

    const [step, setStep] = useState<FFStep>('loading');
    const [pendingChanges, setPendingChanges] = useState<ChangeListItem[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [retirement, setRetirement] = useState<RetirementFailures | null>(null);
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    const [highlighted, setHighlighted] = useState<string | null>(null);
    const [confirmingRetirement, setConfirmingRetirement] = useState(false);
    const resolveRetirement = useRef<((names: readonly string[]) => void) | null>(null);
    const screenLifetime = useRef<AbortController | null>(null);

    useBusy(step === 'running');


    const withManager = useCallback(async <T,>(
        run: (manager: ChangeManager) => Promise<T>,
    ): Promise<T> => {

        if (!activeConfig) throw new Error('No active configuration');

        const conn = await createConnection(activeConfig.connection, activeConfigName ?? '__ff__');

        try {

            return await run(createChangeManager({
                db: conn.db as Kysely<NoormDatabase>,
                configName: activeConfigName ?? '',
                projectRoot,
                settings,
                cryptoIdentity,
                activeConfig,
            }));

        }
        finally {

            await conn.destroy();

        }

    }, [activeConfig, activeConfigName, projectRoot, settings, cryptoIdentity]);

    useEffect(() => {

        const lifetime = new AbortController();
        screenLifetime.current = lifetime;

        return () => {

            lifetime.abort();
            resolveRetirement.current?.([]);
            resolveRetirement.current = null;

        };

    }, []);

    const finishRetirement = (names: readonly string[]) => {

        resolveRetirement.current?.(names);
        resolveRetirement.current = null;
        setRetirement(null);

    };

    // Load pending changes
    useAsyncEffect(async (isCancelled) => {

        if (!activeConfig) return;

        const [_, err] = await attempt(async () => {

            const { changes, statuses, failures } = await loadChangesWithStatus(
                activeConfig, activeConfigName ?? '', settings, projectRoot,
            );

            if (isCancelled()) return;

            const pending = buildPendingChangeList(changes, statuses, failures);

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

                const preflight = await withManager((manager) => manager.preflightFastForward());

                if (isCancelled()) return;

                setError(formatFailures(preflight.failures) || (
                    preflight.pending > 0 ? 'Pending changes changed. Reopen Fast-Forward to review.' : 'No pending changes'
                ));
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

    }, [activeConfig, activeConfigName, settings, projectRoot, withManager]);

    // Handle run
    const handleRun = useCallback(async () => {

        const signal = screenLifetime.current?.signal;
        if (!activeConfig || !stateManager || pendingChanges.length === 0 || !signal || signal.aborted) return;

        setStep('running');
        resetProgress(pendingChanges.length);

        const [_, err] = await attempt(async () => {

            const options: BatchChangeOptions = { dryRun: globalModes.dryRun, force: globalModes.force };
            if (!options.dryRun) {

                options.confirmRetirement = (failures) => {

                    if (signal.aborted) return Promise.resolve([]);

                    const { promise, resolve } = Promise.withResolvers<readonly string[]>();
                    resolveRetirement.current = resolve;
                    setSelected(new Set());
                    setHighlighted(null);
                    setConfirmingRetirement(false);
                    setRetirement(failures);

                    return promise;

                };

            }

            const result = await withManager((manager) => manager.ff(options));
            if (signal.aborted) return;

            if (result.failed > 0) {

                setError(formatFailures(result.changes) || result.error || `${result.failed} change(s) failed`);
                setStep('error');

            }
            else {

                setStep('complete');

            }

        });

        if (err && !signal.aborted) {

            setError(getErrorMessage(err));
            setStep('error');

        }

    }, [activeConfig, stateManager, pendingChanges, globalModes, resetProgress, withManager]);

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Keyboard handling
    useInput((input, _key) => {

        if (!isFocused) return;

        if (isMouseReport(input)) return;

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

    if (retirement) {

        const focusedFailure = retirement.find(({ name }) => name === highlighted) ?? retirement[0];

        return (
            <Panel title="Fast-Forward: Retire Changes" paddingX={2} paddingY={1} borderColor="yellow">
                {confirmingRetirement ? (
                    <Box flexDirection="column" gap={1}>
                        <Text>Only retire changes if all supported databases have caught up and no longer need their rollback SQL.</Text>
                        <Text dimColor>Saves to .noorm/retired.yml. The change folders and execution history stay intact.</Text>
                        <Confirm
                            message={`Retire ${selected.size} change(s) for this project?`}
                            variant="warning"
                            defaultChoice="cancel"
                            focusLabel="ChangeFFRetirementConfirm"
                            onConfirm={() => finishRetirement([...selected])}
                            onCancel={() => finishRetirement([])}
                        />
                    </Box>
                ) : (
                    <Box flexDirection="column" gap={1}>
                        <Text>Missing forward SQL. Select changes to retire.</Text>
                        <SelectList
                            items={retirement.map(({ name }) => ({
                                key: name, label: `${selected.has(name) ? '[x]' : '[ ]'} ${name}`, value: name,
                            }))}
                            focusLabel="ChangeFFRetirementSelect"
                            multiSelect
                            reserveRows={9}
                            onHighlight={({ value }) => setHighlighted(value)}
                            onToggle={({ value }) => {

                                setSelected((previous) => {

                                    const next = new Set(previous);
                                    if (next.has(value)) next.delete(value);
                                    else next.add(value);

                                    return next;

                                });

                            }}
                            onSubmit={() => selected.size > 0 ? setConfirmingRetirement(true) : finishRetirement([])}
                            onCancel={() => finishRetirement([])}
                        />
                        <Text dimColor>{focusedFailure?.message}</Text>
                        <Box flexWrap="wrap" columnGap={2}>
                            <Hotkey keys="Space">Toggle</Hotkey>
                            <Hotkey keys="Enter">Continue</Hotkey>
                            <Hotkey keys="Esc">Cancel</Hotkey>
                        </Box>
                    </Box>
                )}
            </Panel>
        );

    }

    // Running
    if (step === 'running') {

        const progressValue = progressPercentage(progress.current, progress.total);

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

                    {statement && <StatementProgress report={statement} />}

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
