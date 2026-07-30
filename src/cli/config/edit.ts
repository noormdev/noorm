/**
 * noorm config edit — directs the user to the TUI.
 *
 * Editing a config requires interactive prompts (connection details, password,
 * test connection). The CLI directs the user to the TUI for now; this may
 * be wired to @clack/prompts in a future change.
 */
import { defineCommand } from 'citty';

import { outputError, sharedArgs } from '../_utils.js';

const editCommand = defineCommand({
    meta: {
        name: 'edit',
        description: 'Edit a configuration (interactive, via TUI)',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Configuration name',
            required: false,
        },
        json: sharedArgs.json,
    },
    async run({ args }) {

        outputError(
            args,
            'Interactive only — run: noorm ui. For headless edits use: noorm config import <file.json> --force --yes',
        );
        process.exit(1);

    },
});

(editCommand as typeof editCommand & { examples: string[] }).examples = [
    'noorm ui  # then navigate to config > edit',
    'noorm config import ./dev-config.json --force --yes  # headless equivalent',
];

export default editCommand;
