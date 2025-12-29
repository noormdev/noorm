/**
 * LockReleaseScreen - release your database lock.
 *
 * Releases a lock held by the current user.
 * Requires confirmation before releasing.
 *
 * @example
 * ```bash
 * noorm lock:release    # Opens this screen
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
import { Panel, Spinner, Confirm, useToast } from '../../components/index.js';
import { createConnection, testConnection } from '../../../core/connection/index.js';
import {
    getLockManager,
    LockNotFoundError,
    LockOwnershipError,
} from '../../../core/lock/index.js';
import { resolveIdentity, formatIdentity } from '../../../core/identity/index.js';

/**
 * Screen phase state.
 */
type Phase = 'loading' | 'no-lock' | 'not-yours' | 'confirm' | 'running' | 'done' | 'error';

/**
 * LockReleaseScreen component.
 *
 * Confirmation dialog to release your lock.
 */
export function LockReleaseScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('LockRelease');
    const { activeConfig, activeConfigName, stateManager } = useAppContext();
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
                cryptoIdentity: stateManager?.getIdentity() ?? null,
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

            // No lock exists
            if (!result?.isLocked) {

                setPhase('no-lock');

                return;

            }

            // Lock held by someone else
            if (result.lock?.lockedBy !== formattedIdentity) {

                setPhase('not-yours');

                return;

            }

            setPhase('confirm');

        };

        checkStatus();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, stateManager]);

    // Execute lock release
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

            await lockManager.release(db, activeConfigName ?? '', identityStr);

            await conn.destroy();

        });

        if (err) {

            if (err instanceof LockNotFoundError) {

                setError('Lock no longer exists');

            }
            else if (err instanceof LockOwnershipError) {

                setError(`Lock is held by ${err.actualHolder}, not you`);

            }
            else {

                setError(err.message);

            }

            setPhase('error');

            return;

        }

        setPhase('done');

    }, [activeConfig, activeConfigName, identityStr]);

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Handle done
    const handleDone = useCallback(() => {

        showToast({ message: 'Lock released', variant: 'success' });
        back();

    }, [showToast, back]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        if (phase === 'done' || phase === 'error' || phase === 'no-lock' || phase === 'not-yours') {

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
            <Panel title="Release Lock" borderColor="red" paddingX={1} paddingY={1}>
                <Text color="red">No active configuration selected.</Text>
            </Panel>
        );

    }

    // Loading phase
    if (phase === 'loading') {

        return (
            <Panel title="Release Lock" paddingX={1} paddingY={1}>
                <Spinner label="Checking lock status..." />
            </Panel>
        );

    }

    // No lock phase
    if (phase === 'no-lock') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Release Lock" borderColor="yellow" paddingX={1} paddingY={1}>
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

    // Not yours phase
    if (phase === 'not-yours' && lockStatus?.lock) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Release Lock" borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red">This lock is not yours.</Text>
                        <Box gap={2}>
                            <Text dimColor>Holder:</Text>
                            <Text>{lockStatus.lock.lockedBy}</Text>
                        </Box>
                        <Text dimColor>
                            You can only release locks you own. Use force-release for emergencies.
                        </Text>
                    </Box>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Confirm phase
    if (phase === 'confirm') {

        return (
            <Confirm
                title="Release Lock"
                message="Are you sure you want to release your lock? Other users will be able to acquire it."
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                focusLabel="LockReleaseConfirm"
            />
        );

    }

    // Running phase
    if (phase === 'running') {

        return (
            <Panel title="Release Lock" paddingX={1} paddingY={1}>
                <Spinner label="Releasing lock..." />
            </Panel>
        );

    }

    // Done phase
    if (phase === 'done') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Lock Released" borderColor="green" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="green">Lock successfully released.</Text>
                        <Text dimColor>Other users can now acquire the lock.</Text>
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
                <Panel title="Release Lock Failed" borderColor="red" paddingX={1} paddingY={1}>
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
