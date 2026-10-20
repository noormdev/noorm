/**
 * Install or update the noorm agent skill.
 *
 * The skill ships from this repo's `skills/` directory and is installed with
 * the `skills` CLI, which asks which coding agents to install it into.
 */
import { spawn } from 'node:child_process';

export const SKILL_SOURCE = 'noormdev/noorm/skills';

export const SKILL_COMMAND = `npx skills add ${SKILL_SOURCE}`;

/**
 * Whether `noorm update` may ask about the skill: a person is at the terminal.
 *
 * @example
 * if (canPromptForSkill({ stdinTty: process.stdin.isTTY, stdoutTty: process.stdout.isTTY })) { ... }
 */
export function canPromptForSkill(opts: {
    stdinTty: boolean | undefined;
    stdoutTty: boolean | undefined;
}): boolean {

    return Boolean(opts.stdinTty) && Boolean(opts.stdoutTty);

}

/**
 * Run `npx skills add noormdev/noorm/skills` attached to the terminal, so the
 * skills CLI can ask which agents to install into. Running it again replaces
 * an installed copy. Rejects only when `npx` cannot be started.
 *
 * @example
 * const [code, err] = await attempt(() => installSkill());
 */
export function installSkill(): Promise<number> {

    const isWindows = process.platform === 'win32';

    return new Promise((resolve, reject) => {

        const child = spawn('npx', ['skills', 'add', SKILL_SOURCE], {
            stdio: 'inherit',
            // npx is npx.cmd on Windows, which Node refuses to spawn without a shell
            shell: isWindows,
        });

        child.on('error', reject);
        // A signal (Ctrl-C at the skills prompt) leaves no exit code; that is a failure
        child.on('exit', (code) => resolve(code ?? 1));

    });

}
