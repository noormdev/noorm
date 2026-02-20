/**
 * NotFoundPanel - shown when a looked-up item doesn't exist.
 *
 * Replaces the repeated pattern of red Panels with "X not found" messages
 * across 15+ screens.
 *
 * @example
 * ```tsx
 * if (!config) return <NotFoundPanel title="Edit Config" type="Config" name={configName} />;
 * ```
 */
import { Box, Text } from 'ink';

import type { ReactElement } from 'react';

import { Panel } from './Panel.js';


/**
 * NotFoundPanel props.
 */
export interface NotFoundPanelProps {

    /** Panel title. */
    title: string;

    /** Item type for the message (e.g., "Config", "Secret"). */
    type: string;

    /** Name of the missing item. */
    name: string;

}

/**
 * Displays a red panel indicating an item was not found.
 */
export function NotFoundPanel({ title, type, name }: NotFoundPanelProps): ReactElement {

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title={title} paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">{type} &quot;{name}&quot; not found.</Text>
            </Panel>

            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
