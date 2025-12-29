/**
 * ConfigEditScreen - edit an existing database configuration.
 *
 * Pre-populates form with existing config values.
 * Dialect cannot be changed (must recreate config instead).
 *
 * @example
 * ```bash
 * noorm config:edit dev    # Edit 'dev' config
 * noorm config edit dev    # Same thing
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Text } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { FormValues, FormField } from '../../components/index.js';
import type { Dialect } from '../../../core/connection/types.js';

import { useRouter } from '../../router.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Form, useToast } from '../../components/index.js';
import { testConnection } from '../../../core/connection/factory.js';

/**
 * ConfigEditScreen component.
 */
export function ConfigEditScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { stateManager, refresh } = useAppContext();
    const { showToast } = useToast();

    const configName = params.name;

    const [busy, setBusy] = useState(false);
    const [busyLabel, setBusyLabel] = useState('Testing connection...');
    const [connectionError, setConnectionError] = useState<string | null>(null);

    // Get the config to edit
    const config = useMemo(() => {

        if (!stateManager || !configName) return null;

        return stateManager.getConfig(configName);

    }, [stateManager, configName]);

    // Form fields with existing values
    const fields: FormField[] = useMemo(() => {

        if (!config) return [];

        return [
            {
                key: 'name',
                label: 'Config Name',
                type: 'text',
                required: true,
                defaultValue: config.name,
                validate: (value) => {

                    if (typeof value !== 'string') return 'Name is required';

                    if (!/^[a-z0-9_-]+$/i.test(value)) {

                        return 'Only letters, numbers, hyphens, underscores';

                    }

                    return undefined;

                },
            },
            {
                key: 'dialect',
                label: 'Database Type (cannot be changed)',
                type: 'text',
                defaultValue: config.connection.dialect,
                // Read-only - we'll skip this in submit
            },
            {
                key: 'host',
                label: 'Host',
                type: 'text',
                defaultValue: config.connection.host ?? 'localhost',
            },
            {
                key: 'port',
                label: 'Port',
                type: 'text',
                defaultValue: String(config.connection.port ?? ''),
                validate: (value) => {

                    if (typeof value !== 'string' || !value) return undefined;

                    const port = parseInt(value, 10);

                    if (isNaN(port) || port < 1 || port > 65535) {

                        return 'Port must be 1-65535';

                    }

                    return undefined;

                },
            },
            {
                key: 'database',
                label: 'Database',
                type: 'text',
                required: true,
                defaultValue: config.connection.database,
            },
            {
                key: 'user',
                label: 'Username',
                type: 'text',
                defaultValue: config.connection.user ?? '',
            },
            {
                key: 'password',
                label: 'Password',
                type: 'password',
                defaultValue: config.connection.password ?? '',
                placeholder: '(unchanged if empty)',
            },
            {
                key: 'schemaPath',
                label: 'Schema Path',
                type: 'text',
                defaultValue: config.paths.schema,
            },
            {
                key: 'changesetsPath',
                label: 'Changesets Path',
                type: 'text',
                defaultValue: config.paths.changesets,
            },
            {
                key: 'protected',
                label: 'Protected',
                type: 'checkbox',
                defaultValue: config.protected,
            },
            {
                key: 'isTest',
                label: 'Test Database',
                type: 'checkbox',
                defaultValue: config.isTest,
            },
        ];

    }, [config]);

    // Handle form submission
    const handleSubmit = useCallback(
        async (values: FormValues) => {

            if (!stateManager || !config || !configName) {

                setConnectionError('Config not found');

                return;

            }

            const dialect = config.connection.dialect as Dialect;
            const isSqlite = dialect === 'sqlite';

            // Build connection config (keep dialect from original)
            const connectionConfig = {
                dialect,
                host: isSqlite ? undefined : String(values['host'] || 'localhost'),
                port: isSqlite
                    ? undefined
                    : values['port']
                        ? parseInt(String(values['port']), 10)
                        : config.connection.port,
                database: String(values['database']),
                user: isSqlite ? undefined : values['user'] ? String(values['user']) : undefined,
                // Only update password if provided
                password: isSqlite
                    ? undefined
                    : values['password']
                        ? String(values['password'])
                        : config.connection.password,
            };

            // Test connection first
            setBusy(true);
            setBusyLabel('Testing connection...');
            setConnectionError(null);

            const result = await testConnection(connectionConfig, { testServerOnly: true });

            if (!result.ok) {

                setConnectionError(result.error ?? 'Connection failed');
                setBusy(false);

                return;

            }

            // Build updated config
            const newName = String(values['name']);
            const updatedConfig = {
                ...config,
                name: newName,
                isTest: Boolean(values['isTest']),
                protected: Boolean(values['protected']),
                connection: connectionConfig,
                paths: {
                    schema: String(values['schemaPath'] || './schema'),
                    changesets: String(values['changesetsPath'] || './changesets'),
                },
            };

            // Save config
            setBusyLabel('Saving changes...');

            const [_, err] = await attempt(async () => {

                // If name changed, delete old and create new
                if (newName !== configName) {

                    await stateManager.deleteConfig(configName);

                }

                await stateManager.setConfig(updatedConfig.name, updatedConfig);
                await refresh();

            });

            if (err) {

                setConnectionError(err instanceof Error ? err.message : String(err));
                setBusy(false);

                return;

            }

            // Success - show toast and go back (pops history)
            showToast({
                message: `Configuration "${newName}" updated`,
                variant: 'success',
            });
            back();

        },
        [stateManager, config, configName, refresh, showToast, back],
    );

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // No config name provided
    if (!configName) {

        return (
            <Panel title="Edit Configuration" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">
                    No config name provided. Use: noorm config:edit &lt;name&gt;
                </Text>
            </Panel>
        );

    }

    // Config not found
    if (!config) {

        return (
            <Panel title="Edit Configuration" paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">Config "{configName}" not found.</Text>
            </Panel>
        );

    }

    return (
        <Panel title={`Edit: ${configName}`} paddingX={2} paddingY={1}>
            <Form
                fields={fields}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                submitLabel="Save Changes"
                focusLabel="ConfigEditForm"
                busy={busy}
                busyLabel={busyLabel}
                statusError={connectionError ?? undefined}
            />
        </Panel>
    );

}
