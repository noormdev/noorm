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
import { useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { FormValues, FormField } from '../../components/index.js';

import { useRouter } from '../../router.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Form } from '../../components/index.js';
import { useSettingsOperation } from '../../hooks/index.js';

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
    const { settingsManager } = useAppContext();

    const { execute, busy, error } = useSettingsOperation(
        async (mgr, data: { enabled: boolean; stages: string[] }) => mgr.setStrict(data),
        'Strict mode settings saved',
    );

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
                label: 'Required Stages',
                hint: '(comma-separated)',
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

            await execute({
                enabled: Boolean(values['enabled']),
                stages: parseStageList(values['stages']),
            });

        },
        [execute],
    );

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    return (
        <Panel title="Strict Mode Settings" paddingX={2} paddingY={1}>
            <Box flexDirection="column" gap={1}>
                <Box flexDirection="column">
                    <Text dimColor>
                        When enabled, operations like apply and revert require the config
                    </Text>
                    <Text dimColor>
                        to be linked to a stage. Required stages must all be defined before
                    </Text>
                    <Text dimColor>
                        any destructive operations are allowed.
                    </Text>
                </Box>
            </Box>
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
