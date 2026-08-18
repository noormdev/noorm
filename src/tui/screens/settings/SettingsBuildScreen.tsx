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
import { useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { FormValues, FormField } from '../../components/index.js';

import { useRouter } from '../../router.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Form } from '../../components/index.js';
import { useSettingsOperation } from '../../hooks/index.js';
import { DEFAULT_PATH_CONFIG } from '../../../core/settings/defaults.js';

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
    const { settingsManager } = useAppContext();

    const { execute, busy, error } = useSettingsOperation(
        async (mgr, data: { include: string[]; exclude: string[] }) => mgr.setBuild(data),
        'Build settings saved',
    );

    // Get current build config
    const build = useMemo(() => {

        if (!settingsManager) return { include: [], exclude: [] };

        return settingsManager.getBuild();

    }, [settingsManager]);

    // Get current SQL path
    const sqlPath = useMemo(() => {

        if (!settingsManager) return DEFAULT_PATH_CONFIG.sql ?? './sql';

        const paths = settingsManager.getPaths();

        return paths.sql ?? DEFAULT_PATH_CONFIG.sql ?? './sql';

    }, [settingsManager]);

    // Form fields
    const fields: FormField[] = useMemo(
        () => [
            {
                key: 'include',
                label: 'Include Paths',
                hint: '(comma-separated)',
                type: 'text',
                defaultValue: formatPathList(build.include),
                placeholder: 'tables, views, functions',
            },
            {
                key: 'exclude',
                label: 'Exclude Paths',
                hint: '(comma-separated)',
                type: 'text',
                defaultValue: formatPathList(build.exclude),
                placeholder: 'archive, experiments',
            },
        ],
        [build],
    );

    // Handle form submission
    const handleSubmit = useCallback(
        async (values: FormValues) => {

            await execute({
                include: parsePathList(values['include']),
                exclude: parsePathList(values['exclude']),
            });

        },
        [execute],
    );

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    return (
        <Panel title="Build Settings" paddingX={2} paddingY={1}>
            <Box flexDirection="column" gap={1}>
                <Box flexDirection="column">
                    <Text dimColor>
                        Control which folders are included when building your schema.
                    </Text>
                    <Text dimColor>
                        Include patterns add folders; exclude patterns remove them from the build.
                    </Text>
                    <Text dimColor>
                        Paths are relative to: <Text bold>{sqlPath}</Text>
                    </Text>
                </Box>
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
            </Box>
        </Panel>
    );

}
