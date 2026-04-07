/**
 * ConfigMoreScreen - additional config actions.
 *
 * Shows less common actions:
 * - Export config
 * - Import config
 * - Validate config
 *
 * @example
 * ```bash
 * noorm config more    # Opens this screen
 * ```
 */
import { useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, SelectList, type SelectListItem } from '../../components/index.js';

/**
 * More action item.
 */
interface MoreAction {
    key: string;
    route: string;
    requiresConfig: boolean;
}

const ACTIONS: MoreAction[] = [
    { key: 'export', route: 'config/export', requiresConfig: true },
    { key: 'import', route: 'config/import', requiresConfig: false },
    { key: 'validate', route: 'config/validate', requiresConfig: true },
];

/**
 * ConfigMoreScreen component.
 */
export function ConfigMoreScreen({ params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ConfigMore');
    const { activeConfigName } = useAppContext();

    // Config name from params or active config
    const configName = params.name ?? activeConfigName;

    // Build list items
    const items: SelectListItem<MoreAction>[] = ACTIONS.map((action) => {

        const needsConfig = action.requiresConfig && !configName;

        return {
            key: action.key,
            label: action.key.charAt(0).toUpperCase() + action.key.slice(1),
            value: action,
            description: needsConfig ? 'Requires a config' : undefined,
            disabled: needsConfig,
        };

    });

    // Handle select
    const handleSelect = useCallback(
        (item: SelectListItem<MoreAction>) => {

            if (item.value.requiresConfig && configName) {

                navigate(item.value.route as never, { name: configName });

            }
            else if (!item.value.requiresConfig) {

                navigate(item.value.route as never);

            }

        },
        [navigate, configName],
    );

    // Keyboard shortcuts
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

            return;

        }

        // Quick shortcuts
        if (input === 'x' && configName) {

            navigate('config/export', { name: configName });

        }
        else if (input === 'i') {

            navigate('config/import');

        }
        else if (input === 'v' && configName) {

            navigate('config/validate', { name: configName });

        }

    });

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="More Actions" paddingX={1} paddingY={1}>
                <Box flexDirection="column" gap={1}>
                    {configName && (
                        <Text dimColor>Config: {configName}</Text>
                    )}

                    <SelectList
                        items={items}
                        onSelect={handleSelect}
                        isFocused={isFocused}
                    />
                </Box>
            </Panel>

            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[x] Export</Text>
                <Text dimColor>[i] Import</Text>
                <Text dimColor>[v] Validate</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
