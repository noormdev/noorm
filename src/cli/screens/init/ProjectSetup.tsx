/**
 * Project Setup screen.
 *
 * Shows project initialization options:
 * - Displays paths that will be created
 * - Option to add first database config
 */
import { useCallback } from 'react';
import type { ReactElement } from 'react';
import { Box, Text } from 'ink';

import { Panel } from '../../components/layout/index.js';
import { SelectList } from '../../components/lists/index.js';
import type { SelectListItem } from '../../components/lists/index.js';

/**
 * Props for ProjectSetup.
 */
export interface ProjectSetupProps {
    /** SQL path (for display) */
    sqlPath?: string;

    /** Changes path (for display) */
    changesPath?: string;

    /** Called when user chooses to add config */
    onAddConfig: () => void;

    /** Called when user chooses to skip config */
    onSkipConfig: () => void;

    /** Called when user cancels */
    onCancel: () => void;
}

/**
 * Project setup component.
 *
 * Shows what will be created and offers to add first config.
 */
export function ProjectSetup({
    sqlPath = './sql',
    changesPath = './changes',
    onAddConfig,
    onSkipConfig,
    onCancel: _onCancel,
}: ProjectSetupProps): ReactElement {

    // Note: No useFocusScope here - let the SelectList manage its own focus.
    // Parent focus scopes interfere with child focus due to React effect order.

    // Options for config setup
    const configOptions = [
        {
            key: 'add',
            label: 'Yes, set up my first config',
            value: 'add',
            icon: '✓',
        },
        {
            key: 'skip',
            label: "No, I'll do it later",
            value: 'skip',
            icon: '→',
        },
    ];

    // Handle selection
    const handleSelect = useCallback(
        (item: SelectListItem<string>) => {

            if (item.key === 'add') {

                onAddConfig();

            }
            else {

                onSkipConfig();

            }

        },
        [onAddConfig, onSkipConfig],
    );

    return (
        <Box flexDirection="column">
            <Panel title="Initialize noorm" titleColor="cyan">
                {/* Description */}
                <Box flexDirection="column" marginBottom={1}>
                    <Text>This will create the noorm directory structure in your project.</Text>
                </Box>

                {/* Paths to be created */}
                <Box flexDirection="column" marginBottom={1}>
                    <Text bold>Paths:</Text>
                    <Box flexDirection="column" marginLeft={2} marginTop={1}>
                        <Text>
                            <Text dimColor>SQL: </Text>
                            <Text color="cyan">{sqlPath}</Text>
                        </Text>
                        <Text>
                            <Text dimColor>Changes: </Text>
                            <Text color="cyan">{changesPath}</Text>
                        </Text>
                    </Box>
                </Box>

                {/* What will be created */}
                <Box flexDirection="column" marginBottom={1}>
                    <Text bold>Will create:</Text>
                    <Box flexDirection="column" marginLeft={2} marginTop={1}>
                        <Text dimColor>
                            <Text>• </Text>
                            <Text>{sqlPath}/.gitkeep</Text>
                        </Text>
                        <Text dimColor>
                            <Text>• </Text>
                            <Text>{changesPath}/.gitkeep</Text>
                        </Text>
                        <Text dimColor>
                            <Text>• </Text>
                            <Text>.noorm/settings.yml</Text>
                        </Text>
                        <Text dimColor>
                            <Text>• </Text>
                            <Text>.noorm/state.enc</Text>
                        </Text>
                    </Box>
                </Box>
            </Panel>

            {/* Config question */}
            <Box marginTop={1} flexDirection="column">
                <Text bold>Would you like to add a database configuration now?</Text>
                <Box marginTop={1}>
                    <SelectList
                        items={configOptions}
                        onSelect={handleSelect}
                        focusLabel="project-setup-select"
                    />
                </Box>
            </Box>

            {/* Keyboard hints */}
            <Box marginTop={1}>
                <Text dimColor>[↑↓] navigate [Enter] select [Esc] cancel</Text>
            </Box>
        </Box>
    );

}
