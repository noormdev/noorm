/**
 * Divider component - horizontal separator with optional label.
 *
 * Used to visually separate content sections within a screen.
 *
 * @example
 * ```tsx
 * <Divider />
 * <Divider label="Actions" />
 * <Divider label="Options" color="cyan" />
 * ```
 */
import { Box, Text } from 'ink'

import type { ReactElement } from 'react'


/**
 * Props for Divider component.
 */
export interface DividerProps {

    /** Optional label centered in the divider */
    label?: string

    /** Divider line color */
    color?: string

    /** Label color (defaults to divider color) */
    labelColor?: string

    /** Character used for the divider line */
    char?: string

    /** Width of the divider (defaults to fill available space) */
    width?: number
}


/**
 * Divider component.
 *
 * A horizontal line separator with optional centered label.
 */
export function Divider({
    label,
    color = 'gray',
    labelColor,
    char = '─',
    width = 40,
}: DividerProps): ReactElement {

    if (!label) {

        return (
            <Box>
                <Text color={color}>{char.repeat(width)}</Text>
            </Box>
        )
    }

    // Calculate line lengths for label centering
    const labelWithPadding = ` ${label} `
    const remainingWidth = Math.max(0, width - labelWithPadding.length)
    const leftWidth = Math.floor(remainingWidth / 2)
    const rightWidth = remainingWidth - leftWidth

    return (
        <Box>
            <Text color={color}>{char.repeat(leftWidth)}</Text>
            <Text color={labelColor ?? color} bold>{labelWithPadding}</Text>
            <Text color={color}>{char.repeat(rightWidth)}</Text>
        </Box>
    )
}
