/**
 * SettingsLoggingScreen - edit logging configuration.
 *
 * Configure file logging settings.
 *
 * @example
 * ```bash
 * noorm settings logging    # Edit logging settings
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { FormValues, FormField } from '../../components/index.js';

import { useRouter } from '../../router.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Form, useToast } from '../../components/index.js';

/**
 * SettingsLoggingScreen component.
 */
export function SettingsLoggingScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { settingsManager, refresh } = useAppContext();
    const { showToast } = useToast();

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Get current logging config
    const logging = useMemo(() => {

        if (!settingsManager) {

            return {
                enabled: true,
                level: 'info' as const,
                file: '.noorm/noorm.log',
                maxSize: '10mb',
                maxFiles: 5,
            };

        }

        return settingsManager.getLogging();

    }, [settingsManager]);

    // Form fields
    const fields: FormField[] = useMemo(
        () => [
            {
                key: 'enabled',
                label: 'Enable File Logging',
                type: 'checkbox',
                defaultValue: logging.enabled ?? true,
            },
            {
                key: 'level',
                label: 'Log Level',
                type: 'select',
                options: [
                    { label: 'Silent', value: 'silent' },
                    { label: 'Error', value: 'error' },
                    { label: 'Warn', value: 'warn' },
                    { label: 'Info', value: 'info' },
                    { label: 'Verbose', value: 'verbose' },
                ],
                defaultValue: logging.level ?? 'info',
            },
            {
                key: 'file',
                label: 'Log File Path',
                type: 'text',
                defaultValue: logging.file ?? '.noorm/noorm.log',
                placeholder: '.noorm/noorm.log',
            },
            {
                key: 'maxSize',
                label: 'Max File Size',
                type: 'text',
                defaultValue: logging.maxSize ?? '10mb',
                placeholder: '10mb',
            },
            {
                key: 'maxFiles',
                label: 'Max Rotated Files',
                type: 'text',
                defaultValue: String(logging.maxFiles ?? 5),
                placeholder: '5',
                validate: (value) => {

                    if (typeof value !== 'string' || !value) return undefined;

                    const num = parseInt(value, 10);

                    if (isNaN(num) || num < 1) {

                        return 'Must be a positive number';

                    }

                    return undefined;

                },
            },
        ],
        [logging],
    );

    // Handle form submission
    const handleSubmit = useCallback(
        async (values: FormValues) => {

            if (!settingsManager) {

                setError('Settings manager not available');

                return;

            }

            setBusy(true);
            setError(null);

            const newLogging = {
                enabled: Boolean(values['enabled']),
                level: String(values['level'] || 'info') as
                    | 'silent'
                    | 'error'
                    | 'warn'
                    | 'info'
                    | 'verbose',
                file: String(values['file'] || '.noorm/noorm.log'),
                maxSize: String(values['maxSize'] || '10mb'),
                maxFiles: parseInt(String(values['maxFiles'] || '5'), 10),
            };

            const [_, err] = await attempt(async () => {

                await settingsManager.setLogging(newLogging);
                await refresh();

            });

            if (err) {

                setError(err instanceof Error ? err.message : String(err));
                setBusy(false);

                return;

            }

            showToast({
                message: 'Logging settings saved',
                variant: 'success',
            });
            back();

        },
        [settingsManager, refresh, showToast, back],
    );

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    return (
        <Panel title="Logging Settings" paddingX={2} paddingY={1}>
            <Form
                fields={fields}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                submitLabel="Save"
                focusLabel="SettingsLoggingForm"
                busy={busy}
                busyLabel="Saving..."
                statusError={error ?? undefined}
            />
        </Panel>
    );

}
