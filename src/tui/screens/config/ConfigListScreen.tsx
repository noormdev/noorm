/**
 * ConfigListScreen - displays all database configurations.
 *
 * Shows a list of configs with their status (active, dialect, access roles).
 * Keyboard shortcuts provide quick access to actions:
 * - Enter: Set as active config
 * - a: Add new config
 * - e: Edit selected config
 * - d: Delete selected config
 * - c: Copy selected config
 * - k: Secrets for selected config
 * - +: More actions (export, import, validate)
 *
 * @example
 * ```bash
 * noorm config           # Opens this screen
 * ```
 */
import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { attemptSync } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, SelectList, useToast, type SelectListItem } from '../../components/index.js';
import { syncIdentityWithConfig } from '../../../core/identity/index.js';
import { formatAccessTag } from '../../../core/policy/index.js';
import { SettingsProvider, effectiveConfig } from '../../../core/config/resolver.js';
import type { ConfigAccess } from '../../../core/policy/index.js';
import type { ConnectionConfig } from '../../../core/connection/types.js';
import { skipsVerification } from '../../utils/index.js';

/**
 * Config list item value.
 */
interface ConfigListValue {
    name: string;
    dialect: string;
    isActive: boolean;
    access: ConfigAccess;
    isTest: boolean;
}

function tlsTag(connection: ConnectionConfig): string | null {

    const { ssl } = connection;

    if (connection.dialect === 'sqlite' || !ssl) return null;

    return skipsVerification(ssl) ? 'tls unverified' : 'tls';

}

/**
 * ConfigListScreen component.
 *
 * Displays all configurations with quick actions.
 */
export function ConfigListScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ConfigList');
    const { configs, stateManager, settingsManager, refresh } = useAppContext();
    const { showToast } = useToast();

    // Track highlighted config for keyboard actions
    const [highlightedConfig, setHighlightedConfig] = useState<string | null>(
        configs.length > 0 ? (configs[0]?.name ?? null) : null,
    );

    // A stored config that cannot be built into an effective one (an unknown role, for one) still gets its row, without the tag.
    const effectiveTlsTag = (name: string): string | null => {

        if (!stateManager || !settingsManager) return null;

        const [effective] = attemptSync(() => {

            const stored = stateManager.getConfig(name);

            return stored && effectiveConfig(stored, new SettingsProvider(settingsManager));

        });

        return effective ? tlsTag(effective.connection) : null;

    };

    // Convert configs to list items
    const items: SelectListItem<ConfigListValue>[] = configs.map((config) => {

        const accessTag = formatAccessTag(config);
        const tls = effectiveTlsTag(config.name);

        return {
            key: config.name,
            label: config.name,
            value: {
                name: config.name,
                dialect: config.dialect,
                isActive: config.isActive,
                access: config.access,
                isTest: config.isTest,
            },
            description: `${config.dialect}${config.isActive ? ' (active)' : ''}${accessTag ? ` [${accessTag}]` : ''}${config.isTest ? ' [test]' : ''}${tls ? ` [${tls}]` : ''}`,
            icon: config.isActive ? '●' : '○',
        };

    });

    // Handle config selection (Enter) - set as active
    const handleSelect = useCallback(
        async (item: SelectListItem<ConfigListValue>) => {

            if (!stateManager) return;

            if (item.value.isActive) {

                navigate('config/edit', { name: item.value.name });

                return;

            }

            const selected = stateManager.getConfig(item.value.name);
            if (!selected || !settingsManager) return;
            const [bound, policyErr] = attemptSync(() => effectiveConfig(selected, new SettingsProvider(settingsManager)));
            if (policyErr) {

                showToast({ message: policyErr.message, variant: 'error' });

                return;

            }

            await stateManager.setActiveConfig(item.value.name);

            const syncResult = await syncIdentityWithConfig(bound, 'user');

            if (syncResult.ok && syncResult.knownUsers?.length) {

                await stateManager.addKnownUsers(syncResult.knownUsers);

            }

            await refresh();

        },
        [stateManager, settingsManager, navigate, refresh, showToast],
    );

    // Handle highlight change
    const handleHighlight = useCallback((item: SelectListItem<ConfigListValue>) => {

        setHighlightedConfig(item.value.name);

    }, []);

    // Keyboard shortcuts for actions
    useInput((input, key) => {

        if (!isFocused) return;

        // ESC to go back
        if (key.escape) {

            back();

            return;

        }

        // Add new config
        if (input === 'a') {

            navigate('config/add');

            return;

        }

        // More actions
        if (input === '+') {

            navigate('config/more', highlightedConfig ? { name: highlightedConfig } : undefined);

            return;

        }

        // Actions that require a highlighted config
        if (!highlightedConfig) return;

        // Edit config
        if (input === 'e') {

            navigate('config/edit', { name: highlightedConfig });

            return;

        }

        // Delete config
        if (input === 'd') {

            navigate('config/rm', { name: highlightedConfig });

            return;

        }

        // Copy config
        if (input === 'c') {

            navigate('config/cp', { name: highlightedConfig });

            return;

        }

        // Secrets for config
        if (input === 'k') {

            navigate('secret', { name: highlightedConfig });

            return;

        }

    });

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="Configurations" paddingX={1} paddingY={1}>
                {configs.length === 0 ? (
                    <Box flexDirection="column" gap={1}>
                        <Text dimColor>No configurations found.</Text>
                        <Text>
                            Press <Text color="cyan">a</Text> to add your first config.
                        </Text>
                    </Box>
                ) : (
                    <SelectList
                        items={items}
                        onSelect={handleSelect}
                        onHighlight={handleHighlight}
                        isFocused={isFocused}
                    />
                )}
            </Panel>

            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[a] Add</Text>
                <Text dimColor>[e] Edit</Text>
                <Text dimColor>[d] Delete</Text>
                <Text dimColor>[c] Copy</Text>
                <Text dimColor>[k] Secrets</Text>
                <Text dimColor>[+] More</Text>
                <Text dimColor>[Enter] Use</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
