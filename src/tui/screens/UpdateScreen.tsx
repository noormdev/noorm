/**
 * Self-update screen for the TUI.
 *
 * Checks for updates and allows the user to install them.
 * Downloads the platform-appropriate binary from GitHub releases.
 */
import { useState, useCallback } from 'react';
import type { ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ScreenProps } from '../types.js';
import { useFocusScope } from '../focus.js';
import { useRouter } from '../router.js';
import { useToast, Spinner } from '../components/index.js';
import { useUpdateChecker } from '../hooks/index.js';

/**
 * Update screen showing current version, update availability, and install action.
 */
export function UpdateScreen(_props: ScreenProps): ReactElement {

    const { isFocused } = useFocusScope('UpdateScreen');
    const { back } = useRouter();
    const { showToast } = useToast();
    const {
        updateInfo,
        checking,
        installing,
        performUpdate,
        recheckForUpdate,
    } = useUpdateChecker();

    const [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleInstall = useCallback(async (): Promise<void> => {

        const result = await performUpdate();

        if (!result) return;

        if (result.success) {

            setDone(true);
            showToast({
                message: `Updated to ${result.newVersion}. Restart noorm to apply.`,
                variant: 'success',
                duration: 8000,
            });

        }
        else {

            setError(result.error ?? 'Unknown error');

        }

    }, [performUpdate, showToast]);

    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

            return;

        }

        // [i] to install update
        if (input === 'i' && updateInfo?.updateAvailable && !installing && !done) {

            handleInstall();

            return;

        }

        // [r] to recheck
        if (input === 'r' && !checking && !installing) {

            recheckForUpdate();

            return;

        }

    });

    // Checking state
    if (checking) {

        return (
            <Box flexDirection="column" paddingX={2} paddingY={1}>
                <Box>
                    <Spinner label="Checking for updates..." />
                </Box>
            </Box>
        );

    }

    // Installing state
    if (installing) {

        return (
            <Box flexDirection="column" paddingX={2} paddingY={1}>
                <Box>
                    <Spinner label={`Installing ${updateInfo?.latestVersion}...`} />
                </Box>
            </Box>
        );

    }

    // Done state
    if (done) {

        return (
            <Box flexDirection="column" paddingX={2} paddingY={1}>
                <Text color="green" bold>Update complete!</Text>
                <Text dimColor>Restart noorm to use the new version.</Text>
                <Box marginTop={1}>
                    <Text dimColor>[esc] back</Text>
                </Box>
            </Box>
        );

    }

    // Error state
    if (error) {

        return (
            <Box flexDirection="column" paddingX={2} paddingY={1}>
                <Text color="red" bold>Update failed</Text>
                <Text>{error}</Text>
                <Box marginTop={1}>
                    <Text dimColor>[r] retry  [esc] back</Text>
                </Box>
            </Box>
        );

    }

    // No update info (offline or error)
    if (!updateInfo) {

        return (
            <Box flexDirection="column" paddingX={2} paddingY={1}>
                <Text dimColor>Could not check for updates. You may be offline.</Text>
                <Box marginTop={1}>
                    <Text dimColor>[r] retry  [esc] back</Text>
                </Box>
            </Box>
        );

    }

    // Up to date
    if (!updateInfo.updateAvailable) {

        return (
            <Box flexDirection="column" paddingX={2} paddingY={1}>
                <Text>Current version: <Text bold>{updateInfo.currentVersion}</Text></Text>
                <Text color="green">Already up to date.</Text>
                <Box marginTop={1}>
                    <Text dimColor>[r] check again  [esc] back</Text>
                </Box>
            </Box>
        );

    }

    // Update available
    return (
        <Box flexDirection="column" paddingX={2} paddingY={1}>
            <Text>Current version: <Text bold>{updateInfo.currentVersion}</Text></Text>
            <Text>Latest version:  <Text bold color="green">{updateInfo.latestVersion}</Text></Text>
            {updateInfo.isMajorUpdate && (
                <Text color="yellow">This is a major version update.</Text>
            )}
            <Box marginTop={1}>
                <Text dimColor>[i] install  [esc] back</Text>
            </Box>
        </Box>
    );

}
