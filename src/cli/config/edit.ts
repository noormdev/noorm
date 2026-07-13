/**
 * noorm config edit — directs the user to the TUI.
 *
 * Editing a config requires interactive prompts (connection details, password,
 * test connection). The CLI directs the user to the TUI for now; this may
 * be wired to @clack/prompts in a future change.
 */
import { defineCommand } from 'citty';

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
    },
    async run() {

        process.stderr.write('Interactive only — run: noorm ui\n');
        process.exit(1);

    },
});

(editCommand as typeof editCommand & { examples: string[] }).examples = [
    'noorm ui  # then navigate to config > edit',
];

export default editCommand;
