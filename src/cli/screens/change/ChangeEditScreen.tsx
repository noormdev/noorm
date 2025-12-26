/**
 * ChangeEditScreen - open changeset in system editor.
 *
 * Opens the changeset folder in the configured editor (or $EDITOR).
 *
 * @example
 * ```bash
 * noorm change:edit add-user-roles    # Open in editor
 * noorm change edit add-user-roles    # Same thing
 * ```
 */
import { useState, useEffect, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { spawn } from 'child_process'
import { join } from 'path'

import type { ReactElement } from 'react'
import type { ScreenProps } from '../../types.js'

import { attempt } from '@logosdx/utils'
import { useRouter } from '../../router.js'
import { useFocusScope } from '../../focus.js'
import { useAppContext } from '../../app-context.js'
import { Panel, Spinner, StatusMessage } from '../../components/index.js'
import { discoverChangesets } from '../../../core/changeset/parser.js'


/**
 * Edit steps.
 */
type EditStep =
    | 'loading'        // Finding changeset
    | 'opening'        // Opening editor
    | 'complete'       // Success
    | 'error'          // Error occurred


/**
 * ChangeEditScreen component.
 */
export function ChangeEditScreen({ params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter()
    const { isFocused } = useFocusScope('ChangeEdit')
    const { activeConfig, settings } = useAppContext()

    const changesetName = params.name

    const [step, setStep] = useState<EditStep>('loading')
    const [changesetPath, setChangesetPath] = useState('')
    const [error, setError] = useState<string | null>(null)

    // Find and open changeset
    useEffect(() => {

        if (!activeConfig || !changesetName) {

            setStep('loading')
            return
        }

        let cancelled = false

        const openChangeset = async () => {

            const [_, err] = await attempt(async () => {

                // Find the changeset
                const changesets = await discoverChangesets(
                    activeConfig.paths.changesets,
                    activeConfig.paths.schema,
                )

                const changeset = changesets.find(cs => cs.name === changesetName)

                if (!changeset) {

                    throw new Error(`Changeset not found: ${changesetName}`)
                }

                if (cancelled) return

                setChangesetPath(changeset.path)
                setStep('opening')

                // Get editor from environment
                const editor = process.env['EDITOR'] || process.env['VISUAL'] || 'code'

                // Open in editor
                const child = spawn(editor, [changeset.path], {
                    detached: true,
                    stdio: 'ignore',
                })

                child.unref()

                setStep('complete')
            })

            if (err) {

                if (!cancelled) {

                    setError(err instanceof Error ? err.message : String(err))
                    setStep('error')
                }
            }
        }

        openChangeset()

        return () => {

            cancelled = true
        }
    }, [activeConfig, changesetName])

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
            <Panel title="Edit Changeset" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No changeset name provided.</Text>
            </Panel>
        )
    }

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Edit Changeset" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration.</Text>
            </Panel>
        )
    }

    // Loading
    if (step === 'loading') {

        return (
            <Panel title="Edit Changeset" paddingX={2} paddingY={1}>
                <Spinner label="Finding changeset..." />
            </Panel>
        )
    }

    // Opening
    if (step === 'opening') {

        return (
            <Panel title="Edit Changeset" paddingX={2} paddingY={1}>
                <Spinner label="Opening in editor..." />
            </Panel>
        )
    }

    // Complete
    if (step === 'complete') {

        return (
            <Panel title="Edit Changeset" paddingX={2} paddingY={1} borderColor="green">
                <Box flexDirection="column" gap={1}>
                    <StatusMessage variant="success">
                        Opened "{changesetName}" in editor
                    </StatusMessage>
                    <Text dimColor>Path: {changesetPath}</Text>
                    <Box marginTop={1}>
                        <Text dimColor>Press any key to continue...</Text>
                    </Box>
                </Box>
            </Panel>
        )
    }

    // Error
    return (
        <Panel title="Edit Changeset" paddingX={2} paddingY={1} borderColor="red">
            <Box flexDirection="column" gap={1}>
                <StatusMessage variant="error">
                    {error}
                </StatusMessage>
                <Box marginTop={1}>
                    <Text dimColor>Press any key to continue...</Text>
                </Box>
            </Box>
        </Panel>
    )
}
