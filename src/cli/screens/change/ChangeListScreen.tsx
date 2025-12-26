/**
 * ChangeListScreen - view all changesets with status.
 *
 * Shows changesets from disk merged with database execution status.
 * Displays applied/pending/reverted/failed status for each.
 *
 * @example
 * ```bash
 * noorm change          # View changesets
 * noorm change list     # Same thing
 * ```
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'

import type { ReactElement } from 'react'
import type { ScreenProps } from '../../types.js'
import type { ChangesetListItem } from '../../../core/changeset/types.js'
import type { NoormDatabase } from '../../../core/shared/index.js'
import type { Kysely } from 'kysely'

import { attempt } from '@logosdx/utils'
import { useRouter } from '../../router.js'
import { useFocusScope } from '../../focus.js'
import { useAppContext } from '../../app-context.js'
import { Panel, Spinner, SelectList, type SelectListItem } from '../../components/index.js'
import { discoverChangesets } from '../../../core/changeset/parser.js'
import { ChangesetHistory } from '../../../core/changeset/history.js'
import { createConnection } from '../../../core/connection/factory.js'


/**
 * Format relative time for display.
 */
function formatRelativeTime(date: Date): string {

    const now = Date.now()
    const diff = now - date.getTime()

    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    if (minutes > 0) return `${minutes}m ago`
    return 'just now'
}


/**
 * Get status indicator for a changeset.
 */
function getStatusIndicator(item: ChangesetListItem): { symbol: string; color: string } {

    if (item.orphaned) {

        return { symbol: '!', color: 'yellow' }
    }

    switch (item.status) {

        case 'success':
            return { symbol: '✓', color: 'green' }

        case 'failed':
            return { symbol: '✗', color: 'red' }

        case 'reverted':
            return { symbol: '↩', color: 'yellow' }

        case 'pending':
        default:
            return { symbol: '○', color: 'gray' }
    }
}


/**
 * ChangeListScreen component.
 */
export function ChangeListScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter()
    const { isFocused } = useFocusScope('ChangeList')
    const { activeConfig, activeConfigName, loadingStatus } = useAppContext()

    const [changesets, setChangesets] = useState<ChangesetListItem[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [selectedIndex, setSelectedIndex] = useState(0)

    // Load changesets
    useEffect(() => {

        if (!activeConfig || loadingStatus !== 'ready') {

            setIsLoading(false)
            return
        }

        let cancelled = false

        const loadChangesets = async () => {

            setIsLoading(true)
            setError(null)

            const [_, err] = await attempt(async () => {

                // Discover changesets from disk
                const diskChangesets = await discoverChangesets(
                    activeConfig.paths.changesets,
                    activeConfig.paths.schema,
                )

                // Get statuses from database
                const conn = await createConnection(activeConfig.connection, activeConfigName ?? '__list__')
                const db = conn.db as Kysely<NoormDatabase>

                const history = new ChangesetHistory(db, activeConfigName ?? '')
                const statuses = await history.getAllStatuses()

                await conn.destroy()

                if (cancelled) return

                // Merge disk and database info
                const merged: ChangesetListItem[] = []

                // Add disk changesets with their status
                for (const cs of diskChangesets) {

                    const dbStatus = statuses.get(cs.name)

                    merged.push({
                        name: cs.name,
                        path: cs.path,
                        date: cs.date,
                        description: cs.description,
                        changeFiles: cs.changeFiles,
                        revertFiles: cs.revertFiles,
                        hasChangelog: cs.hasChangelog,
                        status: dbStatus?.status ?? 'pending',
                        appliedAt: dbStatus?.appliedAt ?? null,
                        appliedBy: dbStatus?.appliedBy ?? null,
                        revertedAt: dbStatus?.revertedAt ?? null,
                        errorMessage: dbStatus?.errorMessage ?? null,
                        isNew: !dbStatus,
                        orphaned: false,
                    })
                }

                // Add orphaned changesets (in DB but not on disk)
                const diskNames = new Set(diskChangesets.map(cs => cs.name))
                for (const [name, status] of statuses) {

                    if (!diskNames.has(name)) {

                        merged.push({
                            name,
                            path: '',
                            date: null,
                            description: name,
                            status: status.status,
                            appliedAt: status.appliedAt,
                            appliedBy: status.appliedBy,
                            revertedAt: status.revertedAt,
                            errorMessage: status.errorMessage,
                            isNew: false,
                            orphaned: true,
                        })
                    }
                }

                // Sort by date (newest first) with pending at top
                merged.sort((a, b) => {

                    // Pending first
                    if (a.status === 'pending' && b.status !== 'pending') return -1
                    if (b.status === 'pending' && a.status !== 'pending') return 1

                    // Then by date
                    const dateA = a.date?.getTime() ?? 0
                    const dateB = b.date?.getTime() ?? 0
                    return dateB - dateA
                })

                setChangesets(merged)
            })

            if (err) {

                if (!cancelled) {

                    setError(err instanceof Error ? err.message : String(err))
                }
            }

            setIsLoading(false)
        }

        loadChangesets()

        return () => {

            cancelled = true
        }
    }, [activeConfig, activeConfigName, loadingStatus])

    // Get selected changeset
    const selectedChangeset = useMemo(() => {

        return changesets[selectedIndex]
    }, [changesets, selectedIndex])

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return

        // Navigation
        if (key.upArrow) {

            setSelectedIndex(prev => Math.max(0, prev - 1))
            return
        }

        if (key.downArrow) {

            setSelectedIndex(prev => Math.min(changesets.length - 1, prev + 1))
            return
        }

        if (key.escape) {

            back()
            return
        }

        // Actions
        if (input === 'a') {

            navigate('change/add')
            return
        }

        if (input === 'e' && selectedChangeset && !selectedChangeset.orphaned) {

            navigate('change/edit', { name: selectedChangeset.name })
            return
        }

        if (input === 'd' && selectedChangeset) {

            navigate('change/rm', { name: selectedChangeset.name })
            return
        }

        if (input === 'r' && selectedChangeset && selectedChangeset.status === 'pending') {

            navigate('change/run', { name: selectedChangeset.name })
            return
        }

        if (input === 'v' && selectedChangeset && selectedChangeset.status === 'success') {

            navigate('change/revert', { name: selectedChangeset.name })
            return
        }

        if (input === 'n') {

            navigate('change/next')
            return
        }

        if (input === 'f') {

            navigate('change/ff')
            return
        }

        if (input === 'w') {

            navigate('change/rewind')
            return
        }

        // Enter - smart action based on status
        if (key.return && selectedChangeset) {

            if (selectedChangeset.status === 'pending') {

                navigate('change/run', { name: selectedChangeset.name })
            }
            else if (selectedChangeset.status === 'success') {

                navigate('change/revert', { name: selectedChangeset.name })
            }
        }
    })

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Changesets" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration. Press 'c' to manage configs.</Text>
            </Panel>
        )
    }

    // Loading
    if (isLoading) {

        return (
            <Panel title="Changesets" paddingX={2} paddingY={1}>
                <Spinner label="Loading changesets..." />
            </Panel>
        )
    }

    // Error
    if (error) {

        return (
            <Panel title="Changesets" paddingX={2} paddingY={1} borderColor="red">
                <Box flexDirection="column" gap={1}>
                    <Text color="red">Failed to load changesets: {error}</Text>
                    <Text dimColor>Press Esc to go back</Text>
                </Box>
            </Panel>
        )
    }

    // Statistics
    const applied = changesets.filter(cs => cs.status === 'success').length
    const pending = changesets.filter(cs => cs.status === 'pending').length
    const failed = changesets.filter(cs => cs.status === 'failed').length
    const orphaned = changesets.filter(cs => cs.orphaned).length

    return (
        <Panel title="Changesets" paddingX={2} paddingY={1}>
            <Box flexDirection="column" gap={1}>
                {/* Statistics */}
                <Box gap={2}>
                    <Text>Total: <Text bold>{changesets.length}</Text></Text>
                    <Text>Applied: <Text color="green">{applied}</Text></Text>
                    <Text>Pending: <Text color="yellow">{pending}</Text></Text>
                    {failed > 0 && <Text>Failed: <Text color="red">{failed}</Text></Text>}
                    {orphaned > 0 && <Text>Orphaned: <Text color="yellow">{orphaned}</Text></Text>}
                </Box>

                {/* Changeset List */}
                {changesets.length === 0 ? (
                    <Box marginTop={1}>
                        <Text dimColor>No changesets found. Press [a] to create one.</Text>
                    </Box>
                ) : (
                    <Box flexDirection="column" marginTop={1}>
                        {changesets.map((cs, index) => {

                            const isSelected = index === selectedIndex
                            const indicator = getStatusIndicator(cs)

                            return (
                                <Box key={cs.name}>
                                    <Text color={isSelected ? 'cyan' : undefined}>
                                        {isSelected ? '>' : ' '}
                                    </Text>
                                    <Text color={indicator.color}> {indicator.symbol} </Text>
                                    <Text
                                        color={isSelected ? 'cyan' : cs.orphaned ? 'yellow' : undefined}
                                        bold={isSelected}
                                    >
                                        {cs.name}
                                    </Text>
                                    <Text dimColor>
                                        {cs.status === 'success' && cs.appliedAt && (
                                            <>  {formatRelativeTime(cs.appliedAt)}</>
                                        )}
                                        {cs.status === 'pending' && '  pending'}
                                        {cs.status === 'reverted' && '  reverted'}
                                        {cs.status === 'failed' && '  failed'}
                                        {cs.orphaned && '  (orphaned)'}
                                    </Text>
                                </Box>
                            )
                        })}
                    </Box>
                )}

                {/* Selected changeset details */}
                {selectedChangeset && (
                    <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
                        <Text bold>{selectedChangeset.name}</Text>
                        <Box gap={2}>
                            <Text dimColor>Change files: {selectedChangeset.changeFiles?.length ?? 0}</Text>
                            <Text dimColor>Revert files: {selectedChangeset.revertFiles?.length ?? 0}</Text>
                        </Box>
                        {selectedChangeset.appliedBy && (
                            <Text dimColor>Applied by: {selectedChangeset.appliedBy}</Text>
                        )}
                    </Box>
                )}

                {/* Keyboard hints */}
                <Box marginTop={1} gap={2}>
                    <Text dimColor>[a]dd</Text>
                    <Text dimColor>[e]dit</Text>
                    <Text dimColor>[d]elete</Text>
                    <Text dimColor>[r]un</Text>
                    <Text dimColor>re[v]ert</Text>
                    <Text dimColor>[n]ext</Text>
                    <Text dimColor>[f]f</Text>
                    <Text dimColor>re[w]ind</Text>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        </Panel>
    )
}
