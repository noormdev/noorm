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
import { useAppContext, useSettings } from '../../app-context.js';
import { Panel, Form, useToast, MissingParamPanel, NotFoundPanel } from '../../components/index.js';
import { testConnection } from '../../../core/connection/factory.js';
import { SettingsProvider, validateAccessRoles } from '../../../core/config/resolver.js';
import { useAbortableTask } from '../../hooks/index.js';
import { useBusy } from '../../focus.js';
import {
    getErrorMessage,
    STOPPED_WAITING_MESSAGE,
    SAVE_UNVERIFIED,
    validateConfigName,
    validatePort,
    buildConnectionConfig,
    buildSslFields,
    validateSslForm,
    sslPinnedByRename,
    connectionOverStage,
    buildAccessFromValues,
    getRoleOptions,
} from '../../utils/index.js';

/**
 * ConfigEditScreen component.
 */
export function ConfigEditScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { stateManager, settingsManager, refresh } = useAppContext();
    const { settings } = useSettings();
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
    const [testFailed, setTestFailed] = useState(false);

    // Only the connection test can be cancelled. The save that follows is a
    // local write, and offering a hatch over it would let the screen report
    // "nothing was saved" about a config that had just been written.
    const [cancellable, setCancellable] = useState(false);

    useBusy(busy);

    const task = useAbortableTask();

    // Get the config to edit
    const config = useMemo(() => {

        if (!stateManager || !configName) return null;

        return stateManager.getConfig(configName);

    }, [stateManager, configName]);

    const settingsProvider = useMemo(

        () => (settingsManager ? new SettingsProvider(settingsManager) : null),
        [settingsManager],
    );

    // What the SSL fields open on. A stored config its stage makes invalid still opens, on its stored values.
    const effectiveConnection = useMemo(() => {

        if (!config) return undefined;

        const [effective] = connectionOverStage(config.name, config.connection, settingsManager);

        return effective ?? config.connection;

    }, [config, settingsManager, settings]);

    // Form fields with existing values
    const fields: FormField[] = useMemo(() => {

        if (!config) return [];

        const access = config.access;
        const roleOptions = getRoleOptions(settings?.access?.roles);

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
            ...(config.connection.dialect === 'sqlite' ? [] : buildSslFields(config.connection, effectiveConnection)),
            {
                key: 'userRole',
                label: 'User Role',
                hint: '(CLI/TUI access)',
                type: 'select',
                options: roleOptions.user,
                defaultValue: access.user,
            },
            {
                key: 'agentRole',
                label: 'Agent Role',
                hint: '(MCP/CLI access)',
                type: 'select',
                options: roleOptions.agent,
                defaultValue: access.agent === false ? 'off' : `role:${access.agent}`,
            },
            {
                key: 'isTest',
                label: 'Test Database',
                type: 'checkbox',
                defaultValue: config.isTest,
            },
        ];

    }, [config, settings, effectiveConnection]);

    const save = useCallback(
        async (values: FormValues, verify: boolean) => {

            if (!stateManager || !config || !configName) {

                setConnectionError('Config not found');

                return;

            }

            const dialect = config.connection.dialect as Dialect;
            const newName = String(values['name']);
            const stageSsl = settingsManager?.getStage(newName)?.defaults?.ssl;

            const pinnedSsl = newName !== config.name
                ? sslPinnedByRename(values, dialect, stageSsl, config.connection, effectiveConnection)
                : undefined;

            const sslError = validateSslForm(values, dialect, pinnedSsl ?? stageSsl, config.connection, effectiveConnection);

            if (sslError) {

                setConnectionError(sslError);
                setTestFailed(false);

                return;

            }

            const builtConnection = buildConnectionConfig(values, dialect, config.connection, effectiveConnection);
            const connectionConfig = pinnedSsl === undefined ? builtConnection : { ...builtConnection, ssl: pinnedSsl };

            const controller = task.start();

            setBusy(true);
            setConnectionError(null);
            setTestFailed(false);

            if (verify) {

                setBusyLabel('Testing connection...');
                setCancellable(true);

                const [tested, stageErr] = connectionOverStage(newName, connectionConfig, settingsManager);

                const result = stageErr
                    ? { ok: false, error: stageErr.message }
                    : await testConnection(tested, { testServerOnly: true, signal: controller.signal });

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

            // Build updated config
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

                if (!settings || !settingsProvider) throw new Error('Settings are not available');
                validateAccessRoles(updatedConfig.access, settings.access?.roles);

                if (newName !== configName) {

                    await stateManager.renameConfig(configName, updatedConfig, settingsProvider);

                }
                else {

                    await stateManager.setConfig(updatedConfig.name, updatedConfig);

                }

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
        [stateManager, settingsManager, config, configName, settings, settingsProvider, effectiveConnection, refresh, showToast, back, task],
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
                onSubmit={(values) => save(values, true)}
                altSubmit={{ ...SAVE_UNVERIFIED, suggest: testFailed, onSubmit: (values) => save(values, false) }}
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
