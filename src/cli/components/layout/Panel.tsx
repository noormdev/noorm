/**
 * Panel component - bordered container with optional title.
 *
 * Provides consistent visual grouping for screen content.
 *
 * @example
 * ```tsx
 * <Panel title="Configuration">
 *     <Text>Config content here</Text>
 * </Panel>
 * ```
 */
import { Box, Text } from 'ink'

import type { ReactNode, ReactElement } from 'react'


/**
 * Props for Panel component.
 */
export interface PanelProps {

    /** Panel title displayed at top */
    title?: string

    /** Title color */
    titleColor?: string

    /** Border style */
    borderStyle?: 'single' | 'double' | 'round' | 'bold' | 'singleDouble' | 'doubleSingle' | 'classic'

    /** Border color */
    borderColor?: string

    /** Horizontal padding inside panel */
    paddingX?: number

    /** Vertical padding inside panel */
    paddingY?: number

    /** Panel width */
    width?: number | string

    /** Panel content */
    children: ReactNode
}


/**
 * Panel component.
 *
 * A bordered container with optional title for grouping content.
 */
export function Panel({
    title,
    titleColor = 'cyan',
    borderStyle = 'round',
    borderColor = 'gray',
    paddingX = 1,
    paddingY = 0,
    width,
    children,
}: PanelProps): ReactElement {

    return (
        <Box
            flexDirection="column"
            borderStyle={borderStyle}
            borderColor={borderColor}
            paddingX={paddingX}
            paddingY={paddingY}
            width={width}
        >
            {title && (
                <Box marginBottom={1}>
                    <Text bold color={titleColor}>{title}</Text>
                </Box>
            )}
            {children}
        </Box>
    )
}
