import { Text, Box, useInput } from 'ink';
import type { Screen } from '../types.js';

interface Props {
    onNavigate: (screen: Screen) => void;
}

export function HomeScreen({ onNavigate }: Props) {
    useInput((input) => {
        if (input === 's') onNavigate('settings');
        if (input === 'a') onNavigate('about');
        if (input === 'q') process.exit(0);
    });

    return (
        <Box flexDirection="column">
            <Text bold color="green">
                Home Screen
            </Text>
            <Text>Press [s] Settings, [a] About, [q] Quit</Text>
        </Box>
    );
}
