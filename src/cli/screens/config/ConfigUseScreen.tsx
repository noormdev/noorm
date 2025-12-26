/**
 * ConfigUseScreen - set a configuration as active.
 *
 * Quick action to switch the active database configuration.
 *
 * @example
 * ```bash
 * noorm config:use dev     # Set 'dev' as active
 * noorm config use dev     # Same thing
 * ```
 */
import { useState, useCallback, useEffect, useMemo } from 'react'
import { Box, Text, useInput } from 'ink'
import { attempt } from '@logosdx/utils'

import type { ReactElement } from 'react'
import type { ScreenProps } from '../../types.js'

import { useRouter } from '../../router.js'
import { useFocusScope } from '../../focus.js'
import { useAppContext } from '../../app-context.js'
import { Panel, Spinner, StatusMessage } from '../../components/index.js'


/**
 * Use steps.
 */
type UseStep =
    | 'switching'      // Switching config
    | 'complete'       // Success
    | 'error'          // Error occurred


/**
 * ConfigUseScreen component.
 */
export function ConfigUseScreen({ params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter()
    const { isFocused } = useFocusScope('ConfigUse')
    const { stateManager, activeConfigName, refresh } = useAppContext()

    const configName = params.name

    const [step, setStep] = useState<UseStep>('switching')
    const [error, setError] = useState<string | null>(null)

    // Get the config
    const config = useMemo(() => {

        if (!stateManager || !configName) return null
        return stateManager.getConfig(configName)
    }, [stateManager, configName])

    // Check if already active
    const isAlreadyActive = configName === activeConfigName

    // Switch config on mount
    useEffect(() => {

        if (!stateManager || !configName || !config) {

            setError('Config not found')
            setStep('error')
            return
        }

        if (isAlreadyActive) {

            setStep('complete')
            return
        }

        const switchConfig = async () => {

            const [_, err] = await attempt(async () => {

                await stateManager.setActiveConfig(configName)
                await refresh()
            })

            if (err) {

                setError(err instanceof Error ? err.message : String(err))
                setStep('error')
                return
            }

            setStep('complete')
        }

        switchConfig()
    }, [stateManager, configName, config, isAlreadyActive, refresh])

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return

        if (step === 'complete' || step === 'error') {

            back()
        }
    })

    // No config name provided
    if (!configName) {

        return (
            <Panel title="Set Active Configuration" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No config name provided. Use: noorm config:use &lt;name&gt;</Text>
            </Panel>
        )
    }

    // Config not found
    if (!config) {

        return (
            <Panel title="Set Active Configuration" paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">Config "{configName}" not found.</Text>
            </Panel>
        )
    }

    // Switching
    if (step === 'switching') {

        return (
            <Panel title={`Use: ${configName}`} paddingX={2} paddingY={1}>
                <Spinner label="Switching configuration..." />
            </Panel>
        )
    }

    // Complete
    if (step === 'complete') {

        const message = isAlreadyActive
            ? `Configuration "${configName}" is already active.`
            : `Switched to configuration "${configName}".`

        return (
            <Panel title={`Use: ${configName}`} paddingX={2} paddingY={1} borderColor="green">
                <Box flexDirection="column" gap={1}>
                    <StatusMessage variant="success">
                        {message}
                    </StatusMessage>
                    <Box marginTop={1}>
                        <Text dimColor>Press any key to continue...</Text>
                    </Box>
                </Box>
            </Panel>
        )
    }

    // Error
    return (
        <Panel title={`Use: ${configName}`} paddingX={2} paddingY={1} borderColor="red">
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
