/**
 * Child process for the init screen tests: renders `InitScreen` with the
 * project directory as cwd.
 *
 * Modes: `show` stops at the step the screen settles on, `identity` also
 * submits the identity form, `add` and `skip` then answer the config question
 * and wait for init to finish. A second argument of `force` sets the param.
 *
 * Prints the frame at mount, at the settled step, at project setup, and at
 * the end; a frame the mode never reached is an empty string.
 */
import React from 'react';
import { render } from 'ink-testing-library';

import { FocusProvider } from '../../../src/tui/focus.js';
import { RouterProvider } from '../../../src/tui/router.js';
import { AppContextProvider } from '../../../src/tui/app-context.js';
import { InitScreen } from '../../../src/tui/screens/init/InitScreen.js';
import { drive, refuseOutsideThrowawayHome } from './home-child.js';

refuseOutsideThrowawayHome();

const [mode, force] = process.argv.slice(2);

const screen = render(
    <AppContextProvider autoLoad={false}>
        <RouterProvider>
            <FocusProvider>
                <InitScreen params={{ force: force === 'force' }} />
            </FocusProvider>
        </RouterProvider>
    </AppContextProvider>,
);

const { frame, waitFor, pressUntil } = drive(screen);

const first = frame();
const onProjectSetup = () => frame().includes('Would you like to add a database configuration now?');

await waitFor(() => frame().includes('[ Continue ]') || frame().includes('Already Initialized') || onProjectSetup());

const settled = frame();
let project = '';
let final = '';

if (mode !== 'show') {

    await pressUntil('\x1B[A', () => frame().includes('❯ [ Continue ]'));
    await pressUntil('\r', onProjectSetup);

    project = frame();

}

if (mode === 'add' || mode === 'skip') {

    if (mode === 'skip') {

        await pressUntil('\x1B[B', () => frame().split('\n').some((row) => row.includes('❯') && row.includes('do it later')));

    }

    await pressUntil('\r', () => !onProjectSetup());
    await waitFor(() => frame().includes('Initialization Complete') || frame().includes('Initialization failed'));

    final = frame();

}

process.stdout.write(JSON.stringify({ first, settled, project, final }));
screen.unmount();
process.exit(0);
