/**
 * LockStatus component - displays lock state with holder and expiry info.
 *
 * Shows the current lock status for a configuration, including
 * who holds the lock and when it expires.
 *
 * @example
 * ```tsx
 * <LockStatus
 *     status="locked"
 *     holder="alice@example.com"
 *     since={lockSince}
 *     expires={lockExpires}
 * />
 * ```
 */
import { Box, Text } from 'ink';
import { Badge } from '@inkjs/ui';

import type { ReactElement } from 'react';

/**
 * Lock status types.
 */
export type LockStatusType = 'free' | 'locked' | 'blocked' | 'expired';

/**
 * Props for LockStatus component.
 */
export interface LockStatusProps {
    /** Current lock status */
    status: LockStatusType;

    /** Identity holding the lock */
    holder?: string | null;

    /** When the lock was acquired */
    since?: Date | null;

    /** When the lock expires */
    expires?: Date | null;

    /** Show compact version (badge only) */
    compact?: boolean;
}

// Status configuration
const statusConfig: Record<
    LockStatusType,
    { label: string; color: 'green' | 'red' | 'yellow' | 'blue' }
> = {
    free: { label: 'UNLOCKED', color: 'green' },
    locked: { label: 'LOCKED', color: 'red' },
    blocked: { label: 'BLOCKED', color: 'yellow' },
    expired: { label: 'EXPIRED', color: 'yellow' },
};

/**
 * Format relative time (e.g., "5m ago", "in 30m").
 */
function formatRelative(date: Date): string {

    const now = Date.now();
    const diff = date.getTime() - now;
    const absDiff = Math.abs(diff);

    const minutes = Math.floor(absDiff / 60000);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {

        const label = `${hours}h ${minutes % 60}m`;

        return diff > 0 ? `in ${label}` : `${label} ago`;

    }

    const label = `${minutes}m`;

    return diff > 0 ? `in ${label}` : `${label} ago`;

}

/**
 * LockStatus component.
 *
 * Displays lock status with optional holder and timing information.
 */
export function LockStatus({
    status,
    holder,
    since,
    expires,
    compact = false,
}: LockStatusProps): ReactElement {

    const config = statusConfig[status];

    if (compact) {

        return <Badge color={config.color}>{config.label}</Badge>;

    }

    return (
        <Box flexDirection="column" gap={1}>
            <Box gap={1}>
                <Badge color={config.color}>{config.label}</Badge>
            </Box>

            {holder && status !== 'free' && (
                <Box gap={1}>
                    <Text dimColor>Holder:</Text>
                    <Text>{holder}</Text>
                </Box>
            )}

            {since && status !== 'free' && (
                <Box gap={1}>
                    <Text dimColor>Since:</Text>
                    <Text>{formatRelative(since)}</Text>
                </Box>
            )}

            {expires && status === 'locked' && (
                <Box gap={1}>
                    <Text dimColor>Expires:</Text>
                    <Text>{formatRelative(expires)}</Text>
                </Box>
            )}
        </Box>
    );

}
