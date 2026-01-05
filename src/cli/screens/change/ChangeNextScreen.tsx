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
import { useState, useEffect, useCallback, useMemo } from 'react';
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
    Confirm,
    ProtectedConfirm,
    StatusList,
    type StatusListItem,
} from '../../components/index.js';
import { discoverChanges } from '../../../core/change/parser.js';
import { ChangeHistory } from '../../../core/change/history.js';
import { ChangeManager } from '../../../core/change/manager.js';
import { createConnection } from '../../../core/connection/factory.js';
import { resolveIdentity } from '../../../core/identity/resolver.js';
import { observer } from '../../../core/observer.js';

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
    const { activeConfig, activeConfigName, stateManager, identity: cryptoIdentity } = useAppContext();

    // Pre-fill count from params
    const initialCount = params.count ? parseInt(String(params.count), 10) : 1;

    const [step, setStep] = useState<NextStep>('loading');
    const [pendingChanges, setPendingChanges] = useState<ChangeListItem[]>([]);
    const [count, setCount] = useState(initialCount);
    const [countInput, setCountInput] = useState(String(initialCount));
    const [results, setResults] = useState<StatusListItem[]>([]);
    const [currentChange, setCurrentChange] = useState('');
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [error, setError] = useState<string | null>(null);
    const [isProtected, setIsProtected] = useState(false);

    // Load pending changes
    useEffect(() => {

        if (!activeConfig) return;

        let cancelled = false;

        const loadPending = async () => {

            const [_, err] = await attempt(async () => {

                // Discover changes
                const changes = await discoverChanges(
                    activeConfig.paths.changes,
                    activeConfig.paths.sql,
                );

                // Get statuses from database
                const conn = await createConnection(
                    activeConfig.connection,
                    activeConfigName ?? '__next__',
                );
                const db = conn.db as Kysely<NoormDatabase>;

                const history = new ChangeHistory(db, activeConfigName ?? '');
                const statuses = await history.getAllStatuses();

                await conn.destroy();

                if (cancelled) return;

                // Find pending changes
                const pending: ChangeListItem[] = changes
                    .filter((cs) => {

                        const status = statuses.get(cs.name);

                        return (
                            !status || status.status === 'pending' || status.status === 'reverted'
                        );

                    })
                    .map((cs) => ({
                        name: cs.name,
                        path: cs.path,
                        date: cs.date,
                        description: cs.description,
                        status: 'pending' as const,
                        appliedAt: null,
                        appliedBy: null,
                        revertedAt: null,
                        errorMessage: null,
                        isNew: true,
                        orphaned: false,
                        changeFiles: cs.changeFiles,
                        revertFiles: cs.revertFiles,
                    }))
                    .sort((a, b) => {

                        const dateA = a.date?.getTime() ?? 0;
                        const dateB = b.date?.getTime() ?? 0;

                        return dateA - dateB; // Oldest first

                    });

                setPendingChanges(pending);
                setIsProtected(activeConfig.protected ?? false);

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

                if (!cancelled) {

                    setError(err instanceof Error ? err.message : String(err));
                    setStep('error');

                }

            }

        };

        loadPending();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, initialCount]);

    // Subscribe to progress events
    useEffect(() => {

        const unsubStart = observer.on('change:start', (data) => {

            setCurrentChange(data.name);

        });

        const unsubComplete = observer.on('change:complete', (data) => {

            setResults((prev) => [
                ...prev,
                {
                    key: data.name,
                    label: data.name,
                    status: data.status === 'success' ? 'success' : 'error',
                    detail: `${data.durationMs}ms`,
                },
            ]);

            setProgress((prev) => ({ ...prev, current: prev.current + 1 }));

        });

        return () => {

            unsubStart();
            unsubComplete();

        };

    }, []);

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
        setProgress({ current: 0, total: changesToApply.length });
        setResults([]);

        const [_, err] = await attempt(async () => {

            const conn = await createConnection(
                activeConfig.connection,
                activeConfigName ?? '__next__',
            );
            const db = conn.db as Kysely<NoormDatabase>;

            // Resolve identity
            const identity = resolveIdentity({
                cryptoIdentity: cryptoIdentity ?? null,
            });

            // Create manager and run next N
            const manager = new ChangeManager({
                db,
                configName: activeConfigName ?? '',
                identity,
                projectRoot: process.cwd(),
                changesDir: activeConfig.paths.changes,
                sqlDir: activeConfig.paths.sql,
            });

            const result = await manager.next(count);

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

            setError(err instanceof Error ? err.message : String(err));
            setStep('error');

        }

    }, [activeConfig, activeConfigName, stateManager, changesToApply, count]);

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

        if (isProtected) {

            return (
                <Panel title="Apply Next Changes" paddingX={2} paddingY={1} borderColor="yellow">
                    <Box flexDirection="column" gap={1}>
                        {confirmContent}
                        <ProtectedConfirm
                            configName={activeConfigName ?? 'config'}
                            action="apply these changes"
                            onConfirm={handleRun}
                            onCancel={handleCancel}
                            isFocused={isFocused}
                        />
                    </Box>
                </Panel>
            );

        }

        return (
            <Panel title="Apply Next Changes" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    {confirmContent}
                    <Confirm
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
