import { defineCommand } from 'citty';
import { outputError } from '../_utils.js';
import { EXIT } from '../_exit.js';

export default defineCommand({
    meta: { name: 'pipeline', description: 'Run SQL pipelines and inspect their history' },
    subCommands: {
        run: () => import('./run.js').then((m) => m.default),
        history: () => import('./history.js').then((m) => m.default),
        show: () => import('./show.js').then((m) => m.default),
    },
    run({ rawArgs }) {

        // Citty invokes parent run after its child; reject only missing or unknown commands.
        if (!['run', 'history', 'show'].includes(rawArgs[0] ?? '')) {

            outputError({ json: rawArgs.includes('--json') }, 'A pipeline command is required: run, history or show');
            process.exitCode = EXIT.USAGE;

        }

    },
});
