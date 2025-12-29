/**
 * Not Found screen - shown when a route is not registered.
 *
 * Provides a friendly error message and navigation back to home.
 */
import type { ReactElement } from 'react';
import { Box, Text } from 'ink';

import type { ScreenProps } from '../types.js';
import { useRouter } from '../router.js';
import { useFocusScope } from '../focus.js';
import { useFocusedInput } from '../keyboard.js';

/**
 * Not Found screen component.
 *
 * Rendered when the router navigates to an unregistered route.
 */
export function NotFoundScreen({ params: _params }: ScreenProps): ReactElement {

    const { route, navigate, back, canGoBack } = useRouter();
    const { isFocused } = useFocusScope('not-found-screen');

    useFocusedInput(isFocused, (input, key) => {

        if (key.return || input === 'h') {

            navigate('home');

        }
        else if (key.escape && canGoBack) {

            back();

        }

    });

    return (
        <Box flexDirection="column" padding={1}>
            {/* Error Message */}
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor="red"
                paddingX={2}
                paddingY={1}
            >
                <Text bold color="red">
                    Screen Not Found
                </Text>

                <Box marginTop={1} flexDirection="column">
                    <Text>
                        <Text dimColor>Route: </Text>
                        <Text color="yellow">{route}</Text>
                    </Text>

                    <Box marginTop={1}>
                        <Text dimColor>This screen has not been implemented yet.</Text>
                    </Box>
                </Box>
            </Box>

            {/* Navigation Hints */}
            <Box marginTop={1}>
                <Text dimColor>[Enter] go home {canGoBack ? '[Esc] go back' : ''}</Text>
            </Box>
        </Box>
    );

}
