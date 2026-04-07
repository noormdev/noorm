/**
 * noorm config rm — directs the user to the TUI.
 *
 * Removing a config requires confirmation and interactive state management.
 * The CLI directs the user to the TUI for now; this may be wired to
 * @clack/prompts in a future change.
 */
import { defineCommand } from 'citty';

const rmCommand = defineCommand({
    meta: {
        name: 'rm',
        description: 'Remove a configuration (interactive, via TUI)',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Configuration name to remove',
            required: false,
        },
    },
    async run() {

        process.stdout.write('Interactive only — run: noorm ui\n');
        process.exit(0);

    },
});

(rmCommand as typeof rmCommand & { examples: string[] }).examples = [
    'noorm config rm old_prod',
    'noorm config rm old_prod --yes',
    'noorm ui  # then navigate to config > rm',
];

export default rmCommand;
