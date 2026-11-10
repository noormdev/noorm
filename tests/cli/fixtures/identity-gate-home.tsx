/**
 * Child process for `identity-gate-home.test.ts`: renders a screen behind
 * `requireIdentity` against the real identity and state modules. `~/.noorm` is
 * resolved from `homedir()` at import, so the parent repoints HOME.
 *
 * `show` prints the frame the gate settles on. `continue` also submits the
 * setup form and prints the frame after it.
 */
import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';

import { FocusProvider } from '../../../src/tui/focus.js';
import { RouterProvider } from '../../../src/tui/router.js';
import { AppContextProvider } from '../../../src/tui/app-context.js';
import { ToastProvider } from '../../../src/tui/components/index.js';
import { requireIdentity } from '../../../src/tui/screens/identity/IdentityOnboarding.js';
import { drive, refuseOutsideThrowawayHome } from './home-child.js';

refuseOutsideThrowawayHome();

const [mode] = process.argv.slice(2);

const GATED = 'the screen behind the gate';
const Gated = requireIdentity(() => <Text>{GATED}</Text>);

const screen = render(
    <FocusProvider>
        <RouterProvider initialRoute="config/add">
            <AppContextProvider projectRoot={process.cwd()}>
                <ToastProvider>
                    <Gated params={{}} />
                </ToastProvider>
            </AppContextProvider>
        </RouterProvider>
    </FocusProvider>,
);

const { frame, waitFor, pressUntil } = drive(screen);

// The gated screen also renders while the app context loads, so only the
// gate's own output says it has decided.
await waitFor(() => frame().includes('[ Continue ]') || frame().includes('[Esc] Back'));

if (mode === 'continue') {

    await pressUntil('\x1B[A', () => frame().includes('❯ [ Continue ]'));
    await pressUntil('\r', () => frame().includes(GATED));

}

process.stdout.write(frame());
screen.unmount();
process.exit(0);
