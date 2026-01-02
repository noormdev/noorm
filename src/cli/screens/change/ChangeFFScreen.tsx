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
import { useState, useEffect, useCallback } from 'react';
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
    const { activeConfig, activeConfigName, stateManager } = useAppContext();

    const [step, setStep] = useState<FFStep>('loading');
    const [pendingChanges, setPendingChanges] = useState<ChangeListItem[]>([]);
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
                    activeConfigName ?? '__ff__',
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
                else {

                    setStep('confirm');

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

    }, [activeConfig, activeConfigName]);

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

    // Handle run
    const handleRun = useCallback(async () => {

        if (!activeConfig || !stateManager || pendingChanges.length === 0) return;

        setStep('running');
        setProgress({ current: 0, total: pendingChanges.length });
        setResults([]);

        const [_, err] = await attempt(async () => {

            const conn = await createConnection(
                activeConfig.connection,
                activeConfigName ?? '__ff__',
            );
            const db = conn.db as Kysely<NoormDatabase>;

            // Resolve identity
            const identity = resolveIdentity({
                cryptoIdentity: stateManager?.getIdentity() ?? null,
            });

            // Create manager and fast-forward
            const manager = new ChangeManager({
                db,
                configName: activeConfigName ?? '',
                identity,
                projectRoot: process.cwd(),
                changesDir: activeConfig.paths.changes,
                sqlDir: activeConfig.paths.sql,
            });

            const result = await manager.ff();

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

    }, [activeConfig, activeConfigName, stateManager, pendingChanges]);

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

        if (isProtected) {

            return (
                <Panel title="Fast-Forward" paddingX={2} paddingY={1} borderColor="yellow">
                    <Box flexDirection="column" gap={1}>
                        {confirmContent}
                        <ProtectedConfirm
                            configName={activeConfigName ?? 'config'}
                            action="apply all pending changes"
                            onConfirm={handleRun}
                            onCancel={handleCancel}
                            isFocused={isFocused}
                        />
                    </Box>
                </Panel>
            );

        }

        return (
            <Panel title="Fast-Forward" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    {confirmContent}
                    <Confirm
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
