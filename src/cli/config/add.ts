/**
 * noorm config add — directs the user to the TUI.
 *
 * Adding a config requires interactive prompts (connection details, password,
 * test connection). The CLI directs the user to the TUI for now; this may
 * be wired to @clack/prompts in a future change.
 */
import { defineCommand } from 'citty';

const addCommand = defineCommand({
    meta: {
        name: 'add',
        description: 'Create a new configuration (interactive, via TUI)',
    },
    async run() {

        process.stdout.write('Interactive only — run: noorm ui\n');
        process.exit(0);

    },
});

(addCommand as typeof addCommand & { examples: string[] }).examples = [
    'noorm ui  # then navigate to config > add',
];

export default addCommand;
