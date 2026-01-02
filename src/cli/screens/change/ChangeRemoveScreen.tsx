/**
 * ChangeRemoveScreen - delete a change.
 *
 * Removes change from disk and optionally from database tracking.
 * Requires confirmation for applied changes.
 *
 * @example
 * ```bash
 * noorm change:rm add-user-roles    # Delete change
 * noorm change rm add-user-roles    # Same thing
 * ```
 */
import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { Change, ChangeStatus } from '../../../core/change/types.js';
import type { NoormDatabase } from '../../../core/shared/index.js';
import type { Kysely } from 'kysely';

import { attempt } from '@logosdx/utils';
import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, StatusMessage, Confirm } from '../../components/index.js';
import { discoverChanges } from '../../../core/change/parser.js';
import { deleteChange } from '../../../core/change/scaffold.js';
import { ChangeHistory } from '../../../core/change/history.js';
import { createConnection } from '../../../core/connection/factory.js';

/**
 * Remove steps.
 */
type RemoveStep =
    | 'loading' // Finding change
    | 'confirm' // Awaiting confirmation
    | 'deleting' // Deleting
    | 'complete' // Success
    | 'error'; // Error occurred

/**
 * ChangeRemoveScreen component.
 */
export function ChangeRemoveScreen({ params }: ScreenProps): ReactElement {

    const { navigate: _navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ChangeRemove');
    const { activeConfig, activeConfigName } = useAppContext();

    const changeName = params.name;

    const [step, setStep] = useState<RemoveStep>('loading');
    const [change, setChange] = useState<Change | null>(null);
    const [status, setStatus] = useState<ChangeStatus | null>(null);
    const [isOrphaned, setIsOrphaned] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Load change info
    useEffect(() => {

        if (!activeConfig || !changeName) {

            return;

        }

        let cancelled = false;

        const loadChange = async () => {

            const [_, err] = await attempt(async () => {

                // Find the change on disk
                const changes = await discoverChanges(
                    activeConfig.paths.changes,
                    activeConfig.paths.sql,
                );

                const found = changes.find((cs) => cs.name === changeName);

                // Get status from database
                const conn = await createConnection(
                    activeConfig.connection,
                    activeConfigName ?? '__rm__',
                );
                const db = conn.db as Kysely<NoormDatabase>;

                const history = new ChangeHistory(db, activeConfigName ?? '');
                const statuses = await history.getAllStatuses();
                const dbStatus = statuses.get(changeName);

                await conn.destroy();

                if (cancelled) return;

                if (found) {

                    setChange(found);
                    setIsOrphaned(false);

                }
                else if (dbStatus) {

                    setIsOrphaned(true);

                }
                else {

                    throw new Error(`Change not found: ${changeName}`);

                }

                setStatus(dbStatus ?? null);
                setStep('confirm');

            });

            if (err) {

                if (!cancelled) {

                    setError(err instanceof Error ? err.message : String(err));
                    setStep('error');

                }

            }

        };

        loadChange();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, changeName]);

    // Handle delete
    const handleDelete = useCallback(async () => {

        if (!activeConfig) return;

        setStep('deleting');

        const [_, err] = await attempt(async () => {

            // Delete from disk if not orphaned
            if (change) {

                await deleteChange(change);

            }

            // If it was applied, also remove from database
            if (status) {

                const conn = await createConnection(
                    activeConfig.connection,
                    activeConfigName ?? '__rm__',
                );
                const db = conn.db as Kysely<NoormDatabase>;

                const history = new ChangeHistory(db, activeConfigName ?? '');
                await history.deleteRecords(changeName!);

                await conn.destroy();

            }

            setStep('complete');

        });

        if (err) {

            setError(err instanceof Error ? err.message : String(err));
            setStep('error');

        }

    }, [activeConfig, activeConfigName, change, status, changeName]);

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

    // No change name provided
    if (!changeName) {

        return (
            <Panel title="Delete Change" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No change name provided.</Text>
            </Panel>
        );

    }

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Delete Change" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration.</Text>
            </Panel>
        );

    }

    // Loading
    if (step === 'loading') {

        return (
            <Panel title="Delete Change" paddingX={2} paddingY={1}>
                <Spinner label="Loading change..." />
            </Panel>
        );

    }

    // Confirm
    if (step === 'confirm') {

        const warningMessage =
            status?.status === 'success'
                ? 'This change has been applied to the database.'
                : isOrphaned
                    ? 'This is an orphaned change (exists in DB but not on disk).'
                    : 'This change has not been applied.';

        return (
            <Panel title="Delete Change" paddingX={2} paddingY={1} borderColor="yellow">
                <Box flexDirection="column" gap={1}>
                    <Text>
                        Delete change:{' '}
                        <Text bold color="cyan">
                            {changeName}
                        </Text>
                    </Text>

                    {change && (
                        <Box flexDirection="column">
                            <Text dimColor>
                                Files: {change.changeFiles.length} change,{' '}
                                {change.revertFiles.length} revert
                            </Text>
                        </Box>
                    )}

                    <Text color="yellow">{warningMessage}</Text>

                    <Confirm
                        message="Are you sure you want to delete this change?"
                        onConfirm={handleDelete}
                        onCancel={handleCancel}
                        isFocused={isFocused}
                    />
                </Box>
            </Panel>
        );

    }

    // Deleting
    if (step === 'deleting') {

        return (
            <Panel title="Delete Change" paddingX={2} paddingY={1}>
                <Spinner label="Deleting change..." />
            </Panel>
        );

    }

    // Complete
    if (step === 'complete') {

        return (
            <Panel title="Delete Change" paddingX={2} paddingY={1} borderColor="green">
                <Box flexDirection="column" gap={1}>
                    <StatusMessage variant="success">
                        Change "{changeName}" deleted.
                    </StatusMessage>
                    <Box marginTop={1}>
                        <Text dimColor>Press any key to continue...</Text>
                    </Box>
                </Box>
            </Panel>
        );

    }

    // Error
    return (
        <Panel title="Delete Change" paddingX={2} paddingY={1} borderColor="red">
            <Box flexDirection="column" gap={1}>
                <StatusMessage variant="error">{error}</StatusMessage>
                <Box marginTop={1}>
                    <Text dimColor>Press any key to continue...</Text>
                </Box>
            </Box>
        </Panel>
    );

}
