import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';
import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Confirm, Panel, SelectList, useToast, type SelectListItem } from '../../components/index.js';
import { getErrorMessage } from '../../utils/index.js';

import { BUILTIN_ROLES, isBuiltinRole } from '../../../core/policy/index.js';
import { Hotkey } from '../../components/layout/Hotkey.js';

export function SettingsAccessListScreen(_props: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('SettingsAccessList');
    const { settingsManager, stateManager, refresh } = useAppContext();
    const { showToast } = useToast();
    const [highlighted, setHighlighted] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const roles = settingsManager?.getAccessRoles() ?? {};
    const names = [...BUILTIN_ROLES, ...Object.keys(roles).filter((name) => !isBuiltinRole(name)).sort()];
    const selected = highlighted && names.includes(highlighted) ? highlighted : names[0]!;
    const items: SelectListItem<string>[] = names.map((name) => {

        const role = Object.hasOwn(roles, name) ? roles[name] : undefined;
        const count = Object.keys(role?.permissions ?? {}).length;
        const source = isBuiltinRole(name) ? 'built-in' : role?.extends ? `extends ${role.extends}` : 'custom; default deny';

        return { key: name, label: name, value: name, description: `${source}; ${count} override${count === 1 ? '' : 's'}` };

    });

    const requestRemove = () => {

        if (!settingsManager) {

            showToast({ message: 'Settings manager not available', variant: 'error' });

            return;

        }
        if (!isBuiltinRole(selected)) {

            if (!stateManager) {

                showToast({ message: 'State unavailable; cannot check config assignments', variant: 'error' });

                return;

            }
            const configs = stateManager.listConfigs().filter(({ access }) => access?.user === selected || access?.agent === selected);
            const dependents = Object.entries(roles).filter(([, role]) => role.extends === selected).map(([name]) => name);
            if (configs.length || dependents.length) {

                const references = [
                    configs.length ? `configs: ${configs.map(({ name }) => name).join(', ')}` : '',
                    dependents.length ? `roles: ${dependents.join(', ')}` : '',
                ].filter(Boolean).join('; ');
                showToast({ message: `Reassign or change ${references} before removing "${selected}"`, variant: 'error' });

                return;

            }

        }
        setConfirm(selected);

    };

    useInput((input, key) => {

        if (!isFocused || confirm !== null || busy) return;
        if (key.escape) back();
        else if (input === 'a') navigate('settings/access/add');
        else if (input === 'e') navigate('settings/access/edit', { name: selected });
        else if (input === 'd') requestRemove();

    });

    const remove = async () => {

        if (confirm === null || !settingsManager || busy) return;
        setBusy(true);
        const [removed, error] = await attempt(async () => {

            // Recheck at confirmation so a newly assigned config is not orphaned.
            if (!isBuiltinRole(confirm)) {

                if (!stateManager) throw new Error('State unavailable; cannot check config assignments');
                const assigned = stateManager.listConfigs().filter(({ access }) => access?.user === confirm || access?.agent === confirm);
                if (assigned.length) throw new Error(`Reassign configs before removing: ${assigned.map(({ name }) => name).join(', ')}`);

            }
            const changed = await settingsManager.removeAccessRole(confirm);
            if (changed) await refresh();

            return changed;

        });
        setBusy(false);
        setConfirm(null);
        if (error) {

            showToast({ message: getErrorMessage(error), variant: 'error' });

            return;

        }
        if (!removed) {

            showToast({ message: `No overrides or role to remove for "${confirm}"`, variant: 'info' });

            return;

        }
        showToast({
            message: isBuiltinRole(confirm) ? `Reset "${confirm}" overrides` : `Removed role "${confirm}"`,
            variant: 'success',
        });

    };

    if (confirm !== null) {

        return (
            <Panel
                title={isBuiltinRole(confirm) ? 'Reset Role' : 'Delete Role'}
                borderColor="yellow"
                paddingX={1}
                paddingY={1}
            >
                <Confirm
                    message={isBuiltinRole(confirm) ? `Reset all overrides for "${confirm}"?` : `Delete custom role "${confirm}"?`}
                    onConfirm={remove}
                    onCancel={() => setConfirm(null)}
                    variant="warning"
                    isFocused={isFocused && !busy}
                />
            </Panel>
        );

    }

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="Access Roles" paddingX={1} paddingY={1}>
                <SelectList
                    items={items}
                    onSelect={(item) => navigate('settings/access/edit', { name: item.value })}
                    onHighlight={(item) => setHighlighted(item.value)}
                    isFocused={isFocused}
                    reserveRows={3}
                    renderItem={(item) => (
                        <Text wrap="truncate">{item.label} <Text dimColor>{item.description}</Text></Text>
                    )}
                />
            </Panel>
            <Box flexWrap="wrap" columnGap={2}>
                <Hotkey keys="a">Add</Hotkey>
                <Hotkey keys="Enter/e">Edit</Hotkey>
                <Hotkey keys="d">Delete/reset</Hotkey>
                <Hotkey keys="Esc">Back</Hotkey>
            </Box>
        </Box>
    );

}
