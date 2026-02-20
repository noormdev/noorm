/**
 * MissingParamPanel - shown when a required route parameter is missing.
 *
 * Replaces the repeated pattern of yellow Panels with "No X provided" messages
 * across 17+ screens.
 *
 * @example
 * ```tsx
 * if (!configName) return <MissingParamPanel title="Edit Config" param="config name" usage="noorm config:edit <name>" />;
 * ```
 */
import { Box, Text } from 'ink';

import type { ReactElement } from 'react';

import { Panel } from './Panel.js';


/**
 * MissingParamPanel props.
 */
export interface MissingParamPanelProps {

    /** Panel title. */
    title: string;

    /** Name of the missing parameter for the message. */
    param: string;

    /** Optional usage hint (e.g., "noorm config:edit <name>"). */
    usage?: string;

}

/**
 * Displays a yellow panel indicating a required parameter is missing.
 */
export function MissingParamPanel({ title, param, usage }: MissingParamPanelProps): ReactElement {

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title={title} paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">
                    No {param} provided.{usage ? ` Use: ${usage}` : ''}
                </Text>
            </Panel>

            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
