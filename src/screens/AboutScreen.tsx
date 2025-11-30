import { Text, Box, useInput } from 'ink';
import type { Screen } from '../types.js';

interface Props {
    onNavigate: (screen: Screen) => void;
}

export function AboutScreen({ onNavigate }: Props) {
    useInput((input) => {
        if (input === 'b') onNavigate('home');
    });

    return (
        <Box flexDirection="column">
            <Text bold color="cyan">
                About Screen
            </Text>
            <Text>Ink CLI App v1.0</Text>
            <Text>Press [b] to go back</Text>
        </Box>
    );
}
