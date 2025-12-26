/**
 * ActionList component - displays available keyboard actions.
 *
 * Shows a list of keyboard shortcuts and their descriptions,
 * typically used in footers or help panels.
 *
 * @example
 * ```tsx
 * <ActionList
 *     actions={[
 *         { key: 'a', label: 'Add config' },
 *         { key: 'e', label: 'Edit config' },
 *         { key: 'd', label: 'Delete config', variant: 'danger' },
 *     ]}
 * />
 * ```
 */
import { Box, Text } from 'ink'

import type { ReactElement } from 'react'


/**
 * Action item.
 */
export interface ActionItem {

    /** Keyboard key (e.g., 'a', 'Enter', 'Esc') */
    key: string

    /** Action description */
    label: string

    /** Visual variant */
    variant?: 'default' | 'primary' | 'danger' | 'muted'

    /** Whether action is currently disabled */
    disabled?: boolean
}


/**
 * Props for ActionList component.
 */
export interface ActionListProps {

    /** Actions to display */
    actions: ActionItem[]

    /** Layout direction */
    direction?: 'row' | 'column'

    /** Gap between items */
    gap?: number

    /** Key label color */
    keyColor?: string
}


// Color mapping for variants
const variantColors: Record<string, string> = {
    default: 'white',
    primary: 'cyan',
    danger: 'red',
    muted: 'gray',
}


/**
 * ActionList component.
 *
 * Displays keyboard shortcuts in a consistent format.
 */
export function ActionList({
    actions,
    direction = 'row',
    gap = 2,
    keyColor = 'cyan',
}: ActionListProps): ReactElement {

    const visibleActions = actions.filter(a => !a.disabled)

    return (
        <Box flexDirection={direction} gap={gap}>
            {visibleActions.map((action, index) => {

                const labelColor = variantColors[action.variant ?? 'default'] ?? 'white'

                return (
                    <Box key={index} gap={1}>
                        <Text color={keyColor}>[{action.key}]</Text>
                        <Text color={labelColor}>{action.label}</Text>
                    </Box>
                )
            })}
        </Box>
    )
}
