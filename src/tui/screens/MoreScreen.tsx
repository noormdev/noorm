/**
 * MoreScreen - secondary navigation options.
 *
 * Shows less frequently used options that don't fit on the main home screen.
 */
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../types.js';

import { useRouter } from '../router.js';
import { useFocusScope } from '../focus.js';
import { Panel } from '../components/index.js';
import { Hotkey, KeyTarget } from '../components/layout/Hotkey.js';

/**
 * MoreScreen component.
 */
export function MoreScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('More');

    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

            return;

        }

        // Navigation shortcuts
        if (input === 's') navigate('settings');
        else if (input === 'v') navigate('vault');
        else if (input === 'i') navigate('identity');
        else if (input === 'l') navigate('lock');

    });

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="More Options" paddingX={2} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <KeyTarget keys="s" block>
                        <Box gap={2}>
                            <Text color="cyan">[s]</Text>
                            <Text>Settings</Text>
                            <Text dimColor>- Edit .noorm/settings.yml</Text>
                        </Box>
                    </KeyTarget>
                    <KeyTarget keys="v" block>
                        <Box gap={2}>
                            <Text color="cyan">[v]</Text>
                            <Text>Vault</Text>
                            <Text dimColor>- Team-shared encrypted secrets</Text>
                        </Box>
                    </KeyTarget>
                    <KeyTarget keys="i" block>
                        <Box gap={2}>
                            <Text color="cyan">[i]</Text>
                            <Text>Identity</Text>
                            <Text dimColor>- Your cryptographic identity</Text>
                        </Box>
                    </KeyTarget>
                    <KeyTarget keys="l" block>
                        <Box gap={2}>
                            <Text color="cyan">[l]</Text>
                            <Text>Lock</Text>
                            <Text dimColor>- Concurrent operation locks</Text>
                        </Box>
                    </KeyTarget>
                </Box>
            </Panel>

            <Box flexWrap="wrap" columnGap={2}>
                <Hotkey keys="s">Settings</Hotkey>
                <Hotkey keys="v">Vault</Hotkey>
                <Hotkey keys="i">Identity</Hotkey>
                <Hotkey keys="l">Lock</Hotkey>
                <Hotkey keys="Esc">Back</Hotkey>
            </Box>
        </Box>
    );

}
