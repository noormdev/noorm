/**
 * DbCreateScreen - create a new database.
 *
 * Creates the database and bootstraps noorm tracking tables.
 * Delegates to core/db module for database operations.
 *
 * @example
 * ```bash
 * noorm db:create              # TUI mode
 * noorm db:create --yes        # Skip confirmation
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
import { useToast, Panel, Spinner, Confirm, ProtectedConfirm } from '../../components/index.js';
import { checkDbStatus, createDb } from '../../../core/db/index.js';

/**
 * Screen phase state.
 */
type Phase = 'loading' | 'confirm' | 'running' | 'done' | 'error';

/**
 * DbCreateScreen component.
 *
 * Creates a database and bootstraps tracking tables.
 */
export function DbCreateScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('DbCreate');
    const { activeConfig, activeConfigName } = useAppContext();
    const { showToast } = useToast();

    // Phase state
    const [phase, setPhase] = useState<Phase>('loading');
    const [error, setError] = useState<string | null>(null);

    // Status info
    const [status, setStatus] = useState<DbStatus | null>(null);

    // Check database status
    useEffect(() => {

        if (!activeConfig || !activeConfigName) {

            setPhase('error');
            setError('No active configuration');

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

    // Execute the creation
    const executeCreate = useCallback(async () => {

        if (!activeConfig || !activeConfigName) return;

        setPhase('running');

        const result = await createDb(activeConfig.connection, activeConfigName);

        if (!result.ok) {

            setError(result.error ?? 'Failed to create database');
            setPhase('error');

            return;

        }

        setPhase('done');

    }, [activeConfig, activeConfigName]);

    // Handle confirm
    const handleConfirm = useCallback(() => {

        executeCreate();

    }, [executeCreate]);

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Handle done
    const handleDone = useCallback(() => {

        const message =
            status?.exists && status?.trackingInitialized
                ? 'Database already initialized'
                : status?.exists
                    ? 'Tracking tables initialized'
                    : 'Database created successfully';

        showToast({ message, variant: 'success' });
        back();

    }, [status, showToast, back]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

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
            <Panel title="Create Database" borderColor="red" paddingX={1} paddingY={1}>
                <Text color="red">No active configuration selected.</Text>
            </Panel>
        );

    }

    // Loading phase
    if (phase === 'loading') {

        return (
            <Panel title="Create Database" paddingX={1} paddingY={1}>
                <Spinner label="Checking database status..." />
            </Panel>
        );

    }

    // Confirm phase
    if (phase === 'confirm' && status) {

        const dbName = activeConfig.connection.database;

        // Already fully initialized
        if (status.exists && status.trackingInitialized) {

            return (
                <Box flexDirection="column" gap={1}>
                    <Panel title="Create Database" borderColor="yellow" paddingX={1} paddingY={1}>
                        <Box flexDirection="column" gap={1}>
                            <Text color="yellow">
                                Database <Text bold>{dbName}</Text> already exists and is
                                initialized.
                            </Text>
                            <Text dimColor>No action needed.</Text>
                        </Box>
                    </Panel>

                    <Box gap={2}>
                        <Text dimColor>[Esc] Back</Text>
                    </Box>
                </Box>
            );

        }

        // Determine what we're going to do
        const willCreateDb = !status.exists;

        const actionText = willCreateDb
            ? `Create database "${dbName}" and initialize tracking tables?`
            : `Initialize tracking tables in "${dbName}"?`;

        // Protected config requires type-to-confirm
        if (activeConfig.protected) {

            return (
                <ProtectedConfirm
                    configName={activeConfigName ?? 'unknown'}
                    action={willCreateDb ? 'create database for' : 'initialize tracking for'}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    focusLabel="DbCreateConfirm"
                />
            );

        }

        // Regular confirmation
        return (
            <Confirm
                title="Create Database"
                message={actionText}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                focusLabel="DbCreateConfirm"
            />
        );

    }

    // Running phase
    if (phase === 'running') {

        const label =
            status && !status.exists ? 'Creating database...' : 'Initializing tracking tables...';

        return (
            <Panel title="Create Database" paddingX={1} paddingY={1}>
                <Spinner label={label} />
            </Panel>
        );

    }

    // Done phase
    if (phase === 'done') {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Database Created" borderColor="green" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="green">
                            Database <Text bold>{activeConfig.connection.database}</Text> is ready.
                        </Text>
                        <Text dimColor>Tracking tables have been initialized.</Text>
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
                <Panel title="Create Database Failed" borderColor="red" paddingX={1} paddingY={1}>
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
