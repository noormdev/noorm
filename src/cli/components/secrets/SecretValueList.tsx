/**
 * SecretValueList - list secret values with status indicators.
 *
 * Used by SecretListScreen for displaying secret values.
 * Shows set/missing status and required/optional grouping.
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { SecretValueItem, SecretValueSummary } from './types.js';

import { SelectList, type SelectListItem } from '../lists/index.js';

/**
 * Props for SecretValueList.
 */
export interface SecretValueListProps {
    /** Secret items with set/required status */
    secrets: SecretValueItem[];

    /** Summary counts (if not provided, calculated from secrets) */
    summary?: SecretValueSummary;

    /** Called when user wants to add/set a secret (a key) */
    onAdd: () => void;

    /** Called when user wants to edit a secret (e key or Enter) */
    onEdit: (secretKey: string) => void;

    /** Called when user wants to delete (d key) */
    onDelete: (secretKey: string) => void;

    /** Check if a secret can be deleted (default: not required) */
    canDelete?: (secretKey: string) => boolean;

    /** Focus state from parent */
    isFocused: boolean;

    /** Called when back is pressed (Esc) */
    onBack: () => void;
}

/**
 * SecretValueList component.
 *
 * Renders a list of secret values with status indicators and CRUD shortcuts.
 *
 * @example
 * ```tsx
 * <SecretValueList
 *     secrets={allSecrets}
 *     summary={{ required: 3, missing: 1, optional: 2 }}
 *     onAdd={() => navigate('secret/set')}
 *     onEdit={(key) => navigate('secret/set', { name: key })}
 *     onDelete={(key) => navigate('secret/rm', { name: key })}
 *     canDelete={(key) => !requiredKeys.has(key)}
 *     isFocused={isFocused}
 *     onBack={back}
 * />
 * ```
 */
export function SecretValueList({
    secrets,
    summary,
    onAdd,
    onEdit,
    onDelete,
    canDelete,
    isFocused,
    onBack,
}: SecretValueListProps): ReactElement {

    const [highlightedKey, setHighlightedKey] = useState<string | null>(null);

    // Calculate summary if not provided
    const effectiveSummary = useMemo<SecretValueSummary>(() => {

        if (summary) return summary;

        const required = secrets.filter((s) => s.isRequired).length;
        const missing = secrets.filter((s) => s.isRequired && !s.isSet).length;
        const optional = secrets.filter((s) => !s.isRequired).length;

        return { required, missing, optional };

    }, [summary, secrets]);

    // Convert to list items
    const items: SelectListItem<SecretValueItem>[] = useMemo(() => {

        return secrets.map((secret) => {

            // Build label with type and status inline
            let statusText = '';

            if (secret.isRequired) {

                statusText = `(${secret.type ?? 'string'})`;

                if (!secret.isSet) {

                    statusText += ' [missing]';

                }

            }

            const label = statusText ? `${secret.key} ${statusText}` : secret.key;

            return {
                key: secret.key,
                label,
                value: secret,
                // Description shown below the key (from stage definition)
                description: secret.description,
                icon: secret.isSet ? '✓' : '✗',
            };

        });

    }, [secrets]);

    // Set/reset highlighted key when items change
    useEffect(() => {

        if (items.length === 0) {

            setHighlightedKey(null);

            return;

        }

        // Check if current highlight is still valid
        const highlightStillValid =
            highlightedKey && items.some((i) => i.value.key === highlightedKey);

        if (!highlightStillValid) {

            setHighlightedKey(items[0]?.value.key ?? null);

        }

    }, [items, highlightedKey]);

    // Handle secret selection (Enter) - edit the secret
    const handleSelect = useCallback(
        (item: SelectListItem<SecretValueItem>) => {

            onEdit(item.value.key);

        },
        [onEdit],
    );

    // Handle highlight change
    const handleHighlight = useCallback((item: SelectListItem<SecretValueItem>) => {

        setHighlightedKey(item.value.key);

    }, []);

    // Keyboard shortcuts
    useInput((input, key) => {

        if (!isFocused) return;

        // ESC to go back
        if (key.escape) {

            onBack();

            return;

        }

        // Add new secret
        if (input === 'a') {

            onAdd();

            return;

        }

        // Actions that require a highlighted secret
        if (!highlightedKey) return;

        // Delete secret
        if (input === 'd') {

            // Check if deletable
            if (canDelete && !canDelete(highlightedKey)) {

                // Required secrets can't be deleted, only cleared
                return;

            }

            onDelete(highlightedKey);

            return;

        }

        // Edit secret (same as Enter via SelectList)
        if (input === 'e') {

            onEdit(highlightedKey);

            return;

        }

    });

    return (
        <Box flexDirection="column" gap={1}>
            {/* Summary line */}
            <Box gap={2}>
                {effectiveSummary.required > 0 && (
                    <Text>
                        Required: {effectiveSummary.required - effectiveSummary.missing}/
                        {effectiveSummary.required}
                        {effectiveSummary.missing > 0 && (
                            <Text color="yellow"> ({effectiveSummary.missing} missing)</Text>
                        )}
                    </Text>
                )}
                {effectiveSummary.optional > 0 && (
                    <Text dimColor>Optional: {effectiveSummary.optional}</Text>
                )}
            </Box>

            {secrets.length === 0 ? (
                <Box flexDirection="column" gap={1}>
                    <Text dimColor>No secrets defined.</Text>
                    <Text>
                        Press <Text color="cyan">a</Text> to add a secret.
                    </Text>
                </Box>
            ) : (
                <SelectList
                    items={items}
                    onSelect={handleSelect}
                    onHighlight={handleHighlight}
                    isFocused={isFocused}
                    visibleCount={10}
                    showDescriptionBelow={true}
                />
            )}
        </Box>
    );

}

/**
 * Keyboard shortcuts help component for SecretValueList.
 */
export function SecretValueListHelp(): ReactElement {

    return (
        <Box gap={2} flexWrap="wrap">
            <Text dimColor>[a] Add</Text>
            <Text dimColor>[e] Edit</Text>
            <Text dimColor>[d] Delete</Text>
            <Text dimColor>[Enter] Edit</Text>
            <Text dimColor>[Esc] Back</Text>
        </Box>
    );

}
