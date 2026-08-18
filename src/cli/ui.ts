/**
 * noorm ui — launch the interactive terminal UI.
 *
 * This is the only CLI subcommand that renders the Ink/React TUI.
 * The TUI always starts at the home route; deep-linking is not supported.
 *
 * Ink, React, and the TUI app are all loaded lazily inside run() so that
 * resolving this module's meta (e.g. for `noorm --help`'s root command
 * listing, or `noorm ui --help`) never pays their import cost — only
 * actually launching the UI does.
 */
import { Writable } from 'node:stream';

import { defineCommand } from 'citty';

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

        const [{ render }, { default: React }, { App }] = await Promise.all([
            import('ink'),
            import('react'),
            import('../tui/app.js'),
        ]);

        enableAutoLoggerInit(process.cwd(), {
            console: nullStream,
            diagnostics: nullStream,
        });

        const { waitUntilExit, clear, unmount } = render(
            React.createElement(App, { initialRoute: 'home', initialParams: {} }),
            {
                exitOnCtrlC: false,
                patchConsole: true,
                // Without this the TUI draws into normal scrollback, so every
                // repaint appends and anything taller than the window scrolls
                // out of reach. The alternate buffer also restores whatever the
                // terminal was showing before `noorm ui` on exit.
                alternateScreen: true,
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
