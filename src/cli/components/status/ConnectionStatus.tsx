/**
 * ConnectionStatus component - displays database connection state.
 *
 * Shows whether the CLI is connected to a database, including
 * the configuration name and dialect.
 *
 * @example
 * ```tsx
 * <ConnectionStatus
 *     status="connected"
 *     configName="production"
 *     dialect="postgres"
 * />
 * ```
 */
import { Box, Text } from 'ink';
import { Badge } from '@inkjs/ui';

import type { ReactElement } from 'react';

/**
 * Connection status types.
 */
export type ConnectionStatusType = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Props for ConnectionStatus component.
 */
export interface ConnectionStatusProps {
    /** Current connection status */
    status: ConnectionStatusType;

    /** Name of the connected configuration */
    configName?: string | null;

    /** Database dialect */
    dialect?: string | null;

    /** Error message if status is 'error' */
    error?: string | null;

    /** Show compact version (badge only) */
    compact?: boolean;
}

// Status configuration
const statusConfig: Record<
    ConnectionStatusType,
    { label: string; color: 'green' | 'red' | 'yellow' | 'blue' }
> = {
    disconnected: { label: 'DISCONNECTED', color: 'yellow' },
    connecting: { label: 'CONNECTING', color: 'blue' },
    connected: { label: 'CONNECTED', color: 'green' },
    error: { label: 'ERROR', color: 'red' },
};

/**
 * ConnectionStatus component.
 *
 * Displays database connection status with optional config and dialect info.
 */
export function ConnectionStatus({
    status,
    configName,
    dialect,
    error,
    compact = false,
}: ConnectionStatusProps): ReactElement {

    const config = statusConfig[status];

    if (compact) {

        return (
            <Box gap={1}>
                <Badge color={config.color}>{config.label}</Badge>
                {configName && status === 'connected' && <Text dimColor>({configName})</Text>}
            </Box>
        );

    }

    return (
        <Box flexDirection="column" gap={1}>
            <Box gap={1}>
                <Badge color={config.color}>{config.label}</Badge>
            </Box>

            {configName && status === 'connected' && (
                <Box gap={1}>
                    <Text dimColor>Config:</Text>
                    <Text>{configName}</Text>
                </Box>
            )}

            {dialect && status === 'connected' && (
                <Box gap={1}>
                    <Text dimColor>Dialect:</Text>
                    <Text>{dialect}</Text>
                </Box>
            )}

            {error && status === 'error' && (
                <Box gap={1}>
                    <Text dimColor>Error:</Text>
                    <Text color="red">{error}</Text>
                </Box>
            )}
        </Box>
    );

}
