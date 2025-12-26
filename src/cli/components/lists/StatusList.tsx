/**
 * StatusList component - shows items with status indicators.
 *
 * Displays a list of items with colored status badges,
 * useful for showing file states, execution results, etc.
 *
 * @example
 * ```tsx
 * <StatusList
 *     items={[
 *         { label: 'schema/001_users.sql', status: 'success' },
 *         { label: 'schema/002_posts.sql', status: 'pending' },
 *         { label: 'schema/003_comments.sql', status: 'error', detail: 'Syntax error' },
 *     ]}
 * />
 * ```
 */
import { Box, Text } from 'ink'

import type { ReactElement } from 'react'


/**
 * Status types with their visual styling.
 */
export type StatusType = 'pending' | 'running' | 'success' | 'error' | 'warning' | 'skipped'


/**
 * Status list item.
 */
export interface StatusListItem {

    /** Unique identifier */
    key?: string

    /** Display label */
    label: string

    /** Item status */
    status: StatusType

    /** Optional detail text shown after status */
    detail?: string
}


/**
 * Props for StatusList component.
 */
export interface StatusListProps {

    /** Items to display */
    items: StatusListItem[]

    /** Show status icons */
    showIcons?: boolean

    /** Maximum items to display (scrolling) */
    maxVisible?: number
}


// Status configuration
const statusConfig: Record<StatusType, { icon: string; color: string }> = {
    pending: { icon: '○', color: 'gray' },
    running: { icon: '●', color: 'blue' },
    success: { icon: '✓', color: 'green' },
    error: { icon: '✗', color: 'red' },
    warning: { icon: '⚠', color: 'yellow' },
    skipped: { icon: '−', color: 'gray' },
}


/**
 * StatusList component.
 *
 * Displays a list of items with status indicators.
 */
export function StatusList({
    items,
    showIcons = true,
    maxVisible,
}: StatusListProps): ReactElement {

    const displayItems = maxVisible ? items.slice(-maxVisible) : items
    const hiddenCount = maxVisible ? Math.max(0, items.length - maxVisible) : 0

    return (
        <Box flexDirection="column">
            {hiddenCount > 0 && (
                <Text dimColor>... {hiddenCount} more items above</Text>
            )}
            {displayItems.map((item, index) => {

                const config = statusConfig[item.status]
                const key = item.key ?? `${item.label}-${index}`

                return (
                    <Box key={key} gap={1}>
                        {showIcons && (
                            <Text color={config.color}>{config.icon}</Text>
                        )}
                        <Text>{item.label}</Text>
                        {item.detail && (
                            <Text dimColor>({item.detail})</Text>
                        )}
                    </Box>
                )
            })}
        </Box>
    )
}
