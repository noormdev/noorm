/**
 * SettingsStageEditScreen - add or edit a stage definition.
 *
 * Stages are config templates with defaults and required secrets.
 *
 * @example
 * ```bash
 * noorm settings stages add      # Add new stage
 * noorm settings stages edit dev # Edit 'dev' stage
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Text } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { FormValues, FormField } from '../../components/index.js';
import type { Stage } from '../../../core/settings/types.js';

import { useRouter } from '../../router.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Form, useToast } from '../../components/index.js';

/**
 * SettingsStageEditScreen component.
 */
export function SettingsStageEditScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { settingsManager, refresh } = useAppContext();
    const { showToast } = useToast();

    const stageName = params.name;
    const isAddMode = !stageName;

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Get existing stage if editing
    const existingStage = useMemo(() => {

        if (!settingsManager || !stageName) return null;

        return settingsManager.getStage(stageName);

    }, [settingsManager, stageName]);

    // Get all stage names for validation
    const existingStageNames = useMemo(() => {

        if (!settingsManager) return [];

        return Object.keys(settingsManager.getStages());

    }, [settingsManager]);

    // Form fields
    const fields: FormField[] = useMemo(() => {

        const defaults = existingStage?.defaults ?? {};

        return [
            {
                key: 'name',
                label: 'Stage Name',
                type: 'text',
                required: true,
                defaultValue: stageName ?? '',
                placeholder: 'e.g., dev, staging, prod',
                validate: (value) => {

                    if (typeof value !== 'string') return 'Name is required';

                    if (!/^[a-z0-9_-]+$/i.test(value)) {

                        return 'Only letters, numbers, hyphens, underscores';

                    }

                    // Check for duplicates (only in add mode or if name changed)
                    if (isAddMode && existingStageNames.includes(value)) {

                        return 'Stage already exists';

                    }

                    return undefined;

                },
            },
            {
                key: 'description',
                label: 'Description',
                type: 'text',
                defaultValue: existingStage?.description ?? '',
                placeholder: 'e.g., Production database',
            },
            {
                key: 'locked',
                label: 'Locked (prevent config deletion)',
                type: 'checkbox',
                defaultValue: existingStage?.locked ?? false,
            },
            {
                key: 'dialect',
                label: 'Default Dialect',
                type: 'select',
                options: [
                    { label: '(none)', value: '' },
                    { label: 'PostgreSQL', value: 'postgres' },
                    { label: 'MySQL', value: 'mysql' },
                    { label: 'SQLite', value: 'sqlite' },
                    { label: 'MSSQL', value: 'mssql' },
                ],
                defaultValue: defaults.dialect ?? '',
            },
            {
                key: 'host',
                label: 'Default Host',
                type: 'text',
                defaultValue: defaults.host ?? '',
                placeholder: 'localhost',
            },
            {
                key: 'port',
                label: 'Default Port',
                type: 'text',
                defaultValue: defaults.port ? String(defaults.port) : '',
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
                label: 'Default Database',
                type: 'text',
                defaultValue: defaults.database ?? '',
                placeholder: 'myapp_dev',
            },
            {
                key: 'user',
                label: 'Default User',
                type: 'text',
                defaultValue: defaults.user ?? '',
                placeholder: 'postgres',
            },
            {
                key: 'isTest',
                label: 'Default: Test Database',
                type: 'checkbox',
                defaultValue: defaults.isTest ?? false,
            },
            {
                key: 'protected',
                label: 'Default: Protected (enforce)',
                type: 'checkbox',
                defaultValue: defaults.protected ?? false,
            },
        ];

    }, [existingStage, stageName, isAddMode, existingStageNames]);

    // Handle form submission
    const handleSubmit = useCallback(
        async (values: FormValues) => {

            if (!settingsManager) {

                setError('Settings manager not available');

                return;

            }

            const name = String(values['name']);

            if (!name) {

                setError('Stage name is required');

                return;

            }

            setBusy(true);
            setError(null);

            // Build defaults object (only include non-empty values)
            const defaults: Stage['defaults'] = {};

            if (values['dialect'])
                defaults.dialect = String(values['dialect']) as
                    | 'postgres'
                    | 'mysql'
                    | 'sqlite'
                    | 'mssql';
            if (values['host']) defaults.host = String(values['host']);
            if (values['port']) defaults.port = parseInt(String(values['port']), 10);
            if (values['database']) defaults.database = String(values['database']);
            if (values['user']) defaults.user = String(values['user']);

            if (values['isTest']) defaults.isTest = true;
            if (values['protected']) defaults.protected = true;

            const stage: Stage = {
                description: values['description'] ? String(values['description']) : undefined,
                locked: Boolean(values['locked']),
                defaults: Object.keys(defaults).length > 0 ? defaults : undefined,
                // Preserve existing secrets
                secrets: existingStage?.secrets,
            };

            const [_, err] = await attempt(async () => {

                // If name changed during edit, remove old stage
                if (stageName && stageName !== name) {

                    await settingsManager.removeStage(stageName);

                }

                await settingsManager.setStage(name, stage);
                await refresh();

            });

            if (err) {

                setError(err instanceof Error ? err.message : String(err));
                setBusy(false);

                return;

            }

            showToast({
                message: isAddMode ? `Stage "${name}" created` : `Stage "${name}" updated`,
                variant: 'success',
            });
            back();

        },
        [settingsManager, stageName, existingStage, isAddMode, refresh, showToast, back],
    );

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Editing non-existent stage
    if (!isAddMode && !existingStage) {

        return (
            <Panel title="Edit Stage" paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">Stage "{stageName}" not found.</Text>
            </Panel>
        );

    }

    return (
        <Panel
            title={isAddMode ? 'Add Stage' : `Edit Stage: ${stageName}`}
            paddingX={2}
            paddingY={1}
        >
            <Form
                fields={fields}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                submitLabel={isAddMode ? 'Create Stage' : 'Save Changes'}
                focusLabel="SettingsStageEditForm"
                busy={busy}
                busyLabel="Saving..."
                statusError={error ?? undefined}
            />
        </Panel>
    );

}
