/**
 * SettingsRulesListScreen - list all defined rules.
 *
 * Shows rules with their match conditions. Keyboard shortcuts:
 * - Enter/e: Edit selected rule
 * - a: Add new rule
 * - d: Delete selected rule
 *
 * @example
 * ```bash
 * noorm settings rules    # List rules
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';
import v from 'voca';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { Rule } from '../../../core/settings/types.js';

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
 * Rule list item value.
 */
interface RuleListValue {
    index: number;
    rule: Rule;
}

/**
 * Format rule match conditions for display.
 */
function formatMatch(match: Rule['match']): string {

    const parts: string[] = [];

    if (match.name !== undefined) parts.push(`name=${match.name}`);
    if (match.type !== undefined) parts.push(`type=${match.type}`);
    if (match.isTest !== undefined) parts.push(`isTest=${match.isTest}`);
    if (match.protected !== undefined) parts.push(`protected=${match.protected}`);

    return parts.length > 0 ? parts.join(', ') : '(no conditions)';

}

/**
 * Format rule effect for display.
 */
function formatEffect(rule: Rule): string {

    const parts: string[] = [];

    if (rule.include && rule.include.length > 0) {

        parts.push(`+${rule.include.length} include`);

    }

    if (rule.exclude && rule.exclude.length > 0) {

        parts.push(`-${rule.exclude.length} exclude`);

    }

    return parts.length > 0 ? parts.join(', ') : '(no effect)';

}

/**
 * SettingsRulesListScreen component.
 */
export function SettingsRulesListScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('SettingsRulesList');
    const { settingsManager, settings, refresh } = useAppContext();
    const { showToast } = useToast();

    const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
    const [_deleting, setDeleting] = useState(false);

    // Get all rules (depend on settings to re-render after refresh)
    const rules = useMemo(() => {

        if (!settings) return [];

        return settings.rules ?? [];

    }, [settings]);

    // Convert rules to list items
    const items: SelectListItem<RuleListValue>[] = useMemo(() => {

        return rules.map((rule, index) => ({
            key: rule.description ? v.kebabCase(rule.description) : String(index),
            label: rule.description || `Rule ${index + 1}`,
            value: { index, rule },
            description: `${formatMatch(rule.match)} → ${formatEffect(rule)}`,
        }));

    }, [rules]);

    // Set initial highlighted index
    useMemo(() => {

        if (items.length > 0 && highlightedIndex === null) {

            setHighlightedIndex(0);

        }

    }, [items, highlightedIndex]);

    // Handle rule selection (Enter) - edit rule
    const handleSelect = useCallback(
        (item: SelectListItem<RuleListValue>) => {

            navigate('settings/rules/edit', { name: String(item.value.index) });

        },
        [navigate],
    );

    // Handle highlight change
    const handleHighlight = useCallback((item: SelectListItem<RuleListValue>) => {

        setHighlightedIndex(item.value.index);

    }, []);

    // Handle delete confirmation
    const handleConfirmDelete = useCallback(async () => {

        if (!settingsManager || confirmDelete === null) return;

        setDeleting(true);

        const [_, err] = await attempt(async () => {

            await settingsManager.removeRule(confirmDelete);
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
            message: `Rule ${confirmDelete + 1} deleted`,
            variant: 'success',
        });

        // Adjust highlighted index if needed
        if (highlightedIndex !== null && highlightedIndex >= rules.length - 1) {

            setHighlightedIndex(Math.max(0, rules.length - 2));

        }

    }, [settingsManager, confirmDelete, rules.length, highlightedIndex, refresh, showToast]);

    // Handle cancel delete
    const handleCancelDelete = useCallback(() => {

        setConfirmDelete(null);

    }, []);

    // Keyboard shortcuts
    useInput((input, key) => {

        if (!isFocused || confirmDelete !== null) return;

        // ESC to go back
        if (key.escape) {

            back();

            return;

        }

        // Add new rule
        if (input === 'a') {

            navigate('settings/rules/add');

            return;

        }

        // Actions that require a highlighted rule
        if (highlightedIndex === null) return;

        // Edit rule
        if (input === 'e') {

            navigate('settings/rules/edit', { name: String(highlightedIndex) });

            return;

        }

        // Delete rule
        if (input === 'd') {

            setConfirmDelete(highlightedIndex);

            return;

        }

    });

    // Show delete confirmation
    if (confirmDelete !== null) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Delete Rule" paddingX={2} paddingY={1} borderColor="yellow">
                    <Confirm
                        message={`Are you sure you want to delete Rule ${confirmDelete + 1}?`}
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
            <Panel title="Rules" paddingX={1} paddingY={1}>
                {items.length === 0 ? (
                    <Box flexDirection="column" gap={1}>
                        <Text dimColor>No rules defined.</Text>
                        <Text>
                            Press <Text color="cyan">a</Text> to add your first rule.
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
                <Text dimColor>[d] Delete</Text>
                <Text dimColor>[Enter] Edit</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
