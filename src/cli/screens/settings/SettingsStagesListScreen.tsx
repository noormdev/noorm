/**
 * SettingsStagesListScreen - list all defined stages.
 *
 * Shows stages with their descriptions. Keyboard shortcuts:
 * - Enter/e: Edit selected stage
 * - a: Add new stage
 * - d: Delete selected stage
 *
 * @example
 * ```bash
 * noorm settings stages    # List stages
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import {
    Panel,
    SelectList,
    Confirm,
    useToast,
    type SelectListItem,
} from '../../components/index.js';

/**
 * Stage list item value.
 */
interface StageListValue {
    name: string;
    description?: string;
    locked: boolean;
}

/**
 * SettingsStagesListScreen component.
 */
export function SettingsStagesListScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('SettingsStagesList');
    const { settingsManager, settings, refresh } = useAppContext();
    const { showToast } = useToast();

    const [highlightedStage, setHighlightedStage] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const [_deleting, setDeleting] = useState(false);

    // Get all stages (depend on settings to re-render after refresh)
    const stages = useMemo(() => {

        if (!settings) return {};

        return settings.stages ?? {};

    }, [settings]);

    // Convert stages to list items
    const items: SelectListItem<StageListValue>[] = useMemo(() => {

        const stageNames = Object.keys(stages);

        if (stageNames.length === 0) return [];

        return stageNames.map((name) => {

            const stage = stages[name]!;

            return {
                key: name,
                label: name,
                value: {
                    name,
                    description: stage.description,
                    locked: stage.locked ?? false,
                },
                description: stage.description ?? (stage.locked ? '[locked]' : ''),
                icon: stage.locked ? '🔒' : '○',
            };

        });

    }, [stages]);

    // Set initial highlighted stage
    useMemo(() => {

        if (items.length > 0 && !highlightedStage) {

            setHighlightedStage(items[0]!.value.name);

        }

    }, [items, highlightedStage]);

    // Handle stage selection (Enter) - edit stage
    const handleSelect = useCallback(
        (item: SelectListItem<StageListValue>) => {

            navigate('settings/stages/edit', { name: item.value.name });

        },
        [navigate],
    );

    // Handle highlight change
    const handleHighlight = useCallback((item: SelectListItem<StageListValue>) => {

        setHighlightedStage(item.value.name);

    }, []);

    // Handle delete confirmation
    const handleConfirmDelete = useCallback(async () => {

        if (!settingsManager || !confirmDelete) return;

        setDeleting(true);

        const [_, err] = await attempt(async () => {

            await settingsManager.removeStage(confirmDelete);
            await refresh();

        });

        setDeleting(false);
        setConfirmDelete(null);

        if (err) {

            showToast({
                message: err instanceof Error ? err.message : String(err),
                variant: 'error',
            });

            return;

        }

        showToast({
            message: `Stage "${confirmDelete}" deleted`,
            variant: 'success',
        });

    }, [settingsManager, confirmDelete, refresh, showToast]);

    // Handle cancel delete
    const handleCancelDelete = useCallback(() => {

        setConfirmDelete(null);

    }, []);

    // Keyboard shortcuts
    useInput((input, key) => {

        if (!isFocused || confirmDelete) return;

        // ESC to go back
        if (key.escape) {

            back();

            return;

        }

        // Add new stage
        if (input === 'a') {

            navigate('settings/stages/add');

            return;

        }

        // Actions that require a highlighted stage
        if (!highlightedStage) return;

        // Edit stage
        if (input === 'e') {

            navigate('settings/stages/edit', { name: highlightedStage });

            return;

        }

        // Delete stage
        if (input === 'd') {

            // Check if locked
            const stage = stages[highlightedStage];

            if (stage?.locked) {

                showToast({
                    message: `Cannot delete locked stage "${highlightedStage}"`,
                    variant: 'error',
                });

                return;

            }

            setConfirmDelete(highlightedStage);

            return;

        }

        // View stage secrets
        if (input === 'k') {

            navigate('settings/stages/secrets', { name: highlightedStage });

            return;

        }

    });

    // Show delete confirmation
    if (confirmDelete) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Delete Stage" paddingX={2} paddingY={1} borderColor="yellow">
                    <Confirm
                        message={`Are you sure you want to delete stage "${confirmDelete}"?`}
                        onConfirm={handleConfirmDelete}
                        onCancel={handleCancelDelete}
                        variant="warning"
                        isFocused={isFocused}
                    />
                </Panel>
            </Box>
        );

    }

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="Stages" paddingX={1} paddingY={1}>
                <Box flexDirection="column" marginBottom={1}>
                    <Text dimColor>
                        Define required stages for your project. Stages with a dialect in their defaults
                    </Text>
                    <Text dimColor>
                        are automatically created as configs in each user's local state on startup.
                    </Text>
                </Box>
                {items.length === 0 ? (
                    <Box flexDirection="column" gap={1}>
                        <Text dimColor>No stages defined.</Text>
                        <Text>
                            Press <Text color="cyan">a</Text> to add your first stage.
                        </Text>
                    </Box>
                ) : (
                    <SelectList
                        items={items}
                        onSelect={handleSelect}
                        onHighlight={handleHighlight}
                        isFocused={isFocused}
                        visibleCount={8}
                    />
                )}
            </Panel>

            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[a] Add</Text>
                <Text dimColor>[e] Edit</Text>
                <Text dimColor>[k] Secrets</Text>
                <Text dimColor>[d] Delete</Text>
                <Text dimColor>[Enter] Edit</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
