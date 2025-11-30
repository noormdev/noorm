import { Text, Box, useInput } from 'ink';
import type { Screen } from '../types.js';

interface Props {
    onNavigate: (screen: Screen) => void;
}

export function SettingsScreen({ onNavigate }: Props) {
    useInput((input) => {
        if (input === 'b') onNavigate('home');
    });

    return (
        <Box flexDirection="column">
            <Text bold color="yellow">
                Settings Screen
            </Text>
            <Text>Press [b] to go back</Text>
        </Box>
    );
}
