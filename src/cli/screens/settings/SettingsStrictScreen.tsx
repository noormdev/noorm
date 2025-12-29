/**
 * SettingsStrictScreen - edit strict mode configuration.
 *
 * Configure whether strict mode is enabled and which stages are required.
 *
 * @example
 * ```bash
 * noorm settings strict    # Edit strict mode settings
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
 * Parse comma-separated string to array.
 */
function parseStageList(value: unknown): string[] {

    if (typeof value !== 'string' || !value.trim()) return [];

    return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

}

/**
 * Format array to comma-separated string.
 */
function formatStageList(stages: string[] | undefined): string {

    if (!stages || stages.length === 0) return '';

    return stages.join(', ');

}

/**
 * SettingsStrictScreen component.
 */
export function SettingsStrictScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { settingsManager, refresh } = useAppContext();
    const { showToast } = useToast();

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Get current strict config
    const strict = useMemo(() => {

        if (!settingsManager) return { enabled: false, stages: [] };

        return settingsManager.getStrict();

    }, [settingsManager]);

    // Form fields
    const fields: FormField[] = useMemo(
        () => [
            {
                key: 'enabled',
                label: 'Enable Strict Mode',
                type: 'checkbox',
                defaultValue: strict.enabled ?? false,
            },
            {
                key: 'stages',
                label: 'Required Stages (comma-separated)',
                type: 'text',
                defaultValue: formatStageList(strict.stages),
                placeholder: 'dev, staging, prod',
            },
        ],
        [strict],
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

            const newStrict = {
                enabled: Boolean(values['enabled']),
                stages: parseStageList(values['stages']),
            };

            const [_, err] = await attempt(async () => {

                await settingsManager.setStrict(newStrict);
                await refresh();

            });

            if (err) {

                setError(err instanceof Error ? err.message : String(err));
                setBusy(false);

                return;

            }

            showToast({
                message: 'Strict mode settings saved',
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
        <Panel title="Strict Mode Settings" paddingX={2} paddingY={1}>
            <Form
                fields={fields}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                submitLabel="Save"
                focusLabel="SettingsStrictForm"
                busy={busy}
                busyLabel="Saving..."
                statusError={error ?? undefined}
            />
        </Panel>
    );

}
