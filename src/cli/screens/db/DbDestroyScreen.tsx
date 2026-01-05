/**
 * DbDestroyScreen - drop database.
 *
 * Drops the entire database.
 * Protected configs cannot be destroyed.
 * Delegates to core/db module for database operations.
 *
 * @example
 * ```bash
 * noorm db:destroy              # TUI mode
 * noorm db:destroy --yes        # Skip confirmation
 * ```
 */
import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { DbStatus } from '../../../core/db/index.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { useToast, Panel, Spinner, ProtectedConfirm } from '../../components/index.js';
import { checkDbStatus, destroyDb } from '../../../core/db/index.js';

/**
 * Screen phase state.
 */
type Phase = 'loading' | 'confirm' | 'running' | 'done' | 'error' | 'blocked';

/**
 * DbDestroyScreen component.
 *
 * Drops the database. Protected configs are blocked.
 */
export function DbDestroyScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('DbDestroy');
    const { activeConfig, activeConfigName } = useAppContext();
    const { showToast } = useToast();

    // Phase state
    const [phase, setPhase] = useState<Phase>('loading');
    const [error, setError] = useState<string | null>(null);

    // Status info
    const [status, setStatus] = useState<DbStatus | null>(null);

    // Check current state
    useEffect(() => {

        if (!activeConfig || !activeConfigName) {

            setPhase('error');
            setError('No active configuration');

            return;

        }

        // Block protected configs
        if (activeConfig.protected) {

            setPhase('blocked');

            return;

        }

        let cancelled = false;

        const check = async () => {

            const result = await checkDbStatus(activeConfig.connection);

            if (cancelled) return;

            if (!result.serverOk) {

                setError(`Cannot connect to server: ${result.error}`);
                setPhase('error');

                return;

            }

            setStatus(result);
            setPhase('confirm');

        };

        check();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName]);

    // Execute destruction
    const executeDestroy = useCallback(async () => {

        if (!activeConfig || !activeConfigName) return;

        setPhase('running');

        const result = await destroyDb(activeConfig.connection, activeConfigName);

        if (!result.ok) {

            setError(result.error ?? 'Failed to drop database');
            setPhase('error');

            return;

        }

        setPhase('done');

    }, [activeConfig, activeConfigName]);

    // Handle confirm
    const handleConfirm = useCallback(() => {

        executeDestroy();

    }, [executeDestroy]);

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Handle done
    const handleDone = useCallback(() => {

        showToast({ message: 'Database dropped', variant: 'success' });
        back();

    }, [showToast, back]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        if (phase === 'blocked') {

            if (key.escape || key.return) {

                back();

            }

        }

        if (phase === 'confirm' && status && !status.exists) {

            if (key.escape) {

                back();

            }

        }

        if (phase === 'done' || phase === 'error') {

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
            <Panel title="Destroy Database" borderColor="red" paddingX={1} paddingY={1}>
                <Text color="red">No active configuration selected.</Text>
            </Panel>
        );

    }

    // Blocked - protected config
    if (phase === 'blocked') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Destroy Database" borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red">
                            Cannot destroy protected configuration{' '}
                            <Text bold>{activeConfigName}</Text>
                        </Text>
                        <Text dimColor>
                            Protected configs cannot be dropped to prevent accidental data loss.
                        </Text>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Enter/Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Loading phase
    if (phase === 'loading') {

        return (
            <Panel title="Destroy Database" paddingX={1} paddingY={1}>
                <Spinner label="Checking database status..." />
            </Panel>
        );

    }

    // Confirm phase
    if (phase === 'confirm' && status) {

        // Nothing to destroy
        if (!status.exists) {

            return (
                <Box flexDirection="column" gap={1}>
                    <Panel title="Destroy Database" borderColor="yellow" paddingX={1} paddingY={1}>
                        <Box flexDirection="column" gap={1}>
                            <Text color="yellow">
                                Database "{activeConfig.connection.database}" does not exist.
                            </Text>
                            <Text dimColor>Nothing to destroy.</Text>
                        </Box>
                    </Panel>

                    <Box flexWrap="wrap" columnGap={2}>
                        <Text dimColor>[Esc] Back</Text>
                    </Box>
                </Box>
            );

        }

        // Type-to-confirm for destructive operation
        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Destroy Database" borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text>
                            This will{' '}
                            <Text bold color="red">
                                permanently drop
                            </Text>{' '}
                            the database
                        </Text>
                        <Text dimColor>Database: {activeConfig.connection.database}</Text>
                    </Box>
                </Panel>

                <ProtectedConfirm
                    configName={activeConfigName ?? 'unknown'}
                    action="drop database for"
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    focusLabel="DbDestroyConfirm"
                />
            </Box>
        );

    }

    // Running phase
    if (phase === 'running') {

        return (
            <Panel title="Destroy Database" paddingX={1} paddingY={1}>
                <Spinner label="Dropping database..." />
            </Panel>
        );

    }

    // Done phase
    if (phase === 'done') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Database Destroyed" borderColor="green" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="green">
                            Database <Text bold>{activeConfig.connection.database}</Text> has been
                            dropped.
                        </Text>
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
                <Panel title="Destroy Database Failed" borderColor="red" paddingX={1} paddingY={1}>
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
