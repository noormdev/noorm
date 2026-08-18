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
import { useWindowSize } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { FormValues, FormField } from '../../components/index.js';
import type { Dialect } from '../../../core/connection/types.js';

import { useRouter } from '../../router.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Form, useToast, MissingParamPanel, NotFoundPanel } from '../../components/index.js';
import { testConnection } from '../../../core/connection/factory.js';
import { SettingsProvider } from '../../../core/config/resolver.js';
import { useAbortableTask } from '../../hooks/index.js';
import {
    getErrorMessage,
    STOPPED_WAITING_MESSAGE,
    validateConfigName,
    validatePort,
    buildConnectionConfig,
    buildAccessFromValues,
    USER_ROLE_OPTIONS,
    AGENT_ROLE_OPTIONS,
} from '../../utils/index.js';

/**
 * ConfigEditScreen component.
 */
export function ConfigEditScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { stateManager, settingsManager, refresh } = useAppContext();
    const { showToast } = useToast();
    // useWindowSize, not useStdout: stdout.rows mutates on resize without asking
    // React for anything, so formHeight below would stay frozen at mount size.
    // Must stay above the early returns, or the hook count changes across the
    // async config-load boundary.
    const { rows: terminalHeight } = useWindowSize();

    const configName = params.name;

    const [busy, setBusy] = useState(false);
    const [busyLabel, setBusyLabel] = useState('Testing connection...');
    const [connectionError, setConnectionError] = useState<string | null>(null);

    // Only the connection test can be cancelled. The save that follows is a
    // local write, and offering a hatch over it would let the screen report
    // "nothing was saved" about a config that had just been written.
    const [cancellable, setCancellable] = useState(false);

    const task = useAbortableTask();

    // Get the config to edit
    const config = useMemo(() => {

        if (!stateManager || !configName) return null;

        return stateManager.getConfig(configName);

    }, [stateManager, configName]);

    // Settings provider is only built once settingsManager has loaded; a null
    // provider means "no stages known" = no lock, matching canDeleteConfig's
    // own no-settings behavior. Passed into the rename-path delete below so
    // the core-seam guard (StateManager.deleteConfig) can enforce it.
    const settingsProvider = useMemo(

        () => (settingsManager ? new SettingsProvider(settingsManager) : null),
        [settingsManager],
    );

    // Form fields with existing values
    const fields: FormField[] = useMemo(() => {

        if (!config) return [];

        const access = config.access;

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
                label: 'Database Type',
                type: 'text',
                hint: '(locked)',
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
                key: 'userRole',
                label: 'User Role',
                hint: '(CLI/TUI access)',
                type: 'select',
                options: USER_ROLE_OPTIONS,
                defaultValue: access.user,
            },
            {
                key: 'agentRole',
                label: 'Agent Role',
                hint: '(MCP/CLI access)',
                type: 'select',
                options: AGENT_ROLE_OPTIONS,
                defaultValue: access.agent === false ? 'off' : access.agent,
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
            const controller = task.start();

            setBusy(true);
            setBusyLabel('Testing connection...');
            setConnectionError(null);
            setCancellable(true);

            const result = await testConnection(connectionConfig, {
                testServerOnly: true,
                signal: controller.signal,
            });

            // Cancelled or superseded: whoever did that already owns the
            // screen, and a driver that answered anyway must not undo it.
            if (!task.isCurrent(controller)) return;

            if (!result.ok) {

                setConnectionError(result.error ?? 'Connection failed');
                setBusy(false);

                return;

            }

            // Build updated config
            const newName = String(values['name']);
            const access = buildAccessFromValues(values);
            const updatedConfig = {
                ...config,
                name: newName,
                isTest: Boolean(values['isTest']),
                access,
                connection: connectionConfig,
            };

            // Save config
            setBusyLabel('Saving changes...');
            setCancellable(false);

            const [_, err] = await attempt(async () => {

                // If name changed, delete old and create new
                if (newName !== configName) {

                    await stateManager.deleteConfig(configName, settingsProvider ?? undefined);

                }

                await stateManager.setConfig(updatedConfig.name, updatedConfig);
                await refresh();

            });

            if (!task.isCurrent(controller)) return;

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
        [stateManager, config, configName, settingsProvider, refresh, showToast, back, task],
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

    // App shell header (2) + status bar (2) + panel border (2) + title and its
    // spacer (2) + vertical padding (2). The old reserve of 6 ignored the shell,
    // which is what pushed the last fields under an overflow-hidden fold; the
    // Form windows itself to this budget now, so no clipping container is needed.
    const formHeight = Math.max(terminalHeight - 10, 8);

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
                onCancelBusy={cancellable ? handleCancelBusy : undefined}
                statusError={connectionError ?? undefined}
                height={formHeight}
            />
        </Panel>
    );

}
