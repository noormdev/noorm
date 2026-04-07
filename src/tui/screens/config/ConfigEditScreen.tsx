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
import { Box, useStdout } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { FormValues, FormField } from '../../components/index.js';
import type { Dialect } from '../../../core/connection/types.js';

import { useRouter } from '../../router.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Form, useToast, MissingParamPanel, NotFoundPanel } from '../../components/index.js';
import { testConnection } from '../../../core/connection/factory.js';
import { getErrorMessage, validateConfigName, validatePort, buildConnectionConfig } from '../../utils/index.js';

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
                validate: (value) => validateConfigName(String(value ?? '')),
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
                validate: (value) => validatePort(typeof value === 'string' ? value : undefined),
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

            // Build connection config (keep dialect from original, preserve port and password if not provided)
            const connectionConfig = buildConnectionConfig(values, dialect, {
                port: config.connection.port,
                password: config.connection.password,
            });

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

                setConnectionError(getErrorMessage(err));
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

        return <MissingParamPanel title="Edit Configuration" param="config name" usage="noorm config:edit <name>" />;

    }

    // Config not found
    if (!config) {

        return <NotFoundPanel title="Edit Configuration" type="Config" name={configName} />;

    }

    const { stdout } = useStdout();
    const terminalHeight = stdout.rows ?? 24;

    // Reserve space for Panel border (2), title (2), padding (2)
    const formHeight = Math.max(terminalHeight - 6, 10);

    return (
        <Panel title={`Edit: ${configName}`} paddingX={2} paddingY={1}>
            <Box height={formHeight} overflowY="hidden">
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
            </Box>
        </Panel>
    );

}
