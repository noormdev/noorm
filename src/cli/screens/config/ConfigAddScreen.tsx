/**
 * ConfigAddScreen - wizard to create a new database configuration.
 *
 * Multi-step flow to collect config details:
 * 1. Name and dialect selection
 * 2. Connection details (host, port, database, user, password)
 * 3. Paths (schema, changes directories)
 * 4. Options (protected, test flags)
 * 5. Connection test
 * 6. Save
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

/**
 * Default ports by dialect.
 */
const DEFAULT_PORTS: Record<Dialect, number> = {
    postgres: 5432,
    mysql: 3306,
    sqlite: 0,
    mssql: 1433,
};

/**
 * ConfigAddScreen component.
 *
 * A multi-field form wizard for creating database configurations.
 */
export function ConfigAddScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
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
            validate: (value) => {

                if (typeof value !== 'string') return 'Name is required';

                if (!/^[a-z0-9_-]+$/i.test(value)) {

                    return 'Only letters, numbers, hyphens, underscores';

                }

                if (configs.some((c) => c.name === value)) {

                    return 'Config name already exists';

                }

                return undefined;

            },
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
            key: 'sqlPath',
            label: 'SQL Path',
            type: 'text',
            defaultValue: './sql',
            placeholder: './sql',
        },
        {
            key: 'changesPath',
            label: 'Changes Path',
            type: 'text',
            defaultValue: './changes',
            placeholder: './changes',
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
            const isSqlite = dialect === 'sqlite';

            // Build connection config
            const connectionConfig = {
                dialect,
                host: isSqlite ? undefined : String(values['host'] || 'localhost'),
                port: isSqlite
                    ? undefined
                    : values['port']
                        ? parseInt(String(values['port']), 10)
                        : DEFAULT_PORTS[dialect],
                database: String(values['database']),
                user: isSqlite ? undefined : values['user'] ? String(values['user']) : undefined,
                password: isSqlite
                    ? undefined
                    : values['password']
                        ? String(values['password'])
                        : undefined,
            };

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
                paths: {
                    sql: String(values['sqlPath'] || './sql'),
                    changes: String(values['changesPath'] || './changes'),
                },
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

                setConnectionError(err instanceof Error ? err.message : String(err));
                setBusy(false);

                return;

            }

            // Success - show toast and go back (pops history)
            showToast({
                message: `Configuration "${configName}" created`,
                variant: 'success',
            });
            back();

        },
        [stateManager, configs, refresh, showToast, back],
    );

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

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
