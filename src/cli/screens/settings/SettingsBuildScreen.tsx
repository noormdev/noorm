/**
 * SettingsBuildScreen - edit build configuration.
 *
 * Configure which folders to include/exclude from builds.
 * Paths are comma-separated.
 *
 * @example
 * ```bash
 * noorm settings build    # Edit build settings
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
function parsePathList(value: unknown): string[] {

    if (typeof value !== 'string' || !value.trim()) return [];

    return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

}

/**
 * Format array to comma-separated string.
 */
function formatPathList(paths: string[] | undefined): string {

    if (!paths || paths.length === 0) return '';

    return paths.join(', ');

}

/**
 * SettingsBuildScreen component.
 */
export function SettingsBuildScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { settingsManager, refresh } = useAppContext();
    const { showToast } = useToast();

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Get current build config
    const build = useMemo(() => {

        if (!settingsManager) return { include: ['schema'], exclude: [] };

        return settingsManager.getBuild();

    }, [settingsManager]);

    // Form fields
    const fields: FormField[] = useMemo(
        () => [
            {
                key: 'include',
                label: 'Include Paths (comma-separated)',
                type: 'text',
                defaultValue: formatPathList(build.include),
                placeholder: 'sql/tables, sql/views, sql/functions',
            },
            {
                key: 'exclude',
                label: 'Exclude Paths (comma-separated)',
                type: 'text',
                defaultValue: formatPathList(build.exclude),
                placeholder: 'sql/archive, sql/experiments',
            },
        ],
        [build],
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

            const newBuild = {
                include: parsePathList(values['include']),
                exclude: parsePathList(values['exclude']),
            };

            const [_, err] = await attempt(async () => {

                await settingsManager.setBuild(newBuild);
                await refresh();

            });

            if (err) {

                setError(err instanceof Error ? err.message : String(err));
                setBusy(false);

                return;

            }

            showToast({
                message: 'Build settings saved',
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
        <Panel title="Build Settings" paddingX={2} paddingY={1}>
            <Form
                fields={fields}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                submitLabel="Save"
                focusLabel="SettingsBuildForm"
                busy={busy}
                busyLabel="Saving..."
                statusError={error ?? undefined}
            />
        </Panel>
    );

}
