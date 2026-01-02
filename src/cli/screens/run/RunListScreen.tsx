/**
 * RunListScreen - run operations overview.
 *
 * Entry point for SQL execution showing:
 * - Active configuration status
 * - Effective build paths from settings
 * - Available run actions
 *
 * Keyboard shortcuts:
 * - b/1: Navigate to build screen
 * - e/2: Navigate to exec screen (file picker)
 * - f/3: Navigate to file screen
 * - d/4: Navigate to dir screen
 * - Esc: Go back
 *
 * @example
 * ```bash
 * noorm run           # Opens this screen
 * ```
 */
import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useActiveConfig, useSettings, useGlobalModes } from '../../app-context.js';
import { Panel, Spinner } from '../../components/index.js';
import { getEffectiveBuildPaths } from '../../../core/settings/rules.js';

/**
 * RunListScreen component.
 *
 * Shows run options and available operations.
 */
export function RunListScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('RunList');
    const { activeConfig, activeConfigName } = useActiveConfig();
    const { settings } = useSettings();
    const globalModes = useGlobalModes();

    const [effectivePaths, setEffectivePaths] = useState<{
        include: string[];
        exclude: string[];
    } | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Load effective paths
    useEffect(() => {

        if (!settings || !activeConfig) {

            setIsLoading(false);

            return;

        }

        // Get effective build paths based on config and rules
        const buildInclude = settings.build?.include ?? ['schema'];
        const buildExclude = settings.build?.exclude ?? [];
        const rules = settings.rules ?? [];

        // Create config for rule matching
        const configForMatch = {
            name: activeConfigName ?? '',
            protected: activeConfig.protected ?? false,
            isTest: activeConfig.isTest ?? false,
            type: activeConfig.type,
        };

        const paths = getEffectiveBuildPaths(buildInclude, buildExclude, rules, configForMatch);
        setEffectivePaths(paths);
        setIsLoading(false);

    }, [settings, activeConfig, activeConfigName]);

    // Keyboard shortcuts
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

            return;

        }

        // Only allow actions if we have an active config
        if (!activeConfig) return;

        if (input === 'b' || input === '1') {

            navigate('run/build');

            return;

        }

        if (input === 'e' || input === '2') {

            navigate('run/exec');

            return;

        }

        if (input === 'f' || input === '3') {

            navigate('run/file');

            return;

        }

        if (input === 'd' || input === '4') {

            navigate('run/dir');

            return;

        }

    });

    // No active config
    if (!activeConfig) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Run SQL Files" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="yellow">No active configuration selected.</Text>
                        <Text dimColor>Select a configuration first using the config screen.</Text>
                    </Box>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Loading state
    if (isLoading) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Run SQL Files" paddingX={1} paddingY={1}>
                    <Spinner label="Loading settings..." />
                </Panel>
            </Box>
        );

    }

    const schemaPath = settings?.paths?.schema ?? 'schema';

    return (
        <Box flexDirection="column" gap={1}>
            {/* Global mode warnings */}
            {(globalModes.dryRun || globalModes.force) && (
                <Box flexDirection="column">
                    {globalModes.dryRun && (
                        <Text color="yellow" bold>
                            DRY RUN MODE - Files will render to tmp/ without executing
                        </Text>
                    )}
                    {globalModes.force && (
                        <Text color="red" bold>
                            FORCE MODE - All files will run regardless of checksum
                        </Text>
                    )}
                </Box>
            )}

            <Panel title="Run SQL Files" paddingX={1} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Box gap={2}>
                        <Text>Config:</Text>
                        <Text bold color="cyan">
                            {activeConfigName}
                        </Text>
                        <Text dimColor>({activeConfig.type})</Text>
                    </Box>

                    <Box gap={2}>
                        <Text>Schema Path:</Text>
                        <Text dimColor>{schemaPath}</Text>
                    </Box>

                    {effectivePaths && (
                        <Box flexDirection="column" marginTop={1}>
                            <Text bold>Effective Build Paths:</Text>
                            <Box flexDirection="column" marginLeft={2}>
                                <Text>
                                    <Text color="green">Include: </Text>
                                    <Text dimColor>
                                        {effectivePaths.include.length > 0
                                            ? effectivePaths.include.join(', ')
                                            : '(none)'}
                                    </Text>
                                </Text>
                                {effectivePaths.exclude.length > 0 && (
                                    <Text>
                                        <Text color="red">Exclude: </Text>
                                        <Text dimColor>{effectivePaths.exclude.join(', ')}</Text>
                                    </Text>
                                )}
                            </Box>
                        </Box>
                    )}
                </Box>
            </Panel>

            <Panel title="Available Actions" paddingX={1} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    <Text>
                        <Text color="cyan">[b]</Text> Build - Execute full schema build
                    </Text>
                    <Text>
                        <Text color="cyan">[e]</Text> Exec - Pick files to execute
                    </Text>
                    <Text>
                        <Text color="cyan">[f]</Text> File - Execute a single file
                    </Text>
                    <Text>
                        <Text color="cyan">[d]</Text> Dir - Execute all files in a directory
                    </Text>
                </Box>
            </Panel>

            <Box gap={2}>
                <Text dimColor>[b] Build</Text>
                <Text dimColor>[e] Exec</Text>
                <Text dimColor>[f] File</Text>
                <Text dimColor>[d] Dir</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
