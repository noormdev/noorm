/**
 * Home screen - the main dashboard after initialization.
 *
 * Displays:
 * - Active config and connection status
 * - Quick actions menu
 * - Recent activity
 *
 * This is a placeholder implementation. Full implementation will be in cli/home.md.
 */
import type { ReactElement } from 'react'
import { Box, Text } from 'ink'

import type { ScreenProps } from '../types.js'
import { useRouter } from '../router.js'
import { useFocusScope } from '../focus.js'
import { useFocusedInput, useQuitHandler } from '../keyboard.js'


/**
 * Home screen component.
 *
 * Entry point for the TUI. Shows status and quick navigation.
 */
export function HomeScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate } = useRouter()
    const { isFocused } = useFocusScope('home-screen')
    const { handleQuit } = useQuitHandler()

    useFocusedInput(isFocused, (input, key) => {

        // Navigation shortcuts
        if (input === 'c') navigate('config')
        else if (input === 'h') navigate('change')
        else if (input === 'r') navigate('run')
        else if (input === 'd') navigate('db')
        else if (input === 'l') navigate('lock')
        else if (input === 's') navigate('settings')
        else if (input === 'x') navigate('secret')
        else if (input === 'i') navigate('identity')
        else if (input === 'q') handleQuit()

        // Number shortcuts for quick actions
        else if (input === '1') navigate('run/build')
        else if (input === '2') navigate('change/ff')
        else if (input === '3') navigate('lock/status')
    })

    return (
        <Box flexDirection="column" padding={1}>

            {/* Header */}
            <Box marginBottom={1}>
                <Text bold>noorm</Text>
                <Text dimColor> - Database Schema & Changeset Manager</Text>
            </Box>

            {/* Status Panel */}
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor="gray"
                paddingX={2}
                paddingY={1}
                marginBottom={1}
            >
                <Text bold>Status</Text>
                <Box marginTop={1} flexDirection="column">
                    <Text>
                        <Text dimColor>Active Config: </Text>
                        <Text color="cyan">none</Text>
                    </Text>
                    <Text>
                        <Text dimColor>Connection: </Text>
                        <Text color="gray">○</Text>
                        <Text dimColor> Not connected</Text>
                    </Text>
                    <Text>
                        <Text dimColor>Lock: </Text>
                        <Text color="green">FREE</Text>
                    </Text>
                </Box>
            </Box>

            {/* Quick Actions */}
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor="gray"
                paddingX={2}
                paddingY={1}
                marginBottom={1}
            >
                <Text bold>Quick Actions</Text>
                <Box marginTop={1} flexDirection="column">
                    <Text>
                        <Text color="cyan">[1]</Text>
                        <Text> Run Build</Text>
                    </Text>
                    <Text>
                        <Text color="cyan">[2]</Text>
                        <Text> Apply Changes (ff)</Text>
                    </Text>
                    <Text>
                        <Text color="cyan">[3]</Text>
                        <Text> View Lock Status</Text>
                    </Text>
                </Box>
            </Box>

            {/* Navigation Hints */}
            <Box marginTop={1}>
                <Text dimColor>
                    [c]onfig  [h]ange  [r]un  [d]b  [l]ock  [s]ettings  [x]secret  [i]dentity  [?]help  [q]uit
                </Text>
            </Box>

        </Box>
    )
}
