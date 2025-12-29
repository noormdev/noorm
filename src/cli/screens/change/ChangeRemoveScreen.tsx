/**
 * ChangeRemoveScreen - delete a changeset.
 *
 * Removes changeset from disk and optionally from database tracking.
 * Requires confirmation for applied changesets.
 *
 * @example
 * ```bash
 * noorm change:rm add-user-roles    # Delete changeset
 * noorm change rm add-user-roles    # Same thing
 * ```
 */
import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { Changeset, ChangesetStatus } from '../../../core/changeset/types.js';
import type { NoormDatabase } from '../../../core/shared/index.js';
import type { Kysely } from 'kysely';

import { attempt } from '@logosdx/utils';
import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, StatusMessage, Confirm } from '../../components/index.js';
import { discoverChangesets } from '../../../core/changeset/parser.js';
import { deleteChangeset } from '../../../core/changeset/scaffold.js';
import { ChangesetHistory } from '../../../core/changeset/history.js';
import { createConnection } from '../../../core/connection/factory.js';

/**
 * Remove steps.
 */
type RemoveStep =
    | 'loading' // Finding changeset
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

    const changesetName = params.name;

    const [step, setStep] = useState<RemoveStep>('loading');
    const [changeset, setChangeset] = useState<Changeset | null>(null);
    const [status, setStatus] = useState<ChangesetStatus | null>(null);
    const [isOrphaned, setIsOrphaned] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Load changeset info
    useEffect(() => {

        if (!activeConfig || !changesetName) {

            return;

        }

        let cancelled = false;

        const loadChangeset = async () => {

            const [_, err] = await attempt(async () => {

                // Find the changeset on disk
                const changesets = await discoverChangesets(
                    activeConfig.paths.changesets,
                    activeConfig.paths.schema,
                );

                const found = changesets.find((cs) => cs.name === changesetName);

                // Get status from database
                const conn = await createConnection(
                    activeConfig.connection,
                    activeConfigName ?? '__rm__',
                );
                const db = conn.db as Kysely<NoormDatabase>;

                const history = new ChangesetHistory(db, activeConfigName ?? '');
                const statuses = await history.getAllStatuses();
                const dbStatus = statuses.get(changesetName);

                await conn.destroy();

                if (cancelled) return;

                if (found) {

                    setChangeset(found);
                    setIsOrphaned(false);

                }
                else if (dbStatus) {

                    setIsOrphaned(true);

                }
                else {

                    throw new Error(`Changeset not found: ${changesetName}`);

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

        loadChangeset();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, changesetName]);

    // Handle delete
    const handleDelete = useCallback(async () => {

        if (!activeConfig) return;

        setStep('deleting');

        const [_, err] = await attempt(async () => {

            // Delete from disk if not orphaned
            if (changeset) {

                await deleteChangeset(changeset);

            }

            // If it was applied, also remove from database
            if (status) {

                const conn = await createConnection(
                    activeConfig.connection,
                    activeConfigName ?? '__rm__',
                );
                const db = conn.db as Kysely<NoormDatabase>;

                const history = new ChangesetHistory(db, activeConfigName ?? '');
                await history.deleteRecords(changesetName!);

                await conn.destroy();

            }

            setStep('complete');

        });

        if (err) {

            setError(err instanceof Error ? err.message : String(err));
            setStep('error');

        }

    }, [activeConfig, activeConfigName, changeset, status, changesetName]);

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

    // No changeset name provided
    if (!changesetName) {

        return (
            <Panel title="Delete Changeset" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No changeset name provided.</Text>
            </Panel>
        );

    }

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Delete Changeset" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration.</Text>
            </Panel>
        );

    }

    // Loading
    if (step === 'loading') {

        return (
            <Panel title="Delete Changeset" paddingX={2} paddingY={1}>
                <Spinner label="Loading changeset..." />
            </Panel>
        );

    }

    // Confirm
    if (step === 'confirm') {

        const warningMessage =
            status?.status === 'success'
                ? 'This changeset has been applied to the database.'
                : isOrphaned
                    ? 'This is an orphaned changeset (exists in DB but not on disk).'
                    : 'This changeset has not been applied.';

        return (
            <Panel title="Delete Changeset" paddingX={2} paddingY={1} borderColor="yellow">
                <Box flexDirection="column" gap={1}>
                    <Text>
                        Delete changeset:{' '}
                        <Text bold color="cyan">
                            {changesetName}
                        </Text>
                    </Text>

                    {changeset && (
                        <Box flexDirection="column">
                            <Text dimColor>
                                Files: {changeset.changeFiles.length} change,{' '}
                                {changeset.revertFiles.length} revert
                            </Text>
                        </Box>
                    )}

                    <Text color="yellow">{warningMessage}</Text>

                    <Confirm
                        message="Are you sure you want to delete this changeset?"
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
            <Panel title="Delete Changeset" paddingX={2} paddingY={1}>
                <Spinner label="Deleting changeset..." />
            </Panel>
        );

    }

    // Complete
    if (step === 'complete') {

        return (
            <Panel title="Delete Changeset" paddingX={2} paddingY={1} borderColor="green">
                <Box flexDirection="column" gap={1}>
                    <StatusMessage variant="success">
                        Changeset "{changesetName}" deleted.
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
        <Panel title="Delete Changeset" paddingX={2} paddingY={1} borderColor="red">
            <Box flexDirection="column" gap={1}>
                <StatusMessage variant="error">{error}</StatusMessage>
                <Box marginTop={1}>
                    <Text dimColor>Press any key to continue...</Text>
                </Box>
            </Box>
        </Panel>
    );

}
