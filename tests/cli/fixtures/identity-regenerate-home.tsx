/**
 * Child process for `identity-regenerate-home.test.ts`: confirms the warning
 * and submits the form on `IdentityInitScreen`. Prints `{ warning, result }`,
 * the warning frame and the frame after the form is submitted.
 */
import React from 'react';
import { render } from 'ink-testing-library';

import { FocusProvider } from '../../../src/tui/focus.js';
import { RouterProvider } from '../../../src/tui/router.js';
import { AppContextProvider, useAppContext } from '../../../src/tui/app-context.js';
import { ToastProvider } from '../../../src/tui/components/index.js';
import { IdentityInitScreen } from '../../../src/tui/screens/identity/index.js';
import { drive, refuseOutsideThrowawayHome } from './home-child.js';

refuseOutsideThrowawayHome();

// The screen picks its first step when it mounts, so it mounts once the
// identity on disk has loaded, as it does behind the identity screen.
function OnceIdentityLoaded() {

    const { hasIdentity } = useAppContext();

    return hasIdentity ? <IdentityInitScreen params={{}} /> : null;

}

const screen = render(
    <FocusProvider>
        <RouterProvider initialRoute="identity/init">
            <AppContextProvider projectRoot={process.cwd()}>
                <ToastProvider>
                    <OnceIdentityLoaded />
                </ToastProvider>
            </AppContextProvider>
        </RouterProvider>
    </FocusProvider>,
);

const { frame, waitFor, pressUntil } = drive(screen);

await waitFor(() => frame().includes('[Enter] Continue'));

const warning = frame();

await pressUntil('\r', () => frame().includes('[ Regenerate ]'));
await pressUntil('\x1B[A', () => frame().includes('❯ [ Regenerate ]'));

screen.stdin.write('\r');

await waitFor(() => ['Identity Regenerated', 'Refusing to overwrite', 'backed up to'].some((outcome) => frame().includes(outcome)));

process.stdout.write(JSON.stringify({ warning, result: frame() }));
screen.unmount();
process.exit(0);
