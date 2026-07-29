/**
 * noorm config add — directs the user to the TUI.
 *
 * Adding a config requires interactive prompts (connection details, password,
 * test connection). The CLI directs the user to the TUI for now; this may
 * be wired to @clack/prompts in a future change.
 */
import { defineCommand } from 'citty';

import { outputError, sharedArgs } from '../_utils.js';

const addCommand = defineCommand({
    meta: {
        name: 'add',
        description: 'Create a new configuration (interactive, via TUI)',
    },
    args: {
        json: sharedArgs.json,
    },
    async run({ args }) {

        outputError(args, 'Interactive only — run: noorm ui. For headless creation use: noorm config import <file.json>');
        process.exit(1);

    },
});

(addCommand as typeof addCommand & { examples: string[] }).examples = [
    'noorm ui  # then navigate to config > add',
    'noorm config import ./dev-config.json  # headless equivalent',
];

export default addCommand;
