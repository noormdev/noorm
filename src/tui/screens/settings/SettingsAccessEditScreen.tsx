import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { FormField, FormValues, SelectListItem } from '../../components/index.js';
import { Form, Panel, SelectList } from '../../components/index.js';
import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { useSettingsOperation } from '../../hooks/index.js';
import { attachPolicyContext, BUILTIN_ROLES, getConfigPermission, isBuiltinRole, MATRIX, USER_ALWAYS_ALLOWED, type ConfigAccess, type Permission, type PolicyCell, type RoleDefinition } from '../../../core/policy/index.js';
const CELLS: (PolicyCell | undefined)[] = [undefined, 'allow', 'confirm', 'deny'];

export function SettingsAccessEditScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { settingsManager } = useAppContext();
    const isAdd = params.name === undefined;
    const existingName = params.name;
    const roles = settingsManager?.getAccessRoles() ?? {};
    const existing = existingName === undefined ? undefined : Object.hasOwn(roles, existingName) ? roles[existingName] : undefined;
    const exists = existingName !== undefined && (isBuiltinRole(existingName) || Object.hasOwn(roles, existingName));
    const builtin = existingName !== undefined && isBuiltinRole(existingName);
    const [name, setName] = useState(existingName ?? '');
    const [base, setBase] = useState(existing?.extends ?? '');
    const [permissions, setPermissions] = useState<RoleDefinition['permissions']>(() => ({ ...existing?.permissions }));
    const [phase, setPhase] = useState<'metadata' | 'permissions'>(isAdd ? 'metadata' : 'permissions');
    const { isFocused } = useFocusScope({ label: 'SettingsAccessEdit', skip: phase === 'metadata' });
    const [highlighted, setHighlighted] = useState<Permission>('explore');
    const { execute, busy, error } = useSettingsOperation(
        async (manager, data: { name: string; definition: RoleDefinition }) => {

            if (isAdd && (isBuiltinRole(data.name) || Object.hasOwn(manager.getAccessRoles(), data.name))) {

                throw new Error(`Role "${data.name}" already exists`);

            }
            await manager.setAccessRole(data.name, data.definition);

        },
        (data) => isAdd ? `Role "${data.name}" created` : `Role "${data.name}" updated`,
    );
    const definition: RoleDefinition = {
        ...(base ? { extends: base } : {}),
        ...(Object.keys(permissions ?? {}).length ? { permissions } : {}),
    };
    const candidates = [...BUILTIN_ROLES, ...Object.keys(roles).filter((role) => !isBuiltinRole(role)).sort()]
        .filter((role) => {

            const seen = new Set<string>();
            let current: string | undefined = role;
            while (current && !seen.has(current)) {

                if (current === name) return false;
                seen.add(current);
                current = Object.hasOwn(roles, current) ? roles[current]?.extends : undefined;

            }

            return true;

        });
    const fields: FormField[] = [];
    if (isAdd) {

        fields.push({
            key: 'name',
            label: 'Role Name',
            type: 'text',
            required: true,
            defaultValue: name,
            validate: (value) => {

                if (typeof value !== 'string' || value.length === 0) return 'Name is required';
                if (value === '__proto__') return 'This role name cannot be stored';
                if (isBuiltinRole(value) || Object.hasOwn(roles, value)) return 'Role already exists';

                return undefined;

            },
        });

    }
    if (!builtin) {

        fields.push({
            key: 'base',
            label: 'Inherits From',
            type: 'select',
            defaultValue: base,
            options: [
                { label: '(none; default deny)', value: '' },
                ...candidates.filter((role) => role !== name).map((role) => ({ label: role, value: role })),
            ],
        });

    }
    const metadata = (values: FormValues) => {

        if (isAdd) setName(String(values['name']));
        if (!builtin) setBase(String(values['base'] ?? ''));
        setPhase('permissions');

    };
    const access: ConfigAccess = { user: name, agent: name };
    attachPolicyContext(access, { roles: { ...roles, [name]: definition } });
    const target = { name: 'preview', access };
    const protectedAccess: ConfigAccess = { user: name, agent: name };
    attachPolicyContext(protectedAccess, { roles: { ...roles, [name]: definition }, protectedStage: true });
    const protectedTarget = { name: 'protected preview', access: protectedAccess };
    const effective = (permission: Permission) => USER_ALWAYS_ALLOWED.includes(permission)
        ? `agent ${getConfigPermission('agent', target, permission)}`
        : getConfigPermission('user', target, permission);
    const items: SelectListItem<Permission>[] = (Object.keys(MATRIX) as Permission[]).map((permission) => {

        const explicit = permissions?.[permission];
        const source = explicit ? `override ${explicit}` : builtin ? 'built-in default' : base ? `inherit ${base}` : 'default deny';

        return { key: permission, label: permission, value: permission, description: `${source} -> ${effective(permission)}` };

    });
    const cycle = (permission: Permission) => {

        setPermissions((previous) => {

            const next = { ...previous };
            const cell = CELLS[(CELLS.indexOf(previous?.[permission]) + 1) % CELLS.length];
            if (cell === undefined) delete next[permission];
            else next[permission] = cell;

            return next;

        });

    };
    useInput((input, key) => {

        if (!isFocused || phase !== 'permissions' || busy) return;
        if (key.escape) back();
        else if (input === 'm' && !builtin) setPhase('metadata');
        else if (input === 's') void execute({ name, definition });

    });

    if (!isAdd && !exists) {

        return (
            <Panel title="Edit Role" borderColor="red">
                <Text color="red">Role "{existingName}" not found.</Text>
            </Panel>
        );

    }
    if (phase === 'metadata') {

        return (
            <Panel title={isAdd ? 'Add Role' : `Edit Role: ${name}`} paddingX={1} paddingY={1}>
                <Form
                    fields={fields}
                    onSubmit={metadata}
                    onCancel={() => isAdd && !name ? back() : setPhase('permissions')}
                    submitLabel="Edit Permissions"
                    focusLabel="SettingsAccessMetadata"
                />
            </Panel>
        );

    }

    const selectedSource = permissions?.[highlighted]
        ? `override ${permissions[highlighted]}`
        : builtin ? 'built-in default' : base ? `inherit ${base}` : 'default deny';

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title={`Permissions: ${name}`} paddingX={1} paddingY={1}>
                <Text wrap="truncate" dimColor>
                    {highlighted}: {selectedSource}; effective {effective(highlighted)}
                </Text>
                <Text wrap="truncate" dimColor>
                    Protected: user {getConfigPermission('user', protectedTarget, highlighted)},
                    {' '}agent {getConfigPermission('agent', protectedTarget, highlighted)}
                </Text>
                {USER_ALWAYS_ALLOWED.includes(highlighted) && (
                    <Text wrap="truncate" color="yellow">The user channel always reads; this cell applies to the agent channel.</Text>
                )}
                <SelectList
                    items={items}
                    defaultValue={highlighted}
                    onSelect={(item) => cycle(item.value)}
                    onHighlight={(item) => setHighlighted(item.value)}
                    isFocused={isFocused && !busy}
                    reserveRows={5}
                    renderItem={(item) => (
                        <Text wrap="truncate">{item.label} {effective(item.value)}</Text>
                    )}
                />
            </Panel>
            {error && <Text color="red">{error}</Text>}
            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[Enter] Cycle default/allow/confirm/deny</Text>
                {!builtin && <Text dimColor>[m] Metadata</Text>}
                <Text dimColor>[s] Save</Text>
                <Text dimColor>[Esc] Cancel</Text>
            </Box>
        </Box>
    );

}
