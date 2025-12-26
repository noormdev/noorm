/**
 * ChangeRevertScreen - rollback a single changeset.
 *
 * Executes the revert files for an applied changeset.
 * Requires confirmation for protected configs.
 *
 * @example
 * ```bash
 * noorm change:revert add-user-roles    # Revert changeset
 * noorm change revert add-user-roles    # Same thing
 * ```
 */
import { useState, useEffect, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { ProgressBar } from '@inkjs/ui'

import type { ReactElement } from 'react'
import type { ScreenProps } from '../../types.js'
import type { Changeset, ChangesetResult } from '../../../core/changeset/types.js'
import type { NoormDatabase } from '../../../core/shared/index.js'
import type { Kysely } from 'kysely'

import { attempt } from '@logosdx/utils'
import { useRouter } from '../../router.js'
import { useFocusScope } from '../../focus.js'
import { useAppContext } from '../../app-context.js'
import { Panel, Spinner, StatusMessage, Confirm, ProtectedConfirm } from '../../components/index.js'
import { discoverChangesets } from '../../../core/changeset/parser.js'
import { ChangesetHistory } from '../../../core/changeset/history.js'
import { revertChangeset } from '../../../core/changeset/executor.js'
import { createConnection } from '../../../core/connection/factory.js'
import { resolveIdentity } from '../../../core/identity/resolver.js'
import { observer } from '../../../core/observer.js'


/**
 * Revert steps.
 */
type RevertStep =
    | 'loading'        // Finding changeset
    | 'confirm'        // Awaiting confirmation
    | 'reverting'      // Executing
    | 'complete'       // Success
    | 'error'          // Error occurred


/**
 * ChangeRevertScreen component.
 */
export function ChangeRevertScreen({ params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter()
    const { isFocused } = useFocusScope('ChangeRevert')
    const { activeConfig, activeConfigName, stateManager } = useAppContext()

    const changesetName = params.name

    const [step, setStep] = useState<RevertStep>('loading')
    const [changeset, setChangeset] = useState<Changeset | null>(null)
    const [result, setResult] = useState<ChangesetResult | null>(null)
    const [progress, setProgress] = useState({ current: 0, total: 0 })
    const [currentFile, setCurrentFile] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [isProtected, setIsProtected] = useState(false)

    // Load changeset info
    useEffect(() => {

        if (!activeConfig || !changesetName) {

            return
        }

        let cancelled = false

        const loadChangeset = async () => {

            const [_, err] = await attempt(async () => {

                // Find the changeset on disk
                const changesets = await discoverChangesets(
                    activeConfig.paths.changesets,
                    activeConfig.paths.schema,
                )

                const found = changesets.find(cs => cs.name === changesetName)

                if (!found) {

                    throw new Error(`Changeset not found: ${changesetName}`)
                }

                // Check if applied
                const conn = await createConnection(activeConfig.connection, activeConfigName ?? '__revert__')
                const db = conn.db as Kysely<NoormDatabase>

                const history = new ChangesetHistory(db, activeConfigName ?? '')
                const statuses = await history.getAllStatuses()
                const status = statuses.get(changesetName)

                await conn.destroy()

                if (cancelled) return

                if (status?.status !== 'success') {

                    throw new Error(`Changeset "${changesetName}" is not applied`)
                }

                if (found.revertFiles.length === 0) {

                    throw new Error(`Changeset "${changesetName}" has no revert files`)
                }

                setChangeset(found)
                setIsProtected(activeConfig.protected ?? false)
                setStep('confirm')
            })

            if (err) {

                if (!cancelled) {

                    setError(err instanceof Error ? err.message : String(err))
                    setStep('error')
                }
            }
        }

        loadChangeset()

        return () => {

            cancelled = true
        }
    }, [activeConfig, activeConfigName, changesetName])

    // Subscribe to progress events
    useEffect(() => {

        const unsubFile = observer.on('changeset:file', (data) => {

            if (data.changeset === changesetName) {

                setProgress({ current: data.index, total: data.total })
                setCurrentFile(data.filepath)
            }
        })

        return () => {

            unsubFile()
        }
    }, [changesetName])

    // Handle revert
    const handleRevert = useCallback(async () => {

        if (!activeConfig || !changeset || !stateManager) return

        setStep('reverting')
        setProgress({ current: 0, total: changeset.revertFiles.length })

        const [_, err] = await attempt(async () => {

            const conn = await createConnection(activeConfig.connection, activeConfigName ?? '__revert__')
            const db = conn.db as Kysely<NoormDatabase>

            // Resolve identity
            const identity = resolveIdentity({
                cryptoIdentity: stateManager?.getIdentity() ?? null,
            })

            // Build context
            const context = {
                db,
                configName: activeConfigName ?? '',
                identity,
                projectRoot: process.cwd(),
                changesetsDir: activeConfig.paths.changesets,
                schemaDir: activeConfig.paths.schema,
            }

            // Execute revert
            const result = await revertChangeset(context, changeset)

            await conn.destroy()

            setResult(result)
            setStep(result.status === 'success' ? 'complete' : 'error')

            if (result.status !== 'success') {

                setError(result.error ?? 'Revert failed')
            }
        })

        if (err) {

            setError(err instanceof Error ? err.message : String(err))
            setStep('error')
        }
    }, [activeConfig, activeConfigName, changeset, stateManager])

    // Handle cancel
    const handleCancel = useCallback(() => {

        back()
    }, [back])

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return

        if (step === 'complete' || step === 'error') {

            back()
        }
    })

    // No changeset name provided
    if (!changesetName) {

        return (
            <Panel title="Revert Changeset" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No changeset name provided.</Text>
            </Panel>
        )
    }

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Revert Changeset" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration.</Text>
            </Panel>
        )
    }

    // Loading
    if (step === 'loading') {

        return (
            <Panel title="Revert Changeset" paddingX={2} paddingY={1}>
                <Spinner label="Loading changeset..." />
            </Panel>
        )
    }

    // Confirm
    if (step === 'confirm' && changeset) {

        const confirmContent = (
            <Box flexDirection="column" gap={1}>
                <Text>Revert changeset: <Text bold color="yellow">{changesetName}</Text></Text>
                <Text>On config: <Text bold>{activeConfigName}</Text></Text>
                <Text dimColor>Revert files to execute: {changeset.revertFiles.length}</Text>
            </Box>
        )

        if (isProtected) {

            return (
                <Panel title="Revert Changeset" paddingX={2} paddingY={1} borderColor="yellow">
                    <Box flexDirection="column" gap={1}>
                        {confirmContent}
                        <ProtectedConfirm
                            configName={activeConfigName ?? 'config'}
                            action="revert this changeset"
                            onConfirm={handleRevert}
                            onCancel={handleCancel}
                            isFocused={isFocused}
                        />
                    </Box>
                </Panel>
            )
        }

        return (
            <Panel title="Revert Changeset" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    {confirmContent}
                    <Confirm
                        message="Revert this changeset?"
                        onConfirm={handleRevert}
                        onCancel={handleCancel}
                        isFocused={isFocused}
                    />
                </Box>
            </Panel>
        )
    }

    // Reverting
    if (step === 'reverting') {

        const progressValue = progress.total > 0 ? progress.current / progress.total : 0

        return (
            <Panel title="Revert Changeset" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>Reverting: <Text bold color="yellow">{changesetName}</Text></Text>

                    <Box width={50}>
                        <ProgressBar value={progressValue} />
                    </Box>

                    <Text dimColor>
                        {progress.current}/{progress.total} files
                        {currentFile && ` - ${currentFile.split('/').pop()}`}
                    </Text>
                </Box>
            </Panel>
        )
    }

    // Complete
    if (step === 'complete' && result) {

        return (
            <Panel title="Revert Changeset" paddingX={2} paddingY={1} borderColor="green">
                <Box flexDirection="column" gap={1}>
                    <StatusMessage variant="success">
                        Changeset "{changesetName}" reverted successfully!
                    </StatusMessage>

                    <Text dimColor>
                        Duration: {result.durationMs}ms |
                        Files: {result.files?.length ?? 0}
                    </Text>

                    <Box marginTop={1}>
                        <Text dimColor>Press any key to continue...</Text>
                    </Box>
                </Box>
            </Panel>
        )
    }

    // Error
    return (
        <Panel title="Revert Changeset" paddingX={2} paddingY={1} borderColor="red">
            <Box flexDirection="column" gap={1}>
                <StatusMessage variant="error">
                    Failed to revert changeset: {error}
                </StatusMessage>

                {result?.files && (
                    <Box flexDirection="column">
                        <Text dimColor>Executed files:</Text>
                        {result.files.map((f, i) => (

                            <Text key={i} color={f.status === 'success' ? 'green' : 'red'}>
                                {f.status === 'success' ? '✓' : '✗'} {f.filepath.split('/').pop()}
                            </Text>
                        ))}
                    </Box>
                )}

                <Box marginTop={1}>
                    <Text dimColor>Press any key to continue...</Text>
                </Box>
            </Box>
        </Panel>
    )
}
