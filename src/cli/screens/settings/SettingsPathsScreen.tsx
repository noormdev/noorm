/**
 * SettingsPathsScreen - edit path configuration.
 *
 * Configure paths for schema and changeset files.
 *
 * @example
 * ```bash
 * noorm settings paths    # Edit path settings
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
 * SettingsPathsScreen component.
 */
export function SettingsPathsScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { settingsManager, refresh } = useAppContext();
    const { showToast } = useToast();

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Get current paths config
    const paths = useMemo(() => {

        if (!settingsManager) return { schema: './schema', changesets: './changesets' };

        return settingsManager.getPaths();

    }, [settingsManager]);

    // Form fields
    const fields: FormField[] = useMemo(
        () => [
            {
                key: 'schema',
                label: 'Schema Path',
                type: 'text',
                defaultValue: paths.schema ?? './schema',
                placeholder: './schema',
            },
            {
                key: 'changesets',
                label: 'Changesets Path',
                type: 'text',
                defaultValue: paths.changesets ?? './changesets',
                placeholder: './changesets',
            },
        ],
        [paths],
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

            const newPaths = {
                schema: String(values['schema'] || './schema'),
                changesets: String(values['changesets'] || './changesets'),
            };

            const [_, err] = await attempt(async () => {

                await settingsManager.setPaths(newPaths);
                await refresh();

            });

            if (err) {

                setError(err instanceof Error ? err.message : String(err));
                setBusy(false);

                return;

            }

            showToast({
                message: 'Path settings saved',
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
        <Panel title="Path Settings" paddingX={2} paddingY={1}>
            <Form
                fields={fields}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                submitLabel="Save"
                focusLabel="SettingsPathsForm"
                busy={busy}
                busyLabel="Saving..."
                statusError={error ?? undefined}
            />
        </Panel>
    );

}
