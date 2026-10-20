/**
 * SettingsPathsScreen - edit path configuration.
 *
 * Configure paths for schema and change files.
 *
 * @example
 * ```bash
 * noorm settings paths    # Edit path settings
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
import { DEFAULT_CHANGES_PATH, DEFAULT_SQL_PATH } from '../../../core/settings/defaults.js';

/**
 * SettingsPathsScreen component.
 */
export function SettingsPathsScreen({ params: _params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { settingsManager } = useAppContext();

    const { execute, busy, error } = useSettingsOperation(
        async (mgr, data: { sql: string; changes: string }) => mgr.setPaths(data),
        'Path settings saved',
    );

    // Get current paths config
    const paths = useMemo(() => {

        if (!settingsManager) return { sql: DEFAULT_SQL_PATH, changes: DEFAULT_CHANGES_PATH };

        return settingsManager.getPaths();

    }, [settingsManager]);

    // Form fields
    const fields: FormField[] = useMemo(
        () => [
            {
                key: 'sql',
                label: 'SQL Path',
                type: 'text',
                defaultValue: paths.sql ?? DEFAULT_SQL_PATH,
                placeholder: DEFAULT_SQL_PATH,
            },
            {
                key: 'changes',
                label: 'Changes Path',
                type: 'text',
                defaultValue: paths.changes ?? DEFAULT_CHANGES_PATH,
                placeholder: DEFAULT_CHANGES_PATH,
            },
        ],
        [paths],
    );

    // Handle form submission
    const handleSubmit = useCallback(
        async (values: FormValues) => {

            await execute({
                sql: String(values['sql'] || DEFAULT_SQL_PATH),
                changes: String(values['changes'] || DEFAULT_CHANGES_PATH),
            });

        },
        [execute],
    );

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    return (
        <Panel title="Path Settings" paddingX={2} paddingY={1}>
            <Box flexDirection="column" gap={1}>
                <Box flexDirection="column">
                    <Text dimColor>
                        Set default directories for your project's SQL schema and change files.
                    </Text>
                    <Text dimColor>
                        These paths are used by all team members unless overridden per-config.
                    </Text>
                </Box>
            </Box>
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
