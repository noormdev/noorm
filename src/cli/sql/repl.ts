/**
 * noorm sql repl — launch the TUI directly on the SQL Terminal screen.
 *
 * A REPL is inherently interactive; reusing the TUI's SqlTerminalScreen
 * gives users a full-featured environment (multi-line editing, sortable
 * result tables, history navigation) without duplicating code.
 *
 * If --config is provided, the active config is switched before the TUI
 * launches so the REPL starts against the intended database.
 *
 * Ink and React are loaded lazily inside run() (alongside the TUI app)
 * so that resolving this module's meta never pays their import cost —
 * only actually launching the REPL does.
 */
import { Writable } from 'node:stream';

import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { observer } from '../../core/observer.js';
import { enableAutoLoggerInit } from '../../core/logger/init.js';
import { getStateManager } from '../../core/state/index.js';
import { isYesMode, sharedArgs } from '../_utils.js';

/**
 * No-op stream that discards all writes.
 * Suppresses logger output that would otherwise corrupt Ink rendering.
 */
const nullStream = new Writable({ write: (_, __, cb) => cb() });

const replCommand = defineCommand({
    meta: {
        name: 'repl',
        description: 'Launch the TUI at the SQL Terminal (interactive)',
    },
    args: {
        config: sharedArgs.config,
        yes: sharedArgs.yes,
    },
    async run({ args }) {

        // === TTY gate ===
        // A REPL is interactive by definition. --yes / NOORM_YES can't help
        // here, but redirecting users to the headless alternatives can.
        if (isYesMode(args)) {

            process.stderr.write(
                'Error: noorm sql repl is interactive only. For non-interactive SQL, use:\n' +
                '  noorm sql query "SELECT 1"            # one-shot\n' +
                '  noorm sql --file query.sql            # from a file\n',
            );
            process.exit(1);

        }

        if (!process.stdin.isTTY) {

            process.stderr.write('Error: noorm sql repl requires an interactive terminal.\n');
            process.exit(1);

        }

        // === Optional config switch ===
        if (args.config) {

            const projectRoot = process.cwd();
            const stateManager = getStateManager(projectRoot);

            const [, loadErr] = await attempt(() => stateManager.load());
            if (loadErr) {

                process.stderr.write(`Error: ${loadErr.message}\n`);
                process.exit(1);

            }

            const configExists = stateManager.getConfig(args.config) !== null;
            if (!configExists) {

                process.stderr.write(`Error: Config not found: ${args.config}\n`);
                process.exit(1);

            }

            const [, setErr] = await attempt(() => stateManager.setActiveConfig(args.config!));
            if (setErr) {

                process.stderr.write(`Error: ${setErr.message}\n`);
                process.exit(1);

            }

        }

        // === Launch TUI at db/sql ===
        const [{ render }, { default: React }, { App }] = await Promise.all([
            import('ink'),
            import('react'),
            import('../../tui/app.js'),
        ]);

        enableAutoLoggerInit(process.cwd(), {
            console: nullStream,
            diagnostics: nullStream,
        });

        const { waitUntilExit, clear, unmount } = render(
            React.createElement(App, { initialRoute: 'db/sql', initialParams: {} }),
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

(replCommand as typeof replCommand & { examples: string[] }).examples = [
    'noorm sql repl',
    'noorm sql repl --config dev',
];

export default replCommand;
