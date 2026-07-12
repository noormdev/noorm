/**
 * ConfigValidateScreen - validate configuration completeness.
 *
 * Shows status of a config including:
 * - Connection testability
 * - Required secrets status (if stage-linked)
 * - Path existence
 *
 * @example
 * ```bash
 * noorm config:validate dev   # Validate 'dev' config
 * noorm config validate dev   # Same thing
 * ```
 */
import { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, StatusList, type StatusListItem } from '../../components/index.js';
import { validateConfigChecks } from '../../../core/config/validate.js';

/**
 * Validate steps.
 */
type ValidateStep =
    | 'validating' // Running validation
    | 'complete'; // Validation complete

/**
 * ConfigValidateScreen component.
 */
export function ConfigValidateScreen({ params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ConfigValidate');
    const { stateManager } = useAppContext();

    const configName = params.name;

    const [step, setStep] = useState<ValidateStep>('validating');
    const [items, setItems] = useState<StatusListItem[]>([]);
    const [isValid, setIsValid] = useState(true);

    // Get the config
    const config = useMemo(() => {

        if (!stateManager || !configName) return null;

        return stateManager.getConfig(configName);

    }, [stateManager, configName]);

    // Run validation on mount
    useEffect(() => {

        if (!stateManager || !configName || !config) return;

        const validate = async () => {

            const { checks, valid } = await validateConfigChecks(config);

            const results: StatusListItem[] = checks.map((check) => ({
                key: check.key,
                label: check.label,
                status: check.status,
                detail: check.detail,
            }));

            setItems(results);
            setIsValid(valid);
            setStep('complete');

        };

        validate();

    }, [stateManager, configName, config]);

    // Keyboard handling
    useInput((input, key) => {

        if (!isFocused) return;

        if (step === 'complete') {

            if (key.escape) {

                back();

            }
            else if (input === 'e') {

                // Navigate to edit
                navigate('config/edit', { name: configName });

            }

        }

    });

    // No config name provided
    if (!configName) {

        return (
            <Panel title="Validate Configuration" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">
                    No config name provided. Use: noorm config:validate &lt;name&gt;
                </Text>
            </Panel>
        );

    }

    // Config not found
    if (!config) {

        return (
            <Panel title="Validate Configuration" paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">Config "{configName}" not found.</Text>
            </Panel>
        );

    }

    // Validating
    if (step === 'validating' && items.length === 0) {

        return (
            <Panel title={`Validate: ${configName}`} paddingX={2} paddingY={1}>
                <Spinner label="Validating configuration..." />
            </Panel>
        );

    }

    // Show results
    const borderColor = isValid ? 'green' : 'red';
    const statusText = isValid ? 'VALID' : 'INCOMPLETE';
    const statusColor = isValid ? 'green' : 'red';

    return (
        <Panel
            title={`Validate: ${configName}`}
            paddingX={2}
            paddingY={1}
            borderColor={borderColor}
        >
            <Box flexDirection="column" gap={1}>
                <Box gap={1}>
                    <Text>Status:</Text>
                    <Text color={statusColor} bold>
                        {statusText}
                    </Text>
                </Box>

                <Box marginTop={1}>
                    <StatusList items={items} />
                </Box>

                <Box marginTop={1} flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[e] Edit</Text>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        </Panel>
    );

}
