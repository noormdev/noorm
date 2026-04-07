/**
 * noorm ui — launch the interactive terminal UI.
 *
 * This is the only CLI subcommand that renders the Ink/React TUI.
 * The TUI always starts at the home route; deep-linking is not supported.
 */
import { Writable } from 'node:stream';

import { defineCommand } from 'citty';
import { render } from 'ink';
import React from 'react';

import { observer } from '../core/observer.js';
import { enableAutoLoggerInit } from '../core/logger/init.js';

/**
 * No-op stream that discards all writes.
 *
 * Suppresses logger diagnostics in TUI mode — they would otherwise
 * corrupt the Ink output.
 */
const nullStream = new Writable({ write: (_, __, cb) => cb() });

const uiCommand = defineCommand({
    meta: {
        name: 'ui',
        description: 'Launch interactive terminal UI',
    },
    async run() {

        // Lazy import the TUI app so citty --help on other commands
        // doesn't pay the cost of loading Ink + all screens.
        const { App } = await import('../tui/app.js');

        enableAutoLoggerInit(process.cwd(), {
            console: nullStream,
            diagnostics: nullStream,
        });

        const { waitUntilExit, clear, unmount } = render(
            React.createElement(App, { initialRoute: 'home', initialParams: {} }),
            {
                exitOnCtrlC: false,
                patchConsole: true,
            },
        );

        let unmounted = false;
        observer.on('app:exit', () => {

            if (unmounted) return;
            unmounted = true;

            clear();
            unmount();

        });

        await waitUntilExit();
        process.exit(0);

    },
});

export default uiCommand;
