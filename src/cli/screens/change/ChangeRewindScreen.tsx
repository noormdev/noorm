/**
 * ChangeRewindScreen - revert multiple changesets.
 *
 * Reverts changesets in reverse chronological order.
 * Can specify count or target changeset name.
 *
 * @example
 * ```bash
 * noorm change:rewind 3                    # Revert last 3 applied
 * noorm change:rewind 2025-01-15-add-users # Revert to (including) this changeset
 * noorm change rewind                      # Interactive mode
 * ```
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Box, Text, useInput } from 'ink'
import { TextInput, ProgressBar } from '@inkjs/ui'

import type { ReactElement } from 'react'
import type { ScreenProps } from '../../types.js'
import type { ChangesetListItem } from '../../../core/changeset/types.js'
import type { NoormDatabase } from '../../../core/shared/index.js'
import type { Kysely } from 'kysely'

import { attempt } from '@logosdx/utils'
import { useRouter } from '../../router.js'
import { useFocusScope } from '../../focus.js'
import { useAppContext } from '../../app-context.js'
import { Panel, Spinner, StatusMessage, Confirm, ProtectedConfirm, StatusList, type StatusListItem } from '../../components/index.js'
import { discoverChangesets } from '../../../core/changeset/parser.js'
import { ChangesetHistory } from '../../../core/changeset/history.js'
import { ChangesetManager } from '../../../core/changeset/manager.js'
import { createConnection } from '../../../core/connection/factory.js'
import { resolveIdentity } from '../../../core/identity/resolver.js'
import { observer } from '../../../core/observer.js'


/**
 * Rewind steps.
 */
type RewindStep =
    | 'loading'        // Loading applied changesets
    | 'input'          // Entering count or name
    | 'confirm'        // Awaiting confirmation
    | 'running'        // Executing
    | 'complete'       // Success
    | 'error'          // Error occurred


/**
 * ChangeRewindScreen component.
 */
export function ChangeRewindScreen({ params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter()
    const { isFocused } = useFocusScope('ChangeRewind')
    const { activeConfig, activeConfigName, stateManager } = useAppContext()

    // Pre-fill from params - can be count or changeset name
    const target = params.count ? String(params.count) : params.name ?? ''

    const [step, setStep] = useState<RewindStep>('loading')
    const [appliedChangesets, setAppliedChangesets] = useState<ChangesetListItem[]>([])
    const [changesetsToRevert, setChangesetsToRevert] = useState<ChangesetListItem[]>([])
    const [targetInput, setTargetInput] = useState(target)
    const [results, setResults] = useState<StatusListItem[]>([])
    const [currentChangeset, setCurrentChangeset] = useState('')
    const [progress, setProgress] = useState({ current: 0, total: 0 })
    const [error, setError] = useState<string | null>(null)
    const [isProtected, setIsProtected] = useState(false)

    // Load applied changesets
    useEffect(() => {

        if (!activeConfig) return

        let cancelled = false

        const loadApplied = async () => {

            const [_, err] = await attempt(async () => {

                // Discover changesets
                const changesets = await discoverChangesets(
                    activeConfig.paths.changesets,
                    activeConfig.paths.schema,
                )

                // Get statuses from database
                const conn = await createConnection(activeConfig.connection, activeConfigName ?? '__rewind__')
                const db = conn.db as Kysely<NoormDatabase>

                const history = new ChangesetHistory(db, activeConfigName ?? '')
                const statuses = await history.getAllStatuses()

                await conn.destroy()

                if (cancelled) return

                // Find applied changesets (newest first for rewind order)
                const applied: ChangesetListItem[] = changesets
                    .filter(cs => {

                        const status = statuses.get(cs.name)
                        return status?.status === 'success'
                    })
                    .map(cs => {

                        const status = statuses.get(cs.name)!
                        return {
                            name: cs.name,
                            path: cs.path,
                            date: cs.date,
                            description: cs.description,
                            status: 'success' as const,
                            appliedAt: status.appliedAt,
                            appliedBy: status.appliedBy,
                            revertedAt: null,
                            errorMessage: null,
                            isNew: false,
                            orphaned: false,
                            changeFiles: cs.changeFiles,
                            revertFiles: cs.revertFiles,
                        }
                    })
                    .sort((a, b) => {

                        // Newest first (by applied date)
                        const dateA = a.appliedAt?.getTime() ?? 0
                        const dateB = b.appliedAt?.getTime() ?? 0
                        return dateB - dateA
                    })

                setAppliedChangesets(applied)
                setIsProtected(activeConfig.protected ?? false)

                if (applied.length === 0) {

                    setError('No applied changesets to revert')
                    setStep('error')
                }
                else if (target) {

                    // Parse target and determine changesets to revert
                    const parsed = parseTarget(target, applied)

                    if (parsed.error) {

                        setError(parsed.error)
                        setStep('error')
                    }
                    else {

                        setChangesetsToRevert(parsed.changesets)
                        setStep('confirm')
                    }
                }
                else {

                    setStep('input')
                }
            })

            if (err) {

                if (!cancelled) {

                    setError(err instanceof Error ? err.message : String(err))
                    setStep('error')
                }
            }
        }

        loadApplied()

        return () => {

            cancelled = true
        }
    }, [activeConfig, activeConfigName, target])

    // Subscribe to progress events
    useEffect(() => {

        const unsubStart = observer.on('changeset:start', (data) => {

            setCurrentChangeset(data.name)
        })

        const unsubComplete = observer.on('changeset:complete', (data) => {

            setResults(prev => [...prev, {
                key: data.name,
                label: data.name,
                status: data.status === 'success' ? 'success' : 'error',
                detail: `${data.durationMs}ms`,
            }])

            setProgress(prev => ({ ...prev, current: prev.current + 1 }))
        })

        return () => {

            unsubStart()
            unsubComplete()
        }
    }, [])

    // Parse target (count or changeset name)
    const parseTarget = (input: string, applied: ChangesetListItem[]): { changesets: ChangesetListItem[]; error?: string } => {

        // Try as number
        const count = parseInt(input, 10)

        if (!isNaN(count) && count > 0) {

            if (count > applied.length) {

                return { changesets: [], error: `Only ${applied.length} applied changesets available` }
            }

            return { changesets: applied.slice(0, count) }
        }

        // Try as changeset name
        const targetIndex = applied.findIndex(cs => cs.name === input)

        if (targetIndex === -1) {

            return { changesets: [], error: `Changeset not found or not applied: ${input}` }
        }

        // Return all changesets from newest to target (inclusive)
        return { changesets: applied.slice(0, targetIndex + 1) }
    }

    // Handle target input submit
    const handleTargetSubmit = useCallback(() => {

        if (!targetInput.trim()) {

            return
        }

        const parsed = parseTarget(targetInput.trim(), appliedChangesets)

        if (parsed.error) {

            setError(parsed.error)
            setStep('error')
        }
        else {

            setChangesetsToRevert(parsed.changesets)
            setStep('confirm')
        }
    }, [targetInput, appliedChangesets])

    // Handle rewind
    const handleRewind = useCallback(async () => {

        if (!activeConfig || !stateManager || changesetsToRevert.length === 0) return

        setStep('running')
        setProgress({ current: 0, total: changesetsToRevert.length })
        setResults([])

        const [_, err] = await attempt(async () => {

            const conn = await createConnection(activeConfig.connection, activeConfigName ?? '__rewind__')
            const db = conn.db as Kysely<NoormDatabase>

            // Resolve identity
            const identity = resolveIdentity({
                cryptoIdentity: stateManager?.getIdentity() ?? null,
            })

            // Create manager and rewind
            const manager = new ChangesetManager({
                db,
                configName: activeConfigName ?? '',
                identity,
                projectRoot: process.cwd(),
                changesetsDir: activeConfig.paths.changesets,
                schemaDir: activeConfig.paths.schema,
            })

            const result = await manager.rewind(changesetsToRevert.length)

            await conn.destroy()

            if (result.failed > 0) {

                setError(`${result.failed} revert(s) failed`)
                setStep('error')
            }
            else {

                setStep('complete')
            }
        })

        if (err) {

            setError(err instanceof Error ? err.message : String(err))
            setStep('error')
        }
    }, [activeConfig, activeConfigName, stateManager, changesetsToRevert])

    // Handle cancel
    const handleCancel = useCallback(() => {

        back()
    }, [back])

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return

        if (step === 'input') {

            if (key.return) {

                handleTargetSubmit()
            }
            else if (key.escape) {

                back()
            }
        }

        if (step === 'complete' || step === 'error') {

            back()
        }
    })

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Rewind Changesets" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration.</Text>
            </Panel>
        )
    }

    // Loading
    if (step === 'loading') {

        return (
            <Panel title="Rewind Changesets" paddingX={2} paddingY={1}>
                <Spinner label="Loading applied changesets..." />
            </Panel>
        )
    }

    // Input
    if (step === 'input') {

        return (
            <Panel title="Rewind Changesets" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>Applied changesets: <Text bold>{appliedChangesets.length}</Text></Text>

                    <Box flexDirection="column" marginTop={1}>
                        <Text dimColor>Recent applied (newest first):</Text>
                        {appliedChangesets.slice(0, 5).map(cs => (

                            <Text key={cs.name} dimColor>  • {cs.name}</Text>
                        ))}
                    </Box>

                    <Box marginTop={1}>
                        <Text>Revert (count or name): </Text>
                        <TextInput
                            placeholder="1 or changeset-name"
                            defaultValue={targetInput}
                            onChange={setTargetInput}
                            isDisabled={!isFocused}
                        />
                    </Box>

                    <Box marginTop={1} gap={2}>
                        <Text dimColor>[Enter] Continue</Text>
                        <Text dimColor>[Esc] Cancel</Text>
                    </Box>
                </Box>
            </Panel>
        )
    }

    // Confirm
    if (step === 'confirm') {

        const confirmContent = (
            <Box flexDirection="column" gap={1}>
                <Text>Revert <Text bold color="yellow">{changesetsToRevert.length}</Text> changeset(s):</Text>

                <Box flexDirection="column" marginTop={1}>
                    {changesetsToRevert.slice(0, 5).map(cs => (

                        <Text key={cs.name} dimColor>  • {cs.name}</Text>
                    ))}
                    {changesetsToRevert.length > 5 && (
                        <Text dimColor>  ... and {changesetsToRevert.length - 5} more</Text>
                    )}
                </Box>

                <Text color="yellow">This will revert in reverse order (newest first).</Text>
            </Box>
        )

        if (isProtected) {

            return (
                <Panel title="Rewind Changesets" paddingX={2} paddingY={1} borderColor="yellow">
                    <Box flexDirection="column" gap={1}>
                        {confirmContent}
                        <ProtectedConfirm
                            configName={activeConfigName ?? 'config'}
                            action="revert these changesets"
                            onConfirm={handleRewind}
                            onCancel={handleCancel}
                            isFocused={isFocused}
                        />
                    </Box>
                </Panel>
            )
        }

        return (
            <Panel title="Rewind Changesets" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    {confirmContent}
                    <Confirm
                        message="Revert these changesets?"
                        onConfirm={handleRewind}
                        onCancel={handleCancel}
                        isFocused={isFocused}
                    />
                </Box>
            </Panel>
        )
    }

    // Running
    if (step === 'running') {

        const progressValue = progress.total > 0 ? progress.current / progress.total : 0

        return (
            <Panel title="Rewind Changesets" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>Reverting changesets...</Text>

                    <Box width={50}>
                        <ProgressBar value={progressValue} />
                    </Box>

                    <Text dimColor>
                        {progress.current}/{progress.total}
                        {currentChangeset && ` - ${currentChangeset}`}
                    </Text>

                    {results.length > 0 && (
                        <Box marginTop={1}>
                            <StatusList items={results} />
                        </Box>
                    )}
                </Box>
            </Panel>
        )
    }

    // Complete
    if (step === 'complete') {

        const successCount = results.filter(r => r.status === 'success').length

        return (
            <Panel title="Rewind Changesets" paddingX={2} paddingY={1} borderColor="green">
                <Box flexDirection="column" gap={1}>
                    <StatusMessage variant="success">
                        Reverted {successCount} changeset(s) successfully!
                    </StatusMessage>

                    <StatusList items={results} />

                    <Box marginTop={1}>
                        <Text dimColor>Press any key to continue...</Text>
                    </Box>
                </Box>
            </Panel>
        )
    }

    // Error
    return (
        <Panel title="Rewind Changesets" paddingX={2} paddingY={1} borderColor="red">
            <Box flexDirection="column" gap={1}>
                <StatusMessage variant="error">
                    {error}
                </StatusMessage>

                {results.length > 0 && (
                    <StatusList items={results} />
                )}

                <Box marginTop={1}>
                    <Text dimColor>Press any key to continue...</Text>
                </Box>
            </Box>
        </Panel>
    )
}
