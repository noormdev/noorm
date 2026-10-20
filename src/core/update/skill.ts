/**
 * Install or update the noorm agent skill.
 *
 * The skill ships from this repo's `skills/` directory. Either the `skills`
 * CLI (through npx) or the GitHub CLI can install it, and both ask which
 * coding agents to install it into.
 */
import { spawn } from 'node:child_process';

/** A program that can install the skill, and how to reach it when missing. */
export interface SkillInstaller {

    /** Executable looked up on PATH. */
    bin: 'npx' | 'gh';

    args: string[];

    /** What the user installs to get `bin`, and where. */
    provider: string;

}

/** In order of preference: npx is what the docs teach, gh is the fallback. */
export const SKILL_INSTALLERS: readonly [SkillInstaller, SkillInstaller] = [
    {
        bin: 'npx',
        args: ['skills', 'add', 'noormdev/noorm/skills'],
        provider: 'Node.js, https://nodejs.org',
    },
    {
        bin: 'gh',
        args: ['skill', 'install', 'noormdev/noorm', 'skills/noorm'],
        provider: 'GitHub CLI 2.90 or newer, https://cli.github.com',
    },
];

/**
 * The installer as a command line to show the user.
 *
 * @example
 * skillCommand(SKILL_INSTALLERS[0]); // 'npx skills add noormdev/noorm/skills'
 */
export function skillCommand(installer: SkillInstaller): string {

    return [installer.bin, ...installer.args].join(' ');

}

/**
 * The first installer whose program is on PATH, or null when there is none.
 * Checked before prompting, so the prompt names the command that will run.
 *
 * @example
 * const installer = findSkillInstaller();
 * if (!installer) printBothOptions();
 */
export function findSkillInstaller(): SkillInstaller | null {

    // Bun.which otherwise reads the PATH the process started with
    const PATH = process.env['PATH'] ?? '';

    return SKILL_INSTALLERS.find((installer) => Bun.which(installer.bin, { PATH }) !== null) ?? null;

}

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
 * Run the installer attached to the terminal, so it can ask which agents to
 * install into. Running it again replaces an installed copy. Rejects only
 * when the program cannot be started.
 *
 * @example
 * const [code, err] = await attempt(() => installSkill(installer));
 */
export function installSkill(installer: SkillInstaller): Promise<number> {

    const isWindows = process.platform === 'win32';

    return new Promise((resolve, reject) => {

        const child = spawn(installer.bin, installer.args, {
            stdio: 'inherit',
            // npx is npx.cmd on Windows, which Node refuses to spawn without a shell
            shell: isWindows,
        });

        child.on('error', reject);
        // A signal (Ctrl-C at the installer's prompt) leaves no exit code; that is a failure
        child.on('exit', (code) => resolve(code ?? 1));

    });

}
