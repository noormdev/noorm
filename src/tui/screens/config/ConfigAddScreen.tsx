/**
 * ConfigAddScreen - wizard to create a new database configuration.
 *
 * Multi-step flow to collect config details:
 * 1. Name and dialect selection
 * 2. Connection details (host, port, database, user, password)
 * 3. Options (protected, test flags)
 * 4. Connection test
 * 5. Save
 *
 * @example
 * ```bash
 * noorm config:add       # Opens this screen
 * noorm config add       # Same thing
 * ```
 */
import { useState, useCallback } from 'react';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { FormValues, FormField } from '../../components/index.js';
import type { Config } from '../../../core/config/types.js';
import type { Dialect } from '../../../core/connection/types.js';

import { useRouter } from '../../router.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Form, useToast } from '../../components/index.js';
import { testConnection } from '../../../core/connection/factory.js';
import { getErrorMessage, validateConfigName, validatePort, buildConnectionConfig } from '../../utils/index.js';

/**
 * ConfigAddScreen component.
 *
 * A multi-field form wizard for creating database configurations.
 */
export function ConfigAddScreen({ params }: ScreenProps): ReactElement {

    const { back, navigate } = useRouter();
    const fromInit = Boolean(params.fromInit);
    const { stateManager, configs, refresh } = useAppContext();
    const { showToast } = useToast();

    const [busy, setBusy] = useState(false);
    const [busyLabel, setBusyLabel] = useState('Testing connection...');
    const [connectionError, setConnectionError] = useState<string | null>(null);

    // Form fields for config creation
    const fields: FormField[] = [
        {
            key: 'name',
            label: 'Config Name',
            type: 'text',
            required: true,
            placeholder: 'e.g., dev, staging, prod',
            validate: (value) => validateConfigName(String(value ?? ''), configs.map((c) => c.name)),
        },
        {
            key: 'dialect',
            label: 'Database Type',
            type: 'select',
            required: true,
            options: [
                { label: 'PostgreSQL', value: 'postgres' },
                { label: 'MySQL', value: 'mysql' },
                { label: 'SQLite', value: 'sqlite' },
                { label: 'SQL Server', value: 'mssql' },
            ],
            defaultValue: 'postgres',
        },
        {
            key: 'host',
            label: 'Host',
            type: 'text',
            placeholder: 'localhost',
            defaultValue: 'localhost',
        },
        {
            key: 'port',
            label: 'Port',
            type: 'text',
            placeholder: '5432',
            validate: (value) => validatePort(typeof value === 'string' ? value : undefined),
        },
        {
            key: 'database',
            label: 'Database',
            type: 'text',
            required: true,
            placeholder: 'myapp_dev',
        },
        {
            key: 'user',
            label: 'Username',
            type: 'text',
            placeholder: 'postgres',
        },
        {
            key: 'password',
            label: 'Password',
            type: 'password',
            placeholder: '(optional)',
        },
        {
            key: 'protected',
            label: 'Protected (requires confirmation for destructive ops)',
            type: 'checkbox',
            defaultValue: false,
        },
        {
            key: 'isTest',
            label: 'Test Database (skipped in production builds)',
            type: 'checkbox',
            defaultValue: false,
        },
    ];

    // Handle form submission
    const handleSubmit = useCallback(
        async (values: FormValues) => {

            if (!stateManager) {

                setConnectionError('State manager not available');

                return;

            }

            const dialect = values['dialect'] as Dialect;

            // Build connection config
            const connectionConfig = buildConnectionConfig(values, dialect);

            // Test connection first (server only - database may not exist yet)
            setBusy(true);
            setBusyLabel('Testing connection...');
            setConnectionError(null);

            const result = await testConnection(connectionConfig, { testServerOnly: true });

            if (!result.ok) {

                setConnectionError(result.error ?? 'Connection failed');
                setBusy(false);

                return;

            }

            // Build full config
            const configName = String(values['name']);
            const config: Config = {
                name: configName,
                type: 'local',
                isTest: Boolean(values['isTest']),
                protected: Boolean(values['protected']),
                connection: connectionConfig,
            };

            // Save config
            setBusyLabel('Saving configuration...');

            const [_, err] = await attempt(async () => {

                await stateManager.setConfig(config.name, config);

                // If this is the first config, set it as active
                if (configs.length === 0) {

                    await stateManager.setActiveConfig(config.name);

                }

                await refresh();

            });

            if (err) {

                setConnectionError(getErrorMessage(err));
                setBusy(false);

                return;

            }

            // Success - show toast and navigate appropriately
            showToast({
                message: `Configuration "${configName}" created`,
                variant: 'success',
            });

            // If coming from init flow, go home instead of back to init
            if (fromInit) {

                navigate('home');

            }
            else {

                back();

            }

        },
        [stateManager, configs, refresh, showToast, back, navigate, fromInit],
    );

    // Handle cancel
    const handleCancel = useCallback(() => {

        // If coming from init flow, go home instead of back to init
        if (fromInit) {

            navigate('home');

        }
        else {

            back();

        }

    }, [back, navigate, fromInit]);

    return (
        <Panel title="Add Configuration" paddingX={2} paddingY={1}>
            <Form
                fields={fields}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                submitLabel="Create Config"
                focusLabel="ConfigAddForm"
                busy={busy}
                busyLabel={busyLabel}
                statusError={connectionError ?? undefined}
            />
        </Panel>
    );

}
