/**
 * LockForceScreen - force-release any database lock.
 *
 * Admin operation to force-release a lock regardless of owner.
 * Requires type-to-confirm protection.
 *
 * @example
 * ```bash
 * noorm lock:force    # Opens this screen
 * ```
 */
import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { LockStatus as LockStatusType } from '../../../core/lock/index.js';
import type { NoormDatabase } from '../../../core/shared/index.js';
import type { Kysely } from 'kysely';

import { attempt } from '@logosdx/utils';
import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, ProtectedConfirm, useToast } from '../../components/index.js';
import { createConnection, testConnection } from '../../../core/connection/index.js';
import { getLockManager } from '../../../core/lock/index.js';

/**
 * Screen phase state.
 */
type Phase = 'loading' | 'no-lock' | 'confirm' | 'running' | 'done' | 'error';

/**
 * LockForceScreen component.
 *
 * Protected confirmation to force-release any lock.
 */
export function LockForceScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('LockForce');
    const { activeConfig, activeConfigName } = useAppContext();
    const { showToast } = useToast();

    const [phase, setPhase] = useState<Phase>('loading');
    const [error, setError] = useState<string | null>(null);
    const [lockStatus, setLockStatus] = useState<LockStatusType | null>(null);

    // Check current lock status
    useEffect(() => {

        if (!activeConfig || !activeConfigName) {

            setPhase('error');
            setError('No active configuration');

            return;

        }

        let cancelled = false;

        const checkStatus = async () => {

            // Test connection
            const testResult = await testConnection(activeConfig.connection);

            if (!testResult.ok) {

                if (!cancelled) {

                    setError(`Cannot connect to database: ${testResult.error}`);
                    setPhase('error');

                }

                return;

            }

            // Check lock status
            const [result, err] = await attempt(async () => {

                const conn = await createConnection(
                    activeConfig.connection,
                    activeConfigName ?? undefined,
                );
                const db = conn.db as Kysely<NoormDatabase>;
                const lockManager = getLockManager();

                const status = await lockManager.status(db, activeConfigName ?? '');

                await conn.destroy();

                return status;

            });

            if (cancelled) return;

            if (err) {

                setError(err.message);
                setPhase('error');

                return;

            }

            setLockStatus(result);

            // No lock exists
            if (!result?.isLocked) {

                setPhase('no-lock');

                return;

            }

            setPhase('confirm');

        };

        checkStatus();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName]);

    // Execute force release
    const handleConfirm = useCallback(async () => {

        if (!activeConfig || !activeConfigName) return;

        setPhase('running');

        const [, err] = await attempt(async () => {

            const conn = await createConnection(
                activeConfig.connection,
                activeConfigName ?? undefined,
            );
            const db = conn.db as Kysely<NoormDatabase>;
            const lockManager = getLockManager();

            await lockManager.forceRelease(db, activeConfigName ?? '');

            await conn.destroy();

        });

        if (err) {

            setError(err.message);
            setPhase('error');

            return;

        }

        setPhase('done');

    }, [activeConfig, activeConfigName]);

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Handle done
    const handleDone = useCallback(() => {

        showToast({ message: 'Lock force-released', variant: 'success' });
        back();

    }, [showToast, back]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        if (phase === 'done' || phase === 'error' || phase === 'no-lock') {

            if (key.return || key.escape) {

                if (phase === 'done') {

                    handleDone();

                }
                else if (phase === 'no-lock') {

                    showToast({ message: 'No lock to release', variant: 'info' });
                    back();

                }
                else {

                    back();

                }

            }

        }

    });

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Force Release Lock" borderColor="red" paddingX={1} paddingY={1}>
                <Text color="red">No active configuration selected.</Text>
            </Panel>
        );

    }

    // Loading phase
    if (phase === 'loading') {

        return (
            <Panel title="Force Release Lock" paddingX={1} paddingY={1}>
                <Spinner label="Checking lock status..." />
            </Panel>
        );

    }

    // No lock phase
    if (phase === 'no-lock') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Force Release Lock" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">No lock exists.</Text>
                        <Text dimColor>There is no lock to release for this configuration.</Text>
                    </Box>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Confirm phase
    if (phase === 'confirm' && lockStatus?.lock) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Force Release Lock" borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red">
                            <Text bold>Warning:</Text> This is an admin operation.
                        </Text>
                        <Text dimColor>
                            Force-releasing a lock may interrupt another user's work.
                        </Text>
                        <Box gap={2} marginTop={1}>
                            <Text dimColor>Current holder:</Text>
                            <Text>{lockStatus.lock.lockedBy}</Text>
                        </Box>
                        <Box gap={2}>
                            <Text dimColor>Since:</Text>
                            <Text>{lockStatus.lock.lockedAt?.toLocaleString()}</Text>
                        </Box>
                        {lockStatus.lock.reason && (
                            <Box gap={2}>
                                <Text dimColor>Reason:</Text>
                                <Text>{lockStatus.lock.reason}</Text>
                            </Box>
                        )}
                    </Box>
                </Panel>

                <ProtectedConfirm
                    configName={activeConfigName ?? 'unknown'}
                    action="force-release lock for"
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    focusLabel="LockForceConfirm"
                />
            </Box>
        );

    }

    // Running phase
    if (phase === 'running') {

        return (
            <Panel title="Force Release Lock" paddingX={1} paddingY={1}>
                <Spinner label="Force-releasing lock..." />
            </Panel>
        );

    }

    // Done phase
    if (phase === 'done') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Lock Force-Released" borderColor="green" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="green">Lock successfully force-released.</Text>
                        <Text dimColor>The database is now unlocked.</Text>
                    </Box>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Enter/Esc] Done</Text>
                </Box>
            </Box>
        );

    }

    // Error phase
    if (phase === 'error') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Force Release Failed" borderColor="red" paddingX={1} paddingY={1}>
                    <Text color="red">{error}</Text>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    return <></>;

}
