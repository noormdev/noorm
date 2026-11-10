/**
 * ConfigAddScreen - wizard to create a new database configuration.
 *
 * Multi-step flow to collect config details:
 * 1. Name and dialect selection
 * 2. Connection details (host, port, database, user, password)
 * 3. Options (access roles, test flags)
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
import { useAppContext, useSettings } from '../../app-context.js';
import { Panel, Form, useToast } from '../../components/index.js';
import { useAbortableTask } from '../../hooks/index.js';
import { testConnection } from '../../../core/connection/factory.js';
import { DEFAULT_ACCESS, GUARDED_ACCESS } from '../../../core/policy/index.js';
import { validateAccessRoles } from '../../../core/config/resolver.js';
import {
    getErrorMessage,
    STOPPED_WAITING_MESSAGE,
    SAVE_UNVERIFIED,
    validateConfigName,
    validatePort,
    buildConnectionConfig,
    buildAccessFromValues,
    getRoleOptions,
} from '../../utils/index.js';

/**
 * ConfigAddScreen component.
 *
 * A multi-field form wizard for creating database configurations.
 */
export function ConfigAddScreen({ params }: ScreenProps): ReactElement {

    const { back, navigate } = useRouter();
    const fromInit = Boolean(params.fromInit);
    const { stateManager, configs, refresh } = useAppContext();
    const { settings } = useSettings();
    const { showToast } = useToast();

    const [busy, setBusy] = useState(false);
    const [busyLabel, setBusyLabel] = useState('Testing connection...');
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [testFailed, setTestFailed] = useState(false);

    // Only the connection test can be cancelled. The save that follows is a
    // local write, and offering a hatch over it would let the screen report
    // "nothing was saved" about a config that had just been written.
    const [cancellable, setCancellable] = useState(false);

    const task = useAbortableTask();

    // Default access for a brand-new config: the matched stage's `protected`
    // flag (guarded when true) if the caller navigated with a known stage
    // name, otherwise the unrestricted-by-the-author default — which still
    // holds the agent channel to `viewer`.
    const matchedStage = params.name ? settings?.stages?.[params.name] : undefined;
    const defaultAccess = matchedStage?.defaults?.protected ? GUARDED_ACCESS : DEFAULT_ACCESS;
    const roleOptions = getRoleOptions(settings?.access?.roles);

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
            key: 'userRole',
            label: 'User Role',
            hint: '(CLI/TUI access)',
            type: 'select',
            options: roleOptions.user,
            defaultValue: defaultAccess.user,
        },
        {
            key: 'agentRole',
            label: 'Agent Role',
            hint: '(MCP/CLI access)',
            type: 'select',
            options: roleOptions.agent,
            defaultValue: defaultAccess.agent === false ? 'off' : `role:${defaultAccess.agent}`,
        },
        {
            key: 'isTest',
            label: 'Test Database',
            hint: '(skipped in production builds)',
            type: 'checkbox',
            defaultValue: false,
        },
    ];

    const save = useCallback(
        async (values: FormValues, verify: boolean) => {

            if (!stateManager) {

                setConnectionError('State manager not available');

                return;

            }

            const dialect = values['dialect'] as Dialect;

            // Build connection config
            const connectionConfig = buildConnectionConfig(values, dialect);

            const controller = task.start();

            setBusy(true);
            setConnectionError(null);
            setTestFailed(false);

            if (verify) {

                setBusyLabel('Testing connection...');
                setCancellable(true);

                // Server only - the database may not exist yet.
                const result = await testConnection(connectionConfig, {
                    testServerOnly: true,
                    signal: controller.signal,
                });

                // Cancelled or superseded: whoever did that already owns the
                // screen, and a driver that answered anyway must not undo it.
                if (!task.isCurrent(controller)) return;

                if (!result.ok) {

                    setConnectionError(result.error ?? 'Connection failed');
                    setTestFailed(true);
                    setBusy(false);

                    return;

                }

            }

            // Build full config
            const configName = String(values['name']);
            const access = buildAccessFromValues(values);
            const config: Config = {
                name: configName,
                type: 'local',
                isTest: Boolean(values['isTest']),
                access,
                connection: connectionConfig,
            };

            // Save config
            setBusyLabel('Saving configuration...');
            setCancellable(false);

            const [_, err] = await attempt(async () => {

                if (!settings) throw new Error('Settings are not available');
                validateAccessRoles(config.access, settings.access?.roles);


                await stateManager.setConfig(config.name, config);

                // If this is the first config, set it as active
                if (configs.length === 0) {

                    await stateManager.setActiveConfig(config.name);

                }

                await refresh();

            });

            if (!task.isCurrent(controller)) return;

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
        [stateManager, configs, settings, refresh, showToast, back, navigate, fromInit, task],
    );

    // Escape while busy stops the operation instead of walking away from it.
    const handleCancelBusy = useCallback(() => {

        if (!task.cancel()) return;

        setBusy(false);
        setCancellable(false);
        setConnectionError(STOPPED_WAITING_MESSAGE);

    }, [task]);

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
                onSubmit={(values) => save(values, true)}
                altSubmit={{ ...SAVE_UNVERIFIED, suggest: testFailed, onSubmit: (values) => save(values, false) }}
                onCancel={handleCancel}
                submitLabel="Create Config"
                focusLabel="ConfigAddForm"
                busy={busy}
                busyLabel={busyLabel}
                onCancelBusy={cancellable ? handleCancelBusy : undefined}
                statusError={connectionError ?? undefined}
            />
        </Panel>
    );

}
