/**
 * SecretDefinitionList - list secret definitions with CRUD shortcuts.
 *
 * Used by both universal and stage-specific secret list screens.
 * Handles keyboard shortcuts, inline delete confirmation, and empty state.
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { StageSecret } from './types.js';

import { SelectList, type SelectListItem } from '../lists/index.js';
import { Confirm } from '../dialogs/index.js';
import { Panel } from '../layout/index.js';

/**
 * Secret list item value.
 */
interface SecretListValue {
    key: string;
    type: StageSecret['type'];
    description?: string;
    required: boolean;
}

/**
 * Props for SecretDefinitionList.
 */
export interface SecretDefinitionListProps {
    /** Secret definitions to display */
    secrets: StageSecret[];

    /** Scope label for context display (e.g., "universal", "stage: prod") */
    scopeLabel: string;

    /** Called when user wants to add a new secret (a key) */
    onAdd: () => void;

    /** Called when user wants to edit a secret (e key or Enter) */
    onEdit: (secretKey: string) => void;

    /** Called to delete a secret (d key triggers confirm, this is post-confirm) */
    onDelete: (secretKey: string) => Promise<void>;

    /** Optional extra warning for delete confirmation */
    deleteWarning?: string;

    /** Focus state from parent */
    isFocused: boolean;

    /** Called when back is pressed (Esc) */
    onBack: () => void;
}

/**
 * SecretDefinitionList component.
 *
 * Renders a list of secret definitions with keyboard shortcuts for CRUD operations.
 *
 * @example
 * ```tsx
 * <SecretDefinitionList
 *     secrets={universalSecrets}
 *     scopeLabel="universal"
 *     onAdd={() => navigate('settings/secrets/add')}
 *     onEdit={(key) => navigate('settings/secrets/edit', { name: key })}
 *     onDelete={handleDelete}
 *     deleteWarning="This will remove the secret requirement from all stages."
 *     isFocused={isFocused}
 *     onBack={back}
 * />
 * ```
 */
export function SecretDefinitionList({
    secrets,
    scopeLabel,
    onAdd,
    onEdit,
    onDelete,
    deleteWarning,
    isFocused,
    onBack,
}: SecretDefinitionListProps): ReactElement {

    const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);
    // Track optimistically deleted keys (removed from UI before data refresh arrives)
    const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set());

    // Filter out optimistically deleted secrets
    const visibleSecrets = useMemo(() => {

        if (deletedKeys.size === 0) return secrets;

        return secrets.filter((s) => !deletedKeys.has(s.key));

    }, [secrets, deletedKeys]);

    // Clear deleted keys when secrets prop changes (data refresh arrived)
    useEffect(() => {

        if (deletedKeys.size > 0) {

            setDeletedKeys(new Set());

        }

    }, [secrets]);

    // Convert to list items
    const items: SelectListItem<SecretListValue>[] = useMemo(() => {

        if (visibleSecrets.length === 0) return [];

        return visibleSecrets.map((secret) => ({
            key: secret.key,
            label: secret.key,
            value: {
                key: secret.key,
                type: secret.type,
                description: secret.description,
                required: secret.required !== false,
            },
            // Show type and required status inline
            description: `(${secret.type})${secret.required === false ? ' [optional]' : ''}`,
            icon: secret.required !== false ? '●' : '○',
        }));

    }, [visibleSecrets]);

    // Set/reset highlighted key when items change
    useEffect(() => {

        if (items.length === 0) {

            // No items - clear highlight
            setHighlightedKey(null);

            return;

        }

        // Check if current highlight is still valid
        const highlightStillValid =
            highlightedKey && items.some((i) => i.value.key === highlightedKey);

        if (!highlightStillValid) {

            // Reset to first item
            setHighlightedKey(items[0]!.value.key);

        }

    }, [items, highlightedKey]);

    // Handle secret selection (Enter) - edit secret
    const handleSelect = useCallback(
        (item: SelectListItem<SecretListValue>) => {

            // Guard against selecting deleted items
            if (deletedKeys.has(item.value.key)) return;

            onEdit(item.value.key);

        },
        [onEdit, deletedKeys],
    );

    // Handle highlight change
    const handleHighlight = useCallback((item: SelectListItem<SecretListValue>) => {

        setHighlightedKey(item.value.key);

    }, []);

    // Handle delete confirmation
    const handleConfirmDelete = useCallback(async () => {

        if (!confirmDelete) return;

        setDeleting(true);

        try {

            await onDelete(confirmDelete);

            // Optimistically remove from UI immediately
            setDeletedKeys((prev) => new Set([...prev, confirmDelete]));

            // Reset highlight if it was the deleted item
            if (highlightedKey === confirmDelete) {

                // Find next valid item to highlight
                const remaining = visibleSecrets.filter((s) => s.key !== confirmDelete);

                setHighlightedKey(remaining[0]?.key ?? null);

            }

        }
        finally {

            setDeleting(false);
            setConfirmDelete(null);

        }

    }, [confirmDelete, onDelete, highlightedKey, visibleSecrets]);

    // Handle cancel delete
    const handleCancelDelete = useCallback(() => {

        setConfirmDelete(null);

    }, []);

    // Keyboard shortcuts
    useInput((input, key) => {

        if (!isFocused || confirmDelete) return;

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

        // Actions that require a highlighted secret that isn't deleted
        if (!highlightedKey || deletedKeys.has(highlightedKey)) return;

        // Edit secret
        if (input === 'e') {

            onEdit(highlightedKey);

            return;

        }

        // Delete secret
        if (input === 'd') {

            setConfirmDelete(highlightedKey);

            return;

        }

    });

    // Show delete confirmation
    if (confirmDelete) {

        const secretDef = visibleSecrets.find((s) => s.key === confirmDelete);

        return (
            <Box flexDirection="column" gap={1}>
                <Panel
                    title="Delete Secret Definition"
                    paddingX={2}
                    paddingY={1}
                    borderColor="yellow"
                >
                    <Box flexDirection="column" gap={1}>
                        {/* Show description if available */}
                        {secretDef?.description && <Text dimColor>{secretDef.description}</Text>}

                        {deleteWarning && <Text color="yellow">Warning: {deleteWarning}</Text>}

                        <Confirm
                            message={`Delete secret definition "${confirmDelete}"?`}
                            onConfirm={handleConfirmDelete}
                            onCancel={handleCancelDelete}
                            variant="warning"
                            isFocused={isFocused && !deleting}
                        />
                    </Box>
                </Panel>
            </Box>
        );

    }

    return (
        <Box flexDirection="column" gap={1}>
            <Text dimColor>
                {scopeLabel === 'universal'
                    ? 'These secret definitions apply to all stages.'
                    : `Secret definitions for ${scopeLabel}.`}
            </Text>

            {items.length === 0 ? (
                <Box flexDirection="column" gap={1}>
                    <Text dimColor>No secrets defined.</Text>
                    <Text>
                        Press <Text color="cyan">a</Text> to add a secret definition.
                    </Text>
                </Box>
            ) : (
                <SelectList
                    items={items}
                    onSelect={handleSelect}
                    onHighlight={handleHighlight}
                    isFocused={isFocused}
                    visibleCount={8}
                    showDescriptionBelow={true}
                />
            )}
        </Box>
    );

}

/**
 * Keyboard shortcuts help component for SecretDefinitionList.
 */
export function SecretDefinitionListHelp(): ReactElement {

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
