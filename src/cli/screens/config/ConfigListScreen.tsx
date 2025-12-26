/**
 * ConfigListScreen - displays all database configurations.
 *
 * Shows a list of configs with their status (active, dialect, protected).
 * Keyboard shortcuts provide quick access to actions:
 * - Enter: Set as active config
 * - a: Add new config
 * - e: Edit selected config
 * - d: Delete selected config
 * - c: Copy selected config
 * - x: Export selected config
 * - v: Validate selected config
 *
 * @example
 * ```bash
 * noorm config           # Opens this screen
 * ```
 */
import { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'

import type { ReactElement } from 'react'
import type { ScreenProps } from '../../types.js'

import { useRouter } from '../../router.js'
import { useFocusScope } from '../../focus.js'
import { useAppContext } from '../../app-context.js'
import { Panel, SelectList, type SelectListItem } from '../../components/index.js'


/**
 * Config list item value.
 */
interface ConfigListValue {

    name: string
    dialect: string
    isActive: boolean
    protected: boolean
    isTest: boolean
}


/**
 * ConfigListScreen component.
 *
 * Displays all configurations with quick actions.
 */
export function ConfigListScreen({ params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter()
    const { isFocused } = useFocusScope('ConfigList')
    const { configs, stateManager, refresh } = useAppContext()

    // Track highlighted config for keyboard actions
    const [highlightedConfig, setHighlightedConfig] = useState<string | null>(
        configs.length > 0 ? configs[0]?.name ?? null : null
    )

    // Convert configs to list items
    const items: SelectListItem<ConfigListValue>[] = configs.map(config => ({
        key: config.name,
        label: config.name,
        value: {
            name: config.name,
            dialect: config.dialect,
            isActive: config.isActive,
            protected: config.protected,
            isTest: config.isTest,
        },
        description: `${config.dialect}${config.isActive ? ' (active)' : ''}${config.protected ? ' [protected]' : ''}${config.isTest ? ' [test]' : ''}`,
        icon: config.isActive ? '●' : '○',
    }))

    // Handle config selection (Enter) - set as active
    const handleSelect = useCallback(async (item: SelectListItem<ConfigListValue>) => {

        if (!stateManager) return

        // If already active, go to edit
        if (item.value.isActive) {

            navigate('config/edit', { name: item.value.name })
        }
        else {

            // Set as active
            await stateManager.setActiveConfig(item.value.name)
            await refresh()
        }
    }, [stateManager, navigate, refresh])

    // Handle highlight change
    const handleHighlight = useCallback((item: SelectListItem<ConfigListValue>) => {

        setHighlightedConfig(item.value.name)
    }, [])

    // Keyboard shortcuts for actions
    useInput((input, key) => {

        if (!isFocused) return

        // ESC to go back
        if (key.escape) {

            back()
            return
        }

        // Add new config
        if (input === 'a') {

            navigate('config/add')
            return
        }

        // Import config
        if (input === 'i') {

            navigate('config/import')
            return
        }

        // Actions that require a highlighted config
        if (!highlightedConfig) return

        // Edit config
        if (input === 'e') {

            navigate('config/edit', { name: highlightedConfig })
            return
        }

        // Delete config
        if (input === 'd') {

            navigate('config/rm', { name: highlightedConfig })
            return
        }

        // Copy config
        if (input === 'c') {

            navigate('config/cp', { name: highlightedConfig })
            return
        }

        // Export config
        if (input === 'x') {

            navigate('config/export', { name: highlightedConfig })
            return
        }

        // Validate config
        if (input === 'v') {

            navigate('config/validate', { name: highlightedConfig })
            return
        }
    })

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="Configurations" paddingX={1} paddingY={1}>
                {configs.length === 0 ? (
                    <Box flexDirection="column" gap={1}>
                        <Text dimColor>No configurations found.</Text>
                        <Text>Press <Text color="cyan">a</Text> to add your first config.</Text>
                    </Box>
                ) : (
                    <SelectList
                        items={items}
                        onSelect={handleSelect}
                        onHighlight={handleHighlight}
                        isFocused={isFocused}
                        visibleCount={8}
                    />
                )}
            </Panel>

            <Box gap={2} flexWrap="wrap">
                <Text dimColor>[a] Add</Text>
                <Text dimColor>[e] Edit</Text>
                <Text dimColor>[d] Delete</Text>
                <Text dimColor>[c] Copy</Text>
                <Text dimColor>[x] Export</Text>
                <Text dimColor>[i] Import</Text>
                <Text dimColor>[v] Validate</Text>
                <Text dimColor>[Enter] Use</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    )
}
