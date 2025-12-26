/**
 * ConfigRemoveScreen - delete a database configuration.
 *
 * Requires confirmation before deletion.
 * Protected configs require typed confirmation.
 * Cannot delete the active configuration.
 *
 * @example
 * ```bash
 * noorm config:rm dev      # Delete 'dev' config
 * noorm config rm dev      # Same thing
 * ```
 */
import { useState, useCallback, useMemo } from 'react'
import { Box, Text } from 'ink'
import { attempt } from '@logosdx/utils'

import type { ReactElement } from 'react'
import type { ScreenProps } from '../../types.js'

import { useRouter } from '../../router.js'
import { useFocusScope } from '../../focus.js'
import { useAppContext } from '../../app-context.js'
import { Panel, Confirm, ProtectedConfirm, Spinner, useToast } from '../../components/index.js'


/**
 * ConfigRemoveScreen component.
 */
export function ConfigRemoveScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter()
    const { isFocused } = useFocusScope('ConfigRemove')
    const { stateManager, activeConfigName, refresh } = useAppContext()
    const { showToast } = useToast()

    const configName = params.name

    const [deleting, setDeleting] = useState(false)

    // Get the config
    const config = useMemo(() => {

        if (!stateManager || !configName) return null
        return stateManager.getConfig(configName)
    }, [stateManager, configName])

    // Check if this is the active config
    const isActive = configName === activeConfigName

    // Handle confirm
    const handleConfirm = useCallback(async () => {

        if (!stateManager || !configName) {

            showToast({ message: 'Config not found', variant: 'error' })
            back()
            return
        }

        setDeleting(true)

        const [_, err] = await attempt(async () => {

            await stateManager.deleteConfig(configName)
            await refresh()
        })

        if (err) {

            showToast({
                message: err instanceof Error ? err.message : String(err),
                variant: 'error',
            })
            setDeleting(false)
            return
        }

        // Success - show toast and go back (pops history)
        showToast({
            message: `Configuration "${configName}" deleted`,
            variant: 'success',
        })
        back()
    }, [stateManager, configName, refresh, showToast, back])

    // Handle cancel
    const handleCancel = useCallback(() => {

        back()
    }, [back])

    // No config name provided
    if (!configName) {

        return (
            <Panel title="Delete Configuration" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No config name provided. Use: noorm config:rm &lt;name&gt;</Text>
            </Panel>
        )
    }

    // Config not found
    if (!config) {

        return (
            <Panel title="Delete Configuration" paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">Config "{configName}" not found.</Text>
            </Panel>
        )
    }

    // Cannot delete active config
    if (isActive) {

        return (
            <Panel title="Delete Configuration" paddingX={2} paddingY={1} borderColor="yellow">
                <Box flexDirection="column" gap={1}>
                    <Text color="yellow">
                        Cannot delete the active configuration.
                    </Text>
                    <Text>
                        Switch to a different config first with: noorm config:use &lt;name&gt;
                    </Text>
                    <Box marginTop={1}>
                        <Text dimColor>[Esc] Go back</Text>
                    </Box>
                </Box>
            </Panel>
        )
    }

    // Deleting
    if (deleting) {

        return (
            <Panel title={`Delete: ${configName}`} paddingX={2} paddingY={1}>
                <Spinner label="Deleting configuration..." />
            </Panel>
        )
    }

    // Confirmation step - use ProtectedConfirm for protected configs
    if (config.protected) {

        return (
            <ProtectedConfirm
                configName={configName}
                action="delete"
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                isFocused={isFocused}
            />
        )
    }

    // Regular confirmation
    return (
        <Panel title={`Delete: ${configName}`} paddingX={2} paddingY={1} borderColor="yellow">
            <Confirm
                message={`Are you sure you want to delete configuration "${configName}"?`}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                variant="warning"
                isFocused={isFocused}
            />
        </Panel>
    )
}
