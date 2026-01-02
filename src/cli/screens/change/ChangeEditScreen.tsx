/**
 * ChangeEditScreen - open change in system editor.
 *
 * Opens the change folder in the configured editor (or $EDITOR).
 *
 * @example
 * ```bash
 * noorm change:edit add-user-roles    # Open in editor
 * noorm change edit add-user-roles    # Same thing
 * ```
 */
import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'child_process';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';

import { attempt } from '@logosdx/utils';
import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner, StatusMessage } from '../../components/index.js';
import { discoverChanges } from '../../../core/change/parser.js';

/**
 * Edit steps.
 */
type EditStep =
    | 'loading' // Finding change
    | 'opening' // Opening editor
    | 'complete' // Success
    | 'error'; // Error occurred

/**
 * ChangeEditScreen component.
 */
export function ChangeEditScreen({ params }: ScreenProps): ReactElement {

    const { navigate: _navigate, back } = useRouter();
    const { isFocused } = useFocusScope('ChangeEdit');
    const { activeConfig, settings: _settings } = useAppContext();

    const changeName = params.name;

    const [step, setStep] = useState<EditStep>('loading');
    const [changePath, setChangePath] = useState('');
    const [error, setError] = useState<string | null>(null);

    // Find and open change
    useEffect(() => {

        if (!activeConfig || !changeName) {

            setStep('loading');

            return;

        }

        let cancelled = false;

        const openChange = async () => {

            const [_, err] = await attempt(async () => {

                // Find the change
                const changes = await discoverChanges(
                    activeConfig.paths.changes,
                    activeConfig.paths.sql,
                );

                const change = changes.find((cs) => cs.name === changeName);

                if (!change) {

                    throw new Error(`Change not found: ${changeName}`);

                }

                if (cancelled) return;

                setChangePath(change.path);
                setStep('opening');

                // Get editor from environment
                const editor = process.env['EDITOR'] || process.env['VISUAL'] || 'code';

                // Open in editor
                const child = spawn(editor, [change.path], {
                    detached: true,
                    stdio: 'ignore',
                });

                child.unref();

                setStep('complete');

            });

            if (err) {

                if (!cancelled) {

                    setError(err instanceof Error ? err.message : String(err));
                    setStep('error');

                }

            }

        };

        openChange();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, changeName]);

    // Keyboard handling
    useInput((_input, _key) => {

        if (!isFocused) return;

        if (step === 'complete' || step === 'error') {

            back();

        }

    });

    // No change name provided
    if (!changeName) {

        return (
            <Panel title="Edit Change" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No change name provided.</Text>
            </Panel>
        );

    }

    // No active config
    if (!activeConfig) {

        return (
            <Panel title="Edit Change" paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">No active configuration.</Text>
            </Panel>
        );

    }

    // Loading
    if (step === 'loading') {

        return (
            <Panel title="Edit Change" paddingX={2} paddingY={1}>
                <Spinner label="Finding change..." />
            </Panel>
        );

    }

    // Opening
    if (step === 'opening') {

        return (
            <Panel title="Edit Change" paddingX={2} paddingY={1}>
                <Spinner label="Opening in editor..." />
            </Panel>
        );

    }

    // Complete
    if (step === 'complete') {

        return (
            <Panel title="Edit Change" paddingX={2} paddingY={1} borderColor="green">
                <Box flexDirection="column" gap={1}>
                    <StatusMessage variant="success">
                        Opened "{changeName}" in editor
                    </StatusMessage>
                    <Text dimColor>Path: {changePath}</Text>
                    <Box marginTop={1}>
                        <Text dimColor>Press any key to continue...</Text>
                    </Box>
                </Box>
            </Panel>
        );

    }

    // Error
    return (
        <Panel title="Edit Change" paddingX={2} paddingY={1} borderColor="red">
            <Box flexDirection="column" gap={1}>
                <StatusMessage variant="error">{error}</StatusMessage>
                <Box marginTop={1}>
                    <Text dimColor>Press any key to continue...</Text>
                </Box>
            </Box>
        </Panel>
    );

}
