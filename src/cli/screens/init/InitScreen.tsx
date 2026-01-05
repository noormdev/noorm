/**
 * Init screen - main initialization flow.
 *
 * Orchestrates the initialization process:
 * 1. Check if already initialized (error unless --force)
 * 2. Setup identity if needed
 * 3. Setup project structure
 * 4. Optionally add first config
 *
 * Creates:
 * - sql/ and changes/ directories
 * - .noorm/settings.yml
 * - .noorm/state.enc
 * - Keypair in ~/.noorm/
 */
import { useState, useEffect, useCallback } from 'react';
import type { ReactElement } from 'react';
import { Box, Text } from 'ink';
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'fs';
import { useInput } from 'ink';
import { join } from 'path';
import { attempt } from '@logosdx/utils';

import type { ScreenProps } from '../../types.js';
import { useRouter } from '../../router.js';
import { useAppContext } from '../../app-context.js';
import { Panel } from '../../components/layout/index.js';
import { Spinner, Alert } from '../../components/feedback/index.js';
import { Confirm } from '../../components/dialogs/index.js';
import { StatusList } from '../../components/lists/index.js';

import { IdentitySetup, type IdentitySetupValues } from './IdentitySetup.js';
import { ProjectSetup } from './ProjectSetup.js';

import {
    createCryptoIdentity,
    createIdentityForExistingKeys,
    hasKeyFiles,
    loadIdentityMetadata,
} from '../../../core/identity/index.js';
import { SettingsManager } from '../../../core/settings/manager.js';
import { StateManager, getStateManager } from '../../../core/state/index.js';
import { observer } from '../../../core/observer.js';

/**
 * Init step in the flow.
 */
type InitStep =
    | 'check' // Checking existing state
    | 'already-init' // Already initialized, show error/confirm
    | 'identity' // Identity setup step
    | 'project' // Project setup step
    | 'creating' // Creating files
    | 'complete' // All done
    | 'error'; // Error occurred

/**
 * Status item for progress display.
 */
interface StatusItem {
    label: string;
    status: 'pending' | 'running' | 'success' | 'error';
    detail?: string;
}

/**
 * Init screen component.
 *
 * Main initialization flow that handles identity and project setup.
 */
export function InitScreen({ params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    // Note: No useFocusScope here - let child components manage their own focus.
    // We use useInput directly for the complete/error steps.
    const { refresh } = useAppContext();

    // Get force flag from params (--force/-f flag) OR from user confirmation
    const forceFromParams = Boolean(params.force);
    const [forceConfirmed, setForceConfirmed] = useState(false);
    const force = forceFromParams || forceConfirmed;

    // Current step
    const [step, setStep] = useState<InitStep>('check');
    const [error, setError] = useState<Error | null>(null);

    // Identity values (from identity setup step)
    const [identityValues, setIdentityValues] = useState<IdentitySetupValues | null>(null);

    // Whether identity key files already exist
    const [hasExistingKeys, setHasExistingKeys] = useState(false);

    // Whether identity metadata already exists (for reusing identity across projects)
    const [hasExistingMetadata, setHasExistingMetadata] = useState(false);

    // Progress items for creation step
    const [progressItems, setProgressItems] = useState<StatusItem[]>([]);

    // Whether to add config after init
    const [shouldAddConfig, setShouldAddConfig] = useState(false);

    // Project root
    const projectRoot = process.cwd();

    // Check existing state on mount
    useEffect(() => {

        const checkExisting = async () => {

            // Check if .noorm directory exists
            const noormDir = join(projectRoot, '.noorm');
            const alreadyInitialized = existsSync(noormDir);

            // Check if identity key files exist
            const keysExist = await hasKeyFiles();
            setHasExistingKeys(keysExist);

            // Check if identity metadata exists (allows reusing identity across projects)
            const metadata = await loadIdentityMetadata();
            const metadataExists = metadata !== null;
            setHasExistingMetadata(metadataExists);

            if (alreadyInitialized && !force) {

                setStep('already-init');

            }
            else if (keysExist && metadataExists) {

                // Full identity exists - skip identity setup, go directly to project
                setStep('project');

            }
            else {

                // Need identity setup
                // (either no keys at all, or keys exist but missing metadata)
                setStep('identity');

            }

        };

        checkExisting();

    }, [projectRoot, force]);

    // Handle identity setup complete
    const handleIdentityComplete = useCallback((values: IdentitySetupValues) => {

        setIdentityValues(values);
        setStep('project');

    }, []);

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Handle already init confirmation
    const handleForceInit = useCallback(() => {

        // User confirmed reinitialize - set force flag
        setForceConfirmed(true);

        if (hasExistingKeys && hasExistingMetadata) {

            // Full identity exists - can skip identity setup
            setStep('project');

        }
        else {

            // Need to collect identity info
            setStep('identity');

        }

    }, [hasExistingKeys, hasExistingMetadata]);

    // Perform the actual initialization (defined before handlers that use it)
    const performInit = useCallback(async () => {

        setStep('creating');

        const items: StatusItem[] = [
            { label: 'Creating directories', status: 'pending' },
            { label: 'Generating keypair', status: 'pending' },
            { label: 'Creating settings.yml', status: 'pending' },
            { label: 'Initializing state', status: 'pending' },
            { label: 'Updating .gitignore', status: 'pending' },
        ];

        // Skip keypair generation if keys already exist
        if (hasExistingKeys) {

            items.splice(1, 1);

        }

        setProgressItems([...items]);

        // Helper to update progress items
        const updateItem = (index: number, update: Partial<StatusItem>) => {

            const existing = items[index];

            if (existing) {

                items[index] = { ...existing, ...update };
                setProgressItems([...items]);

            }

        };

        const [, initErr] = await attempt(async () => {

            // Step 1: Create directories
            updateItem(0, { status: 'running' });

            const sqlPath = join(projectRoot, 'sql');
            const changesPath = join(projectRoot, 'changes');
            const noormPath = join(projectRoot, '.noorm');

            mkdirSync(sqlPath, { recursive: true });
            writeFileSync(join(sqlPath, '.gitkeep'), '', { flag: 'a' });

            mkdirSync(changesPath, { recursive: true });
            writeFileSync(join(changesPath, '.gitkeep'), '', { flag: 'a' });

            mkdirSync(noormPath, { recursive: true });

            updateItem(0, { status: 'success' });

            // Step 2: Generate keypair (if needed)
            let keypairIndex = 1;
            let privateKey: string | undefined;

            if (!hasExistingKeys && identityValues) {

                // No keys exist - generate new keypair
                updateItem(keypairIndex, { status: 'running' });

                const [result, err] = await attempt(() =>
                    createCryptoIdentity({
                        name: identityValues.name,
                        email: identityValues.email,
                        machine: identityValues.machine,
                    }),
                );

                if (err) {

                    updateItem(keypairIndex, { status: 'error', detail: err.message });
                    throw err;

                }

                privateKey = result!.keypair.privateKey;

                updateItem(keypairIndex, { status: 'success' });
                keypairIndex++;

            }
            else {

                keypairIndex = 1;

            }

            // Step 3: Create settings.yml
            const settingsIndex = hasExistingKeys ? 1 : 2;
            updateItem(settingsIndex, { status: 'running' });

            const settingsManager = new SettingsManager(projectRoot);
            await settingsManager.init(force);

            updateItem(settingsIndex, { status: 'success' });

            // Step 4: Initialize state
            const stateIndex = hasExistingKeys ? 2 : 3;
            updateItem(stateIndex, { status: 'running' });

            const stateManager = new StateManager(projectRoot, {
                privateKey,
            });
            await stateManager.load();

            // Identity is saved to global ~/.noorm/ by createCryptoIdentity() and
            // createIdentityForExistingKeys(). We just need to refresh the app context
            // to pick it up. No per-project state.identity needed.
            //
            // Scenarios:
            // 1. No keys existed, user filled form: createCryptoIdentity() saved identity globally
            // 2. Keys existed but no metadata, user filled form: createIdentityForExistingKeys() saved metadata
            // 3. Keys + metadata existed: Nothing to do, identity already exists globally
            if (hasExistingKeys && identityValues && !hasExistingMetadata) {

                // Case 2: Keys exist but user filled form (metadata was missing)
                // Create identity using existing public key - saves metadata globally
                await createIdentityForExistingKeys({
                    name: identityValues.name,
                    email: identityValues.email,
                    machine: identityValues.machine,
                });

            }

            updateItem(stateIndex, { status: 'success' });

            // Step 5: Update .gitignore
            const gitignoreIndex = hasExistingKeys ? 3 : 4;
            updateItem(gitignoreIndex, { status: 'running' });

            const gitignorePath = join(projectRoot, '.gitignore');
            const gitignoreEntries = '\n# noorm\n.noorm/state.enc\n.noorm/*.log\n';

            if (existsSync(gitignorePath)) {

                const existing = readFileSync(gitignorePath, 'utf-8');

                if (!existing.includes('.noorm/state.enc')) {

                    appendFileSync(gitignorePath, gitignoreEntries);

                }

            }
            else {

                writeFileSync(gitignorePath, gitignoreEntries.trimStart());

            }

            updateItem(gitignoreIndex, { status: 'success' });

            // Emit init complete event
            observer.emit('init:complete', {
                projectRoot,
                hasIdentity: !hasExistingKeys,
            });

            // Reload private key on singleton so app context can encrypt/decrypt
            // The singleton may have been created before identity files existed
            const singleton = getStateManager(projectRoot);
            await singleton.reloadPrivateKey();

            // Refresh app context
            await refresh();

        });

        if (initErr) {

            setError(initErr instanceof Error ? initErr : new Error(String(initErr)));
            setStep('error');

            return;

        }

        setStep('complete');

    }, [projectRoot, identityValues, hasExistingKeys, hasExistingMetadata, force, refresh]);

    // Handle project setup - add config
    const handleAddConfig = useCallback(async () => {

        setShouldAddConfig(true);
        await performInit();

    }, [performInit]);

    // Handle project setup - skip config
    const handleSkipConfig = useCallback(async () => {

        setShouldAddConfig(false);
        await performInit();

    }, [performInit]);

    // Handle complete - navigate to config add or home
    const handleComplete = useCallback(() => {

        if (shouldAddConfig) {

            navigate('config/add', { fromInit: true });

        }
        else {

            navigate('home');

        }

    }, [navigate, shouldAddConfig]);

    // Keyboard handling for complete and error steps
    // Using useInput directly since we don't need focus stack for these terminal states
    useInput((input, key) => {

        // Only handle input in terminal states
        if (step !== 'complete' && step !== 'error') return;

        if (step === 'complete') {

            if (key.return || input === ' ') {

                handleComplete();

            }

        }
        else if (step === 'error') {

            if (key.return || key.escape) {

                back();

            }

        }

    });

    // Render based on step
    switch (step) {

    case 'check':
        return (
            <Box flexDirection="column" padding={1}>
                <Spinner label="Checking existing state..." />
            </Box>
        );

    case 'already-init':
        return (
            <Box flexDirection="column" padding={1}>
                <Confirm
                    title="Already Initialized"
                    message="This project has already been initialized. Do you want to reinitialize? This will overwrite existing settings."
                    onConfirm={handleForceInit}
                    onCancel={handleCancel}
                    variant="warning"
                />
            </Box>
        );

    case 'identity':
        return (
            <Box flexDirection="column" padding={1}>
                <IdentitySetup onComplete={handleIdentityComplete} onCancel={handleCancel} />
            </Box>
        );

    case 'project':
        return (
            <Box flexDirection="column" padding={1}>
                <ProjectSetup
                    onAddConfig={handleAddConfig}
                    onSkipConfig={handleSkipConfig}
                    onCancel={handleCancel}
                />
            </Box>
        );

    case 'creating':
        return (
            <Box flexDirection="column" padding={1}>
                <Panel title="Initializing..." titleColor="cyan">
                    <StatusList items={progressItems} />
                </Panel>
            </Box>
        );

    case 'complete':
        return (
            <Box flexDirection="column" padding={1}>
                <Panel title="Initialization Complete" titleColor="green">
                    <Box flexDirection="column">
                        <Text color="green">noorm has been initialized successfully.</Text>
                        <Box marginTop={1} flexDirection="column">
                            <Text dimColor>Created:</Text>
                            <Box flexDirection="column" marginLeft={2}>
                                <Text>• sql/.gitkeep</Text>
                                <Text>• changes/.gitkeep</Text>
                                <Text>• .noorm/settings.yml</Text>
                                <Text>• .noorm/state.enc</Text>
                                {!hasExistingKeys && (
                                    <>
                                        <Text>• ~/.noorm/identity.key</Text>
                                        <Text>• ~/.noorm/identity.pub</Text>
                                    </>
                                )}
                            </Box>
                        </Box>
                        {shouldAddConfig && (
                            <Box marginTop={1}>
                                <Text>
                                        Press <Text color="cyan">Enter</Text> to add your first
                                        database config.
                                </Text>
                            </Box>
                        )}
                        {!shouldAddConfig && (
                            <Box marginTop={1}>
                                <Text>
                                        Press <Text color="cyan">Enter</Text> to go to home screen.
                                </Text>
                            </Box>
                        )}
                    </Box>
                </Panel>
            </Box>
        );

    case 'error':
        return (
            <Box flexDirection="column" padding={1}>
                <Alert variant="error">
                    <Text>Initialization failed: {error?.message}</Text>
                </Alert>
                <Box marginTop={1}>
                    <Text dimColor>Press Enter or Esc to go back.</Text>
                </Box>
            </Box>
        );

    default:
        return <Box />;

    }

}
