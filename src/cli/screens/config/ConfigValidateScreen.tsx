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
import { testConnection } from '../../../core/connection/factory.js';

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

            const results: StatusListItem[] = [];
            let allValid = true;

            // Check connection
            results.push({
                key: 'connection',
                label: 'Connection',
                status: 'pending',
                detail: 'Testing database connection...',
            });
            setItems([...results]);

            const connResult = await testConnection(config.connection);

            if (connResult.ok) {

                results[0] = {
                    ...results[0]!,
                    status: 'success',
                    detail: 'Connection successful',
                };

            }
            else {

                results[0] = {
                    ...results[0]!,
                    status: 'error',
                    detail: connResult.error ?? 'Connection failed',
                };
                allValid = false;

            }
            setItems([...results]);

            // Check required fields
            const requiredChecks = [
                { key: 'name', label: 'Name', value: config.name },
                { key: 'database', label: 'Database', value: config.connection.database },
                { key: 'schemaPath', label: 'Schema Path', value: config.paths.schema },
                { key: 'changesetsPath', label: 'Changesets Path', value: config.paths.changesets },
            ];

            for (const check of requiredChecks) {

                const isSet = Boolean(check.value);
                results.push({
                    key: check.key,
                    label: check.label,
                    status: isSet ? 'success' : 'error',
                    detail: isSet ? check.value : 'Not set',
                });

                if (!isSet) allValid = false;

            }
            setItems([...results]);

            // Check host for non-SQLite
            if (config.connection.dialect !== 'sqlite') {

                const hasHost = Boolean(config.connection.host);
                results.push({
                    key: 'host',
                    label: 'Host',
                    status: hasHost ? 'success' : 'error',
                    detail: hasHost ? config.connection.host! : 'Not set',
                });

                if (!hasHost) allValid = false;
                setItems([...results]);

            }

            // Check secrets (if any are defined for this config)
            const secrets = stateManager.listSecrets(configName);

            if (secrets.length > 0) {

                results.push({
                    key: 'secrets',
                    label: 'Secrets',
                    status: 'success',
                    detail: `${secrets.length} secret(s) configured`,
                });
                setItems([...results]);

            }

            setIsValid(allValid);
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
            else if (input === 's') {

                // Navigate to secrets
                navigate('secret', { name: configName });

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

                <Box marginTop={1} gap={2}>
                    <Text dimColor>[e] Edit</Text>
                    <Text dimColor>[s] Secrets</Text>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        </Panel>
    );

}
