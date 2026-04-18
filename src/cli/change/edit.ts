/**
 * noorm change edit — open a change folder in the user's editor.
 *
 * Offline operation: no database connection required. Resolves the
 * changes directory from settings, verifies the named change exists,
 * and spawns $EDITOR (falling back to $VISUAL, then 'code') with the
 * folder path. stdio is inherited so terminal editors (vim, nano,
 * emacs -nw) take over the terminal in-place; exits with the editor's
 * own exit code.
 *
 * If the change name is omitted and stdin is a TTY, the user gets an
 * interactive clack picker listing the folders found in the changes
 * directory. In a non-TTY context (CI, piped) the command errors out
 * rather than hanging for input.
 */
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { getSettingsManager } from '../../core/settings/index.js';
import { outputError } from '../_utils.js';
import { selectChangeFromFs, requireTty } from './_prompt.js';

/**
 * Spawn an editor against a target path and wait for it to exit.
 *
 * Resolves with the editor's exit code so callers can propagate it
 * as the process exit code. Rejects only when spawn itself fails
 * (e.g. the editor binary does not exist — ENOENT), since a non-zero
 * editor exit is still a meaningful outcome, not an error.
 *
 * @example
 * ```ts
 * const code = await runEditor('vim', '/project/changes/2024-04-17-foo');
 * process.exit(code);
 * ```
 */
function runEditor(editor: string, target: string): Promise<number> {

    return new Promise((resolve, reject) => {

        const child = spawn(editor, [target], { stdio: 'inherit' });

        child.on('error', reject);
        child.on('exit', (code) => resolve(code ?? 0));

    });

}

const editCommand = defineCommand({
    meta: { name: 'edit', description: 'Open a change folder in your editor' },
    args: {
        name: {
            type: 'positional',
            description: 'Change name (omit to pick interactively on a TTY)',
            required: false,
        },
    },
    async run({ args }) {

        const projectRoot = process.cwd();
        const settingsManager = getSettingsManager(projectRoot);

        const [, settingsErr] = await attempt(() => settingsManager.load());

        if (settingsErr) {

            outputError(args, `Failed to load settings: ${settingsErr.message}`);
            process.exit(1);

        }

        const changesDir = join(
            projectRoot,
            settingsManager.settings.paths?.changes ?? 'changes',
        );

        let changeName = args.name;

        if (!changeName) {

            if (!requireTty('Change name')) process.exit(1);

            const picked = await selectChangeFromFs(changesDir, 'Pick a change to edit');

            if (!picked) process.exit(1);

            changeName = picked;

        }

        const changePath = join(changesDir, changeName);

        const [existing, statErr] = await attempt(() => stat(changePath));

        if (statErr || !existing?.isDirectory()) {

            outputError(args, `Change not found: ${changeName}`);
            process.exit(1);

        }

        const editor = process.env['EDITOR'] || process.env['VISUAL'] || 'code';

        const [code, spawnErr] = await attempt(() => runEditor(editor, changePath));

        if (spawnErr) {

            outputError(args, `Failed to open editor "${editor}": ${spawnErr.message}`);
            process.exit(1);

        }

        process.exit(code ?? 0);

    },
});

(editCommand as typeof editCommand & { examples: string[] }).examples = [
    'noorm change edit',
    'noorm change edit 2024-04-17-add-users-table',
    'EDITOR=vim noorm change edit 2024-04-17-add-users-table',
];

export default editCommand;
