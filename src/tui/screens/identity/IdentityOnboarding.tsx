/**
 * Identity setup shown in place of a screen that saves state. State is
 * encrypted with the private key, so asking when the screen opens spares the
 * user a form whose result could not be stored.
 */
import { useState, useCallback, useEffect } from 'react';
import { Text } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ComponentType, ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { CryptoIdentityInput } from '../../../core/identity/index.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useFocusedInput } from '../../keyboard.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Spinner } from '../../components/index.js';
import { IdentitySetup } from '../init/IdentitySetup.js';
import {
    ensureIdentity,
    getPrivateKeyPath,
    loadIdentityMetadata,
    loadPrivateKey,
} from '../../../core/identity/index.js';
import { getErrorMessage } from '../../utils/index.js';
import { Hotkey } from '../../components/layout/Hotkey.js';

/**
 * - `checking`: reading what is on disk
 * - `form`: asking for name and email
 * - `working`: writing the identity
 * - `unreadable`: a private key exists and cannot be loaded
 */
type OnboardingStep = 'checking' | 'form' | 'working' | 'unreadable';

/**
 * Shown when `identity.key` exists and will not load. Offering setup here
 * would be offering to replace the key every saved config is encrypted with.
 */
function PrivateKeyUnreadable({ reason }: { reason: string }): ReactElement {

    const { back } = useRouter();
    const { isFocused } = useFocusScope('PrivateKeyUnreadable');

    useFocusedInput(isFocused, (_input, key) => {

        if (key.escape) back();

    });

    return (
        <Panel title="Identity" borderColor="red">
            <Text color="red">✘ {reason}</Text>
            <Text>Your private key was left as it is. Fix the file, then open this screen again.</Text>
            <Hotkey keys="Esc">Back</Hotkey>
        </Panel>
    );

}

/**
 * Completes the identity and hands its key to the running app. It does not
 * navigate on success: the caller stops rendering it once the app context
 * reports an identity. Cancelling goes back and creates nothing.
 *
 * @example
 * if (!hasIdentity) return <IdentityOnboarding />;
 */
export function IdentityOnboarding(): ReactElement {

    const { back } = useRouter();
    const { stateManager, refresh } = useAppContext();

    const [step, setStep] = useState<OnboardingStep>('checking');
    const [error, setError] = useState<string | null>(null);

    const complete = useCallback(
        async (input: CryptoIdentityInput) => {

            setStep('working');
            setError(null);

            const [, err] = await attempt(async () => {

                await ensureIdentity(input);

                // The state manager was built before the key could be loaded.
                const loaded = await stateManager?.reloadPrivateKey();

                if (!loaded) {

                    throw new Error(`Could not load the private key from ${getPrivateKeyPath()}`);

                }

                await refresh();

            });

            if (err) setError(getErrorMessage(err));

            setStep('form');

        },
        [stateManager, refresh],
    );

    useEffect(() => {

        const check = async () => {

            const [privateKey, keyErr] = await attempt(() => loadPrivateKey());

            if (keyErr) {

                setError(keyErr.message);
                setStep('unreadable');

                return;

            }

            const [metadata] = await attempt(() => loadIdentityMetadata());

            // Nothing to ask: name and email are already on disk.
            if (privateKey && metadata) {

                await complete(metadata);

                return;

            }

            setStep('form');

        };

        check();

    }, [complete]);

    if (step === 'unreadable') {

        return <PrivateKeyUnreadable reason={error ?? ''} />;

    }

    if (step === 'checking' || step === 'working') {

        return (
            <Panel title="Identity">
                <Spinner label={step === 'checking' ? 'Checking identity...' : 'Setting up identity...'} />
            </Panel>
        );

    }

    return (
        <IdentitySetup
            onComplete={complete}
            onCancel={back}
            reason="Saving a config needs an identity. Set it up once to continue."
            error={error ?? undefined}
        />
    );

}

/**
 * Puts identity setup in front of a screen that saves state. The route does
 * not change, so finishing setup lands on the screen the user asked for.
 * Waits for the app context to load: until then every identity reads as absent.
 *
 * @example
 * 'config/add': { component: requireIdentity(ConfigAddScreen), label: 'Add Config' },
 */
export function requireIdentity(Screen: ComponentType<ScreenProps>): ComponentType<ScreenProps> {

    return function IdentityGatedScreen(props: ScreenProps): ReactElement {

        const { loadingStatus, hasIdentity, stateManager } = useAppContext();
        const canSaveState = hasIdentity && stateManager?.hasPrivateKey();

        if (loadingStatus === 'ready' && !canSaveState) {

            return <IdentityOnboarding />;

        }

        return <Screen {...props} />;

    };

}
