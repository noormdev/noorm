/**
 * LockAcquireScreen - acquire a database lock.
 *
 * Acquires an exclusive lock on the database for the current user.
 * Options:
 * - timeout: Lock duration in minutes (default: 5)
 * - reason: Optional reason for acquiring the lock
 *
 * @example
 * ```bash
 * noorm lock:acquire    # Opens this screen
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
import { Panel, Spinner, Form, useToast } from '../../components/index.js';
import { createConnection, testConnection } from '../../../core/connection/index.js';
import { getLockManager, LockAcquireError } from '../../../core/lock/index.js';
import { resolveIdentity, formatIdentity } from '../../../core/identity/index.js';

/**
 * Screen phase state.
 */
type Phase = 'loading' | 'blocked' | 'form' | 'running' | 'done' | 'error';

/**
 * LockAcquireScreen component.
 *
 * Form to acquire a lock with timeout and reason options.
 */
export function LockAcquireScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('LockAcquire');
    const { activeConfig, activeConfigName, identity: cryptoIdentity } = useAppContext();
    const { showToast } = useToast();

    const [phase, setPhase] = useState<Phase>('loading');
    const [error, setError] = useState<string | null>(null);
    const [lockStatus, setLockStatus] = useState<LockStatusType | null>(null);
    const [identityStr, setIdentityStr] = useState<string>('');

    // Check current lock status
    useEffect(() => {

        if (!activeConfig || !activeConfigName) {

            setPhase('error');
            setError('No active configuration');

            return;

        }

        let cancelled = false;

        const checkStatus = async () => {

            // Resolve identity
            const identity = resolveIdentity({
                cryptoIdentity: cryptoIdentity ?? null,
            });
            const formattedIdentity = formatIdentity(identity);

            if (!cancelled) {

                setIdentityStr(formattedIdentity);

            }

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

            // If locked by someone else, show blocked state
            if (result?.isLocked && result.lock?.lockedBy !== formattedIdentity) {

                setPhase('blocked');

                return;

            }

            setPhase('form');

        };

        checkStatus();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, cryptoIdentity]);

    // Execute lock acquisition
    const handleSubmit = useCallback(
        (values: Record<string, string | boolean>) => {

            if (!activeConfig || !activeConfigName) return;

            setPhase('running');

            const timeout = parseInt(String(values['timeout'] ?? '5'), 10) * 60 * 1000; // Convert to ms
            const reason = values['reason'] ? String(values['reason']) : undefined;

            const execute = async () => {

                const [, err] = await attempt(async () => {

                    const conn = await createConnection(
                        activeConfig.connection,
                        activeConfigName ?? undefined,
                    );
                    const db = conn.db as Kysely<NoormDatabase>;
                    const lockManager = getLockManager();

                    await lockManager.acquire(db, activeConfigName ?? '', identityStr, {
                        timeout,
                        reason,
                    });

                    await conn.destroy();

                });

                if (err) {

                    if (err instanceof LockAcquireError) {

                        setError(`Lock held by ${err.holder} since ${err.heldSince?.toLocaleString()}${err.reason ? ` (${err.reason})` : ''}`);

                    }
                    else {

                        setError(err.message);

                    }

                    setPhase('error');

                    return;

                }

                setPhase('done');

            };

            execute();

        },
        [activeConfig, activeConfigName, identityStr],
    );

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Handle done
    const handleDone = useCallback(() => {

        showToast({ message: 'Lock acquired', variant: 'success' });
        back();

    }, [showToast, back]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        if (phase === 'done' || phase === 'error' || phase === 'blocked') {

            if (key.return || key.escape) {

                if (phase === 'done') {

                    handleDone();

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
            <Panel title="Acquire Lock" borderColor="red" paddingX={1} paddingY={1}>
                <Text color="red">No active configuration selected.</Text>
            </Panel>
        );

    }

    // Loading phase
    if (phase === 'loading') {

        return (
            <Panel title="Acquire Lock" paddingX={1} paddingY={1}>
                <Spinner label="Checking lock status..." />
            </Panel>
        );

    }

    // Blocked phase - someone else holds the lock
    if (phase === 'blocked' && lockStatus?.lock) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Acquire Lock" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">Lock is currently held by another user.</Text>
                        <Box gap={2}>
                            <Text dimColor>Holder:</Text>
                            <Text>{lockStatus.lock.lockedBy}</Text>
                        </Box>
                        <Box gap={2}>
                            <Text dimColor>Since:</Text>
                            <Text>{lockStatus.lock.lockedAt?.toLocaleString()}</Text>
                        </Box>
                        <Box gap={2}>
                            <Text dimColor>Expires:</Text>
                            <Text>{lockStatus.lock.expiresAt?.toLocaleString()}</Text>
                        </Box>
                        {lockStatus.lock.reason && (
                            <Box gap={2}>
                                <Text dimColor>Reason:</Text>
                                <Text>{lockStatus.lock.reason}</Text>
                            </Box>
                        )}
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Form phase
    if (phase === 'form') {

        const isExtending = lockStatus?.isLocked && lockStatus.lock?.lockedBy === identityStr;

        return (
            <Box flexDirection="column" gap={1}>
                {isExtending && (
                    <Panel title="Extending Lock" borderColor="blue" paddingX={1} paddingY={1}>
                        <Text color="blue">
                            You already hold this lock. Submitting will extend it.
                        </Text>
                    </Panel>
                )}

                <Panel title={isExtending ? 'Extend Lock' : 'Acquire Lock'} paddingX={1} paddingY={1}>
                    <Form
                        fields={[
                            {
                                key: 'timeout',
                                label: 'Timeout (minutes)',
                                type: 'text',
                                defaultValue: '5',
                                placeholder: '5',
                            },
                            {
                                key: 'reason',
                                label: 'Reason (optional)',
                                type: 'text',
                                placeholder: 'Running migrations...',
                            },
                        ]}
                        onSubmit={handleSubmit}
                        onCancel={handleCancel}
                        focusLabel="LockAcquireForm"
                        submitLabel={isExtending ? 'Extend' : 'Acquire'}
                    />
                </Panel>
            </Box>
        );

    }

    // Running phase
    if (phase === 'running') {

        return (
            <Panel title="Acquire Lock" paddingX={1} paddingY={1}>
                <Spinner label="Acquiring lock..." />
            </Panel>
        );

    }

    // Done phase
    if (phase === 'done') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Lock Acquired" borderColor="green" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="green">Lock successfully acquired.</Text>
                        <Text dimColor>You have exclusive access to this database.</Text>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter/Esc] Done</Text>
                </Box>
            </Box>
        );

    }

    // Error phase
    if (phase === 'error') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Acquire Lock Failed" borderColor="red" paddingX={1} paddingY={1}>
                    <Text color="red">{error}</Text>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    return <></>;

}
