# CLI Config Screens


## Overview

Config screens manage database configurations:

- **List** - View all configs, select active
- **Add** - Create new configuration
- **Edit** - Modify existing configuration
- **Remove** - Delete configuration
- **Copy** - Clone configuration
- **Use** - Set active configuration


## File Structure

```
src/cli/screens/config/
├── index.tsx              # Re-exports
├── list.tsx               # Config list screen
├── add.tsx                # Add config screen
├── edit.tsx               # Edit config screen
├── rm.tsx                 # Remove config screen
├── cp.tsx                 # Copy config screen
└── use.tsx                # Set active config screen
```


## Config List Screen

```typescript
// src/cli/screens/config/list.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter } from '../../router';
import { useScreenInput } from '../../keyboard';
import {
    Footer,
    SelectList,
    SelectListItem,
    Badge,
    Spinner,
    Alert
} from '../../components';
import { getStateManager } from '../../../core/state';
import { Config, ConfigSummary } from '../../../core/config/types';
import { attempt } from '@logosdx/utils';

interface ConfigListState {
    loading: boolean;
    configs: ConfigSummary[];
    selectedIndex: number;
    error: string | null;
}

export function ConfigListScreen() {

    const { navigate } = useRouter();
    const [state, setState] = useState<ConfigListState>({
        loading: true,
        configs: [],
        selectedIndex: 0,
        error: null,
    });

    useEffect(() => {

        loadConfigs();
    }, []);

    async function loadConfigs() {

        const [manager, err] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (err) {

            setState(prev => ({
                ...prev,
                loading: false,
                error: err.message,
            }));
            return;
        }

        const configs = manager!.listConfigs();

        setState({
            loading: false,
            configs,
            selectedIndex: 0,
            error: null,
        });
    }

    // Keyboard shortcuts
    useScreenInput({
        'a': () => navigate('config/add'),
        'e': () => {

            const selected = state.configs[state.selectedIndex];
            if (selected) {

                navigate('config/edit', { name: selected.name });
            }
        },
        'd': () => {

            const selected = state.configs[state.selectedIndex];
            if (selected) {

                navigate('config/rm', { name: selected.name });
            }
        },
        'c': () => {

            const selected = state.configs[state.selectedIndex];
            if (selected) {

                navigate('config/cp', { name: selected.name });
            }
        },
        'enter': () => {

            const selected = state.configs[state.selectedIndex];
            if (selected) {

                navigate('config/use', { name: selected.name });
            }
        },
    }, [state.configs, state.selectedIndex, navigate]);

    if (state.loading) {

        return <Spinner label="Loading configurations..." />;
    }

    if (state.error) {

        return (
            <Alert type="error" title="Error" message={state.error} />
        );
    }

    const items: SelectListItem<ConfigSummary>[] = state.configs.map(cfg => ({
        key: cfg.name,
        label: cfg.name,
        value: cfg,
        icon: cfg.isActive ? '\u2713' : (cfg.protected ? '\ud83d\udd12' : undefined),
        description: [
            cfg.isActive ? 'active' : null,
            cfg.protected ? 'protected' : null,
            cfg.type,
        ].filter(Boolean).join(', '),
    }));

    return (
        <Box flexDirection="column">

            <Text bold>Configurations</Text>

            <Box marginTop={1}>
                {items.length === 0 ? (
                    <Box flexDirection="column">
                        <Text color="gray">No configurations found.</Text>
                        <Text color="gray" marginTop={1}>
                            Press <Text color="yellow">a</Text> to add your first configuration.
                        </Text>
                    </Box>
                ) : (
                    <SelectList
                        items={items}
                        onSelect={(item) => navigate('config/use', { name: item.value.name })}
                        onHighlight={(item) => {

                            const idx = state.configs.findIndex(c => c.name === item.value.name);
                            setState(prev => ({ ...prev, selectedIndex: idx }));
                        }}
                    />
                )}
            </Box>

            <Footer
                actions={[
                    { key: 'a', label: 'add' },
                    { key: 'e', label: 'edit' },
                    { key: 'd', label: 'delete' },
                    { key: 'c', label: 'copy' },
                    { key: 'enter', label: 'use' },
                ]}
            />

        </Box>
    );
}

export default ConfigListScreen;
```


## Add Config Screen

```typescript
// src/cli/screens/config/add.tsx

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter } from '../../router';
import { useScreenInput } from '../../keyboard';
import {
    Footer,
    TextInput,
    PasswordInput,
    SelectInput,
    Checkbox,
    Alert,
    Spinner
} from '../../components';
import { getStateManager } from '../../../core/state';
import { testConnection } from '../../../core/connection';
import { Dialect } from '../../../core/connection/types';
import { attempt } from '@logosdx/utils';
import { observer } from '../../../core/observer';

type Step = 'name' | 'dialect' | 'host' | 'port' | 'database' | 'user' | 'password' | 'paths' | 'options' | 'test' | 'save';

interface FormData {
    name: string;
    dialect: Dialect;
    host: string;
    port: string;
    database: string;
    user: string;
    password: string;
    schemaPath: string;
    changesetsPath: string;
    protected: boolean;
    isTest: boolean;
}

const INITIAL_DATA: FormData = {
    name: '',
    dialect: 'postgres',
    host: 'localhost',
    port: '5432',
    database: '',
    user: '',
    password: '',
    schemaPath: './schema',
    changesetsPath: './changesets',
    protected: false,
    isTest: false,
};

const DIALECT_OPTIONS = [
    { label: 'PostgreSQL', value: 'postgres' as Dialect },
    { label: 'MySQL', value: 'mysql' as Dialect },
    { label: 'SQLite', value: 'sqlite' as Dialect },
    { label: 'SQL Server', value: 'mssql' as Dialect },
];

const DEFAULT_PORTS: Record<Dialect, string> = {
    postgres: '5432',
    mysql: '3306',
    sqlite: '',
    mssql: '1433',
};

export function ConfigAddScreen() {

    const { navigate, back } = useRouter();
    const [step, setStep] = useState<Step>('name');
    const [data, setData] = useState<FormData>(INITIAL_DATA);
    const [error, setError] = useState<string | null>(null);
    const [testing, setTesting] = useState(false);
    const [saving, setSaving] = useState(false);

    // Handle escape to go back
    useScreenInput({
        // Escape handled by global keyboard
    }, []);

    function updateData(field: keyof FormData, value: any) {

        setData(prev => ({ ...prev, [field]: value }));
        setError(null);
    }

    function nextStep() {

        const steps: Step[] = ['name', 'dialect', 'host', 'port', 'database', 'user', 'password', 'paths', 'options', 'test'];
        const currentIndex = steps.indexOf(step);

        // Skip host/port for SQLite
        if (data.dialect === 'sqlite' && step === 'dialect') {

            setStep('database');
            return;
        }

        if (currentIndex < steps.length - 1) {

            setStep(steps[currentIndex + 1]);
        }
    }

    function prevStep() {

        const steps: Step[] = ['name', 'dialect', 'host', 'port', 'database', 'user', 'password', 'paths', 'options', 'test'];
        const currentIndex = steps.indexOf(step);

        // Skip host/port for SQLite going back
        if (data.dialect === 'sqlite' && step === 'database') {

            setStep('dialect');
            return;
        }

        if (currentIndex > 0) {

            setStep(steps[currentIndex - 1]);
        }
        else {

            back();
        }
    }

    async function testConnectionConfig() {

        setTesting(true);
        setError(null);

        const config = buildConnectionConfig();

        const result = await testConnection(config);

        setTesting(false);

        if (!result.ok) {

            setError(`Connection failed: ${result.error}`);
            return;
        }

        setStep('save');
    }

    async function saveConfig() {

        setSaving(true);

        const [manager, loadErr] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (loadErr) {

            setError(loadErr.message);
            setSaving(false);
            return;
        }

        // Check if name exists
        if (manager!.getConfig(data.name)) {

            setError(`Config "${data.name}" already exists`);
            setSaving(false);
            return;
        }

        const config = {
            name: data.name,
            type: data.dialect === 'sqlite' ? 'local' as const : 'remote' as const,
            isTest: data.isTest,
            protected: data.protected,
            connection: buildConnectionConfig(),
            paths: {
                schema: data.schemaPath,
                changesets: data.changesetsPath,
            },
        };

        const [, saveErr] = await attempt(() => manager!.setConfig(data.name, config));

        if (saveErr) {

            setError(saveErr.message);
            setSaving(false);
            return;
        }

        observer.emit('config:created', { name: data.name });

        navigate('config');
    }

    function buildConnectionConfig() {

        if (data.dialect === 'sqlite') {

            return {
                dialect: data.dialect,
                database: data.database,
                filename: data.database,
            };
        }

        return {
            dialect: data.dialect,
            host: data.host,
            port: parseInt(data.port, 10),
            database: data.database,
            user: data.user,
            password: data.password,
        };
    }

    // Render current step
    function renderStep() {

        switch (step) {

            case 'name':
                return (
                    <TextInput
                        label="Configuration name"
                        value={data.name}
                        onChange={(v) => updateData('name', v)}
                        onSubmit={() => {

                            if (!data.name.trim()) {

                                setError('Name is required');
                                return;
                            }
                            nextStep();
                        }}
                        placeholder="e.g., dev, staging, production"
                    />
                );

            case 'dialect':
                return (
                    <SelectInput
                        label="Database dialect"
                        options={DIALECT_OPTIONS}
                        onSelect={(opt) => {

                            updateData('dialect', opt.value);
                            updateData('port', DEFAULT_PORTS[opt.value]);
                            nextStep();
                        }}
                    />
                );

            case 'host':
                return (
                    <TextInput
                        label="Host"
                        value={data.host}
                        onChange={(v) => updateData('host', v)}
                        onSubmit={nextStep}
                        placeholder="localhost"
                    />
                );

            case 'port':
                return (
                    <TextInput
                        label="Port"
                        value={data.port}
                        onChange={(v) => updateData('port', v)}
                        onSubmit={nextStep}
                        placeholder={DEFAULT_PORTS[data.dialect]}
                    />
                );

            case 'database':
                return (
                    <TextInput
                        label={data.dialect === 'sqlite' ? 'Database file path' : 'Database name'}
                        value={data.database}
                        onChange={(v) => updateData('database', v)}
                        onSubmit={() => {

                            if (!data.database.trim()) {

                                setError('Database is required');
                                return;
                            }
                            nextStep();
                        }}
                        placeholder={data.dialect === 'sqlite' ? './data.db' : 'myapp'}
                    />
                );

            case 'user':
                return (
                    <TextInput
                        label="Username"
                        value={data.user}
                        onChange={(v) => updateData('user', v)}
                        onSubmit={nextStep}
                        placeholder="postgres"
                    />
                );

            case 'password':
                return (
                    <PasswordInput
                        label="Password"
                        value={data.password}
                        onChange={(v) => updateData('password', v)}
                        onSubmit={nextStep}
                    />
                );

            case 'paths':
                return (
                    <Box flexDirection="column" gap={1}>
                        <TextInput
                            label="Schema path"
                            value={data.schemaPath}
                            onChange={(v) => updateData('schemaPath', v)}
                            onSubmit={() => {}}
                            placeholder="./schema"
                        />
                        <TextInput
                            label="Changesets path"
                            value={data.changesetsPath}
                            onChange={(v) => updateData('changesetsPath', v)}
                            onSubmit={nextStep}
                            placeholder="./changesets"
                        />
                    </Box>
                );

            case 'options':
                return (
                    <Box flexDirection="column" gap={1}>
                        <Checkbox
                            label="Protected (requires confirmation for destructive ops)"
                            checked={data.protected}
                            onChange={(v) => updateData('protected', v)}
                            focus
                        />
                        <Checkbox
                            label="Test database (allows db:destroy without confirmation)"
                            checked={data.isTest}
                            onChange={(v) => updateData('isTest', v)}
                        />
                        <Text color="gray" marginTop={1}>
                            Press Enter to continue
                        </Text>
                    </Box>
                );

            case 'test':
                if (testing) {

                    return <Spinner label="Testing connection..." />;
                }

                return (
                    <Box flexDirection="column">
                        <Text>Ready to test connection</Text>
                        <Text color="gray" marginTop={1}>
                            Press Enter to test, or Esc to go back
                        </Text>
                    </Box>
                );

            case 'save':
                if (saving) {

                    return <Spinner label="Saving configuration..." />;
                }

                return (
                    <Box flexDirection="column">
                        <Text color="green">{'\u2713'} Connection successful!</Text>
                        <Text marginTop={1}>Press Enter to save configuration</Text>
                    </Box>
                );
        }
    }

    // Handle enter key for test/save steps
    useScreenInput({
        'enter': () => {

            if (step === 'test' && !testing) {

                testConnectionConfig();
            }
            else if (step === 'save' && !saving) {

                saveConfig();
            }
            else if (step === 'options') {

                nextStep();
            }
        },
    }, [step, testing, saving]);

    return (
        <Box flexDirection="column">

            <Text bold>Add Configuration</Text>

            <Box marginTop={1} flexDirection="column">

                <ProgressIndicator
                    steps={['Name', 'Dialect', 'Connection', 'Paths', 'Options', 'Test', 'Save']}
                    currentStep={getProgressStep(step)}
                />

            </Box>

            <Box marginTop={1}>
                {renderStep()}
            </Box>

            {error && (
                <Box marginTop={1}>
                    <Alert type="error" message={error} />
                </Box>
            )}

            <Footer
                actions={[
                    { key: 'enter', label: 'continue' },
                    { key: 'esc', label: 'back' },
                ]}
            />

        </Box>
    );
}

function getProgressStep(step: Step): number {

    const map: Record<Step, number> = {
        name: 0,
        dialect: 1,
        host: 2,
        port: 2,
        database: 2,
        user: 2,
        password: 2,
        paths: 3,
        options: 4,
        test: 5,
        save: 6,
    };

    return map[step];
}

interface ProgressIndicatorProps {
    steps: string[];
    currentStep: number;
}

function ProgressIndicator({ steps, currentStep }: ProgressIndicatorProps) {

    return (
        <Box>
            {steps.map((label, index) => (

                <Box key={label}>
                    <Text
                        color={index <= currentStep ? 'cyan' : 'gray'}
                        bold={index === currentStep}
                    >
                        {index < currentStep ? '\u2713' : (index + 1)} {label}
                    </Text>

                    {index < steps.length - 1 && (
                        <Text color="gray"> {'\u2192'} </Text>
                    )}
                </Box>
            ))}
        </Box>
    );
}

export default ConfigAddScreen;
```


## Edit Config Screen

```typescript
// src/cli/screens/config/edit.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter, useRoute } from '../../router';
import { useScreenInput } from '../../keyboard';
import {
    Footer,
    TextInput,
    PasswordInput,
    Checkbox,
    Alert,
    Spinner,
    SelectList
} from '../../components';
import { getStateManager } from '../../../core/state';
import { Config } from '../../../core/config/types';
import { attempt } from '@logosdx/utils';
import { observer } from '../../../core/observer';

type EditField = 'host' | 'port' | 'database' | 'user' | 'password' | 'schemaPath' | 'changesetsPath' | 'protected' | 'isTest';

export function ConfigEditScreen() {

    const { back, navigate } = useRouter();
    const { params } = useRoute();
    const configName = params.name;

    const [loading, setLoading] = useState(true);
    const [config, setConfig] = useState<Config | null>(null);
    const [selectedField, setSelectedField] = useState<EditField | null>(null);
    const [editValue, setEditValue] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {

        loadConfig();
    }, [configName]);

    async function loadConfig() {

        if (!configName) {

            setError('Config name required');
            setLoading(false);
            return;
        }

        const [manager, err] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (err) {

            setError(err.message);
            setLoading(false);
            return;
        }

        const cfg = manager!.getConfig(configName);

        if (!cfg) {

            setError(`Config "${configName}" not found`);
            setLoading(false);
            return;
        }

        setConfig(cfg);
        setLoading(false);
    }

    async function saveField() {

        if (!config || !selectedField) return;

        setSaving(true);

        const [manager] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (!manager) {

            setSaving(false);
            return;
        }

        // Update config
        const updated = { ...config };

        switch (selectedField) {

            case 'host':
                updated.connection.host = editValue;
                break;
            case 'port':
                updated.connection.port = parseInt(editValue, 10);
                break;
            case 'database':
                updated.connection.database = editValue;
                break;
            case 'user':
                updated.connection.user = editValue;
                break;
            case 'password':
                updated.connection.password = editValue;
                break;
            case 'schemaPath':
                updated.paths.schema = editValue;
                break;
            case 'changesetsPath':
                updated.paths.changesets = editValue;
                break;
            case 'protected':
                updated.protected = editValue === 'true';
                break;
            case 'isTest':
                updated.isTest = editValue === 'true';
                break;
        }

        const [, saveErr] = await attempt(() => manager.setConfig(configName!, updated));

        if (saveErr) {

            setError(saveErr.message);
            setSaving(false);
            return;
        }

        observer.emit('config:updated', { name: configName!, fields: [selectedField] });

        setConfig(updated);
        setSelectedField(null);
        setSaving(false);
    }

    function startEdit(field: EditField) {

        setSelectedField(field);

        // Get current value
        switch (field) {

            case 'host':
                setEditValue(config?.connection.host ?? '');
                break;
            case 'port':
                setEditValue(String(config?.connection.port ?? ''));
                break;
            case 'database':
                setEditValue(config?.connection.database ?? '');
                break;
            case 'user':
                setEditValue(config?.connection.user ?? '');
                break;
            case 'password':
                setEditValue(config?.connection.password ?? '');
                break;
            case 'schemaPath':
                setEditValue(config?.paths.schema ?? '');
                break;
            case 'changesetsPath':
                setEditValue(config?.paths.changesets ?? '');
                break;
            case 'protected':
                setEditValue(String(config?.protected ?? false));
                break;
            case 'isTest':
                setEditValue(String(config?.isTest ?? false));
                break;
        }
    }

    useScreenInput({
        'enter': () => {

            if (selectedField) {

                saveField();
            }
        },
    }, [selectedField, editValue]);

    if (loading) {

        return <Spinner label="Loading configuration..." />;
    }

    if (error) {

        return <Alert type="error" message={error} />;
    }

    if (!config) {

        return <Alert type="error" message="Config not found" />;
    }

    // If editing a field
    if (selectedField) {

        if (saving) {

            return <Spinner label="Saving..." />;
        }

        const isBoolean = selectedField === 'protected' || selectedField === 'isTest';
        const isPassword = selectedField === 'password';

        return (
            <Box flexDirection="column">

                <Text bold>Edit: {selectedField}</Text>

                <Box marginTop={1}>
                    {isBoolean ? (
                        <Checkbox
                            label={selectedField}
                            checked={editValue === 'true'}
                            onChange={(v) => setEditValue(String(v))}
                            focus
                        />
                    ) : isPassword ? (
                        <PasswordInput
                            label={selectedField}
                            value={editValue}
                            onChange={setEditValue}
                            onSubmit={saveField}
                        />
                    ) : (
                        <TextInput
                            label={selectedField}
                            value={editValue}
                            onChange={setEditValue}
                            onSubmit={saveField}
                        />
                    )}
                </Box>

                <Footer
                    actions={[
                        { key: 'enter', label: 'save' },
                        { key: 'esc', label: 'cancel' },
                    ]}
                />

            </Box>
        );
    }

    // Field list
    const fields: Array<{ key: EditField; label: string; value: string }> = [
        { key: 'host', label: 'Host', value: config.connection.host ?? 'N/A' },
        { key: 'port', label: 'Port', value: String(config.connection.port ?? 'N/A') },
        { key: 'database', label: 'Database', value: config.connection.database },
        { key: 'user', label: 'User', value: config.connection.user ?? '' },
        { key: 'password', label: 'Password', value: config.connection.password ? '********' : '(not set)' },
        { key: 'schemaPath', label: 'Schema Path', value: config.paths.schema },
        { key: 'changesetsPath', label: 'Changesets Path', value: config.paths.changesets },
        { key: 'protected', label: 'Protected', value: config.protected ? 'Yes' : 'No' },
        { key: 'isTest', label: 'Is Test', value: config.isTest ? 'Yes' : 'No' },
    ];

    const items = fields.map(f => ({
        key: f.key,
        label: f.label,
        value: f.key,
        description: f.value,
    }));

    return (
        <Box flexDirection="column">

            <Text bold>Edit Configuration: {configName}</Text>
            <Text color="gray">Dialect: {config.connection.dialect}</Text>

            <Box marginTop={1}>
                <SelectList
                    items={items}
                    onSelect={(item) => startEdit(item.value as EditField)}
                />
            </Box>

            <Footer
                actions={[
                    { key: 'enter', label: 'edit field' },
                ]}
            />

        </Box>
    );
}

export default ConfigEditScreen;
```


## Remove Config Screen

```typescript
// src/cli/screens/config/rm.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter, useRoute } from '../../router';
import {
    Footer,
    Alert,
    Spinner,
    Confirm,
    ProtectedConfirm
} from '../../components';
import { getStateManager } from '../../../core/state';
import { Config } from '../../../core/config/types';
import { attempt } from '@logosdx/utils';
import { observer } from '../../../core/observer';

export function ConfigRemoveScreen() {

    const { back, navigate } = useRouter();
    const { params } = useRoute();
    const configName = params.name;

    const [loading, setLoading] = useState(true);
    const [config, setConfig] = useState<Config | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {

        loadConfig();
    }, [configName]);

    async function loadConfig() {

        if (!configName) {

            setError('Config name required');
            setLoading(false);
            return;
        }

        const [manager] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (!manager) {

            setError('Failed to load state');
            setLoading(false);
            return;
        }

        const cfg = manager.getConfig(configName);

        if (!cfg) {

            setError(`Config "${configName}" not found`);
            setLoading(false);
            return;
        }

        setConfig(cfg);
        setLoading(false);
    }

    async function handleDelete() {

        setDeleting(true);

        const [manager] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (!manager) {

            setError('Failed to load state');
            setDeleting(false);
            return;
        }

        const [, deleteErr] = await attempt(() => manager.deleteConfig(configName!));

        if (deleteErr) {

            setError(deleteErr.message);
            setDeleting(false);
            return;
        }

        observer.emit('config:deleted', { name: configName! });

        navigate('config');
    }

    if (loading) {

        return <Spinner label="Loading..." />;
    }

    if (error) {

        return <Alert type="error" message={error} />;
    }

    if (!config) {

        return <Alert type="error" message="Config not found" />;
    }

    if (deleting) {

        return <Spinner label="Deleting configuration..." />;
    }

    // Protected config requires typed confirmation
    if (config.protected) {

        return (
            <Box flexDirection="column">

                <Text bold>Remove Configuration</Text>

                <Box marginTop={1}>
                    <ProtectedConfirm
                        configName={configName!}
                        action="delete"
                        onConfirm={handleDelete}
                        onCancel={back}
                    />
                </Box>

            </Box>
        );
    }

    // Regular confirmation
    return (
        <Box flexDirection="column">

            <Text bold>Remove Configuration</Text>

            <Box marginTop={1}>
                <Confirm
                    message={`Are you sure you want to delete "${configName}"?`}
                    onConfirm={handleDelete}
                    onCancel={back}
                />
            </Box>

        </Box>
    );
}

export default ConfigRemoveScreen;
```


## Copy Config Screen

```typescript
// src/cli/screens/config/cp.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter, useRoute } from '../../router';
import {
    Footer,
    TextInput,
    Alert,
    Spinner
} from '../../components';
import { getStateManager } from '../../../core/state';
import { Config } from '../../../core/config/types';
import { attempt } from '@logosdx/utils';
import { observer } from '../../../core/observer';

export function ConfigCopyScreen() {

    const { back, navigate } = useRouter();
    const { params } = useRoute();
    const sourceName = params.name;

    const [loading, setLoading] = useState(true);
    const [sourceConfig, setSourceConfig] = useState<Config | null>(null);
    const [newName, setNewName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {

        loadConfig();
    }, [sourceName]);

    async function loadConfig() {

        if (!sourceName) {

            setError('Source config name required');
            setLoading(false);
            return;
        }

        const [manager] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (!manager) {

            setError('Failed to load state');
            setLoading(false);
            return;
        }

        const cfg = manager.getConfig(sourceName);

        if (!cfg) {

            setError(`Config "${sourceName}" not found`);
            setLoading(false);
            return;
        }

        setSourceConfig(cfg);
        setNewName(`${sourceName}-copy`);
        setLoading(false);
    }

    async function handleCopy() {

        if (!newName.trim()) {

            setError('Name is required');
            return;
        }

        setSaving(true);

        const [manager] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (!manager) {

            setError('Failed to load state');
            setSaving(false);
            return;
        }

        // Check if name exists
        if (manager.getConfig(newName)) {

            setError(`Config "${newName}" already exists`);
            setSaving(false);
            return;
        }

        // Create copy
        const newConfig: Config = {
            ...sourceConfig!,
            name: newName,
        };

        const [, saveErr] = await attempt(() => manager.setConfig(newName, newConfig));

        if (saveErr) {

            setError(saveErr.message);
            setSaving(false);
            return;
        }

        observer.emit('config:created', { name: newName });

        navigate('config');
    }

    if (loading) {

        return <Spinner label="Loading..." />;
    }

    if (error && !sourceConfig) {

        return <Alert type="error" message={error} />;
    }

    if (saving) {

        return <Spinner label="Copying configuration..." />;
    }

    return (
        <Box flexDirection="column">

            <Text bold>Copy Configuration</Text>
            <Text color="gray">Source: {sourceName}</Text>

            <Box marginTop={1}>
                <TextInput
                    label="New name"
                    value={newName}
                    onChange={(v) => {

                        setNewName(v);
                        setError(null);
                    }}
                    onSubmit={handleCopy}
                    placeholder="Enter name for the copy"
                />
            </Box>

            {error && (
                <Box marginTop={1}>
                    <Alert type="error" message={error} />
                </Box>
            )}

            <Footer
                actions={[
                    { key: 'enter', label: 'copy' },
                ]}
            />

        </Box>
    );
}

export default ConfigCopyScreen;
```


## Use Config Screen

```typescript
// src/cli/screens/config/use.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter, useRoute } from '../../router';
import { Alert, Spinner } from '../../components';
import { getStateManager } from '../../../core/state';
import { attempt } from '@logosdx/utils';
import { observer } from '../../../core/observer';

export function ConfigUseScreen() {

    const { back, navigate } = useRouter();
    const { params } = useRoute();
    const configName = params.name;

    const [setting, setSetting] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {

        setActiveConfig();
    }, [configName]);

    async function setActiveConfig() {

        if (!configName) {

            setError('Config name required');
            setSetting(false);
            return;
        }

        const [manager] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (!manager) {

            setError('Failed to load state');
            setSetting(false);
            return;
        }

        const cfg = manager.getConfig(configName);

        if (!cfg) {

            setError(`Config "${configName}" not found`);
            setSetting(false);
            return;
        }

        const previous = manager.getActiveConfig()?.name ?? null;

        const [, setErr] = await attempt(() => manager.setActiveConfig(configName));

        if (setErr) {

            setError(setErr.message);
            setSetting(false);
            return;
        }

        observer.emit('config:activated', { name: configName, previous });

        // Brief success message then navigate
        setSetting(false);

        setTimeout(() => {

            navigate('config');
        }, 500);
    }

    if (setting) {

        return <Spinner label={`Setting active config to "${configName}"...`} />;
    }

    if (error) {

        return (
            <Box flexDirection="column">
                <Alert type="error" message={error} />
                <Text color="gray" marginTop={1}>Press Esc to go back</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column">
            <Text color="green">{'\u2713'} Active config set to: {configName}</Text>
        </Box>
    );
}

export default ConfigUseScreen;
```


## Index Exports

```typescript
// src/cli/screens/config/index.tsx

export { default as list } from './list';
export { default as add } from './add';
export { default as edit } from './edit';
export { default as rm } from './rm';
export { default as cp } from './cp';
export { default as use } from './use';
```


## Screen Summary

| Screen | Route | Purpose |
|--------|-------|---------|
| List | `config` | View all configs, navigate to actions |
| Add | `config/add` | Multi-step wizard to create config |
| Edit | `config/edit` | Select field to edit |
| Remove | `config/rm` | Confirm and delete config |
| Copy | `config/cp` | Clone config with new name |
| Use | `config/use` | Set as active config |


## Keyboard Reference

### List Screen

| Key | Action |
|-----|--------|
| `a` | Add new config |
| `e` | Edit selected config |
| `d` | Delete selected config |
| `c` | Copy selected config |
| `Enter` | Use selected config |
| `↑`/`↓` | Navigate list |

### Add Screen

| Key | Action |
|-----|--------|
| `Enter` | Continue to next step |
| `Esc` | Go back to previous step |

### Edit Screen

| Key | Action |
|-----|--------|
| `Enter` | Edit selected field / Save |
| `Esc` | Cancel edit / Go back |
