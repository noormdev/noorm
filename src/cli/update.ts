/**
 * noorm update — check for and install updates.
 *
 * Downloads the platform-appropriate binary from GitHub releases
 * and replaces the running binary in-place.
 */
import * as p from '@clack/prompts';
import { defineCommand } from 'citty';
import { attempt } from '@logosdx/utils';

import { observer } from '../core/observer.js';
import { checkForUpdate, getCurrentVersion } from '../core/update/checker.js';
import { installUpdate } from '../core/update/updater.js';
import {
    SKILL_INSTALLERS,
    canPromptForSkill,
    findSkillInstaller,
    installSkill,
    skillCommand,
} from '../core/update/skill.js';
import { isInsecureMode, outputError, outputResult, sharedArgs } from './_utils.js';
import { EXIT } from './_exit.js';

// Wider than any line rewritten in place, so each `\r` rewrite erases the
// previous one by construction.
const STATUS_LINE_WIDTH = 40;

/** Render a byte count as MB with one decimal (e.g. 41.2). */
function toMb(bytes: number): string {

    return (bytes / 1024 / 1024).toFixed(1);

}

/**
 * Status output for `noorm update`. On a terminal, `pending` leaves its line
 * open and the next `say` rewrites it in place; off one, every line is final.
 * Under `--json` neither prints, so stdout holds only the JSON document.
 *
 * @example
 * const status = updateStatus((text) => process.stdout.write(text), { isTty: true, json: false });
 * status.pending('Checking for updates...');
 * status.say('Already on the latest version (1.5.1)');
 */
export function updateStatus(write: (text: string) => void, opts: { isTty: boolean; json: boolean }) {

    let lineOpen = false;

    const raw = (text: string) => {

        lineOpen = !text.endsWith('\n');
        write(text);

    };

    return {
        /** Writes text as given; the download renderer draws through this. */
        raw,

        say(line: string) {

            if (opts.json) return;

            raw(lineOpen ? `\r${line.padEnd(STATUS_LINE_WIDTH)}\n` : `${line}\n`);

        },

        pending(line: string) {

            if (opts.json) return;

            raw(opts.isTty ? line : `${line}\n`);

        },

        /** Ends a line left open, so what prints next starts on a line of its own. */
        endLine() {

            if (lineOpen) raw('\n');

        },
    };

}

/**
 * Builds the `\r`-rewritten download line for a terminal, or null off one:
 * piped output has no cursor to rewind, so every tick would land on its own
 * line. The tick that reaches the total writes `Downloaded X MB (100%)` and
 * ends the line; ticks after it write nothing.
 *
 * @example
 * const render = downloadProgressRenderer((text) => process.stdout.write(text), true);
 * observer.on('update:progress', (progress) => render?.(progress));
 */
export function downloadProgressRenderer(
    write: (text: string) => void,
    isTty: boolean,
): ((progress: { received: number; total: number }) => void) | null {

    let done = false;

    if (!isTty) return null;

    return ({ received, total }) => {

        if (done) return;

        if (total > 0 && received >= total) {

            done = true;
            write(`\r${`Downloaded ${toMb(total)} MB (100%)`.padEnd(STATUS_LINE_WIDTH)}\n`);

            return;

        }

        const line = total > 0
            ? `Downloading ${toMb(received)} / ${toMb(total)} MB (${Math.floor((received * 100) / total)}%)`
            : `Downloading ${toMb(received)} MB`;

        write(`\r${line.padEnd(STATUS_LINE_WIDTH)}`);

    };

}

/** Every way to install the skill, one per line, with what each needs. */
function skillInstallOptions(): string {

    const width = Math.max(...SKILL_INSTALLERS.map((installer) => skillCommand(installer).length));

    return SKILL_INSTALLERS
        .map((installer) => `  ${skillCommand(installer).padEnd(width)}  (${installer.bin}: ${installer.provider})`)
        .join('\n');

}

/**
 * Offer to install or update the noorm agent skill once the binary is
 * updated, through the first installer on PATH. With none, or when the
 * installer fails, it prints every way to install the skill. The update
 * already succeeded, so nothing here changes the exit code.
 *
 * @example
 * if (result.success) await offerSkill(args.json);
 */
export async function offerSkill(
    json: boolean | undefined,
    interactive = canPromptForSkill({ stdinTty: process.stdin.isTTY, stdoutTty: process.stdout.isTTY }),
): Promise<void> {

    if (json) return;

    const installer = findSkillInstaller();

    if (!installer) {

        process.stdout.write(`Agent skill: install npx or gh, then run its command:\n${skillInstallOptions()}\n`);

        return;

    }

    const command = skillCommand(installer);

    if (!interactive) {

        process.stdout.write(`Agent skill: run \`${command}\` to install or update it.\n`);

        return;

    }

    const answer = await p.confirm({
        message: `Install or update the noorm agent skill? (${command}, run in ${process.cwd()})`,
        initialValue: true,
    });

    if (p.isCancel(answer) || !answer) {

        process.stdout.write(`Skipped. Run \`${command}\` any time.\n`);

        return;

    }

    const [code, spawnErr] = await attempt(() => installSkill(installer));

    if (spawnErr) {

        process.stderr.write(`Could not run ${installer.bin} (${spawnErr.message}). Install the skill with either:\n${skillInstallOptions()}\n`);

        return;

    }

    if (code !== 0) {

        process.stderr.write(`Skill install exited with code ${code}. Install the skill with either:\n${skillInstallOptions()}\n`);

    }

}

const updateCommand = defineCommand({
    meta: {
        name: 'update',
        description: 'Check for and install noorm updates',
    },
    args: {
        json: sharedArgs.json,
        insecure: {
            type: 'boolean',
            description: 'Skip checksum verification when checksums.txt is unreachable (never bypasses a confirmed mismatch)',
        },
    },
    async run({ args }) {

        const currentVersion = getCurrentVersion();
        const isTty = Boolean(process.stdout.isTTY) && !args.json;
        const status = updateStatus((text) => process.stdout.write(text), { isTty, json: Boolean(args.json) });

        status.pending('Checking for updates...');

        const [checkResult, checkErr] = await attempt(() => checkForUpdate());

        if (checkErr || !checkResult) {

            const errorMsg = checkErr?.message ?? 'Failed to check for updates (offline?)';

            // One document, not two: `outputError` already writes the
            // `{success:false,error}` envelope under `--json`, so the extra
            // `outputResult` put a second, success-shaped object on stdout for
            // the same failure.
            if (args.json) {

                outputResult(args, {
                    success: false,
                    error: errorMsg,
                    currentVersion,
                    latestVersion: null,
                    updateAvailable: false,
                    installed: false,
                }, '');

            }
            else {

                status.endLine();
                outputError(args, errorMsg);

            }

            process.exit(EXIT.FAILURE);

        }

        if (!checkResult.updateAvailable) {

            status.say(`Already on the latest version (${currentVersion})`);

            if (args.json) {

                outputResult(args, {
                    currentVersion,
                    latestVersion: checkResult.latestVersion,
                    updateAvailable: false,
                    installed: false,
                }, '');

            }

            process.exit(EXIT.SUCCESS);

        }

        const latestVersion = checkResult.latestVersion;

        status.say(`Update available: ${currentVersion} → ${latestVersion}`);

        const insecure = isInsecureMode(args);

        if (insecure) {

            process.stderr.write('Warning: checksum verification will be skipped if checksums.txt is unreachable (--insecure).\n');

        }

        const renderProgress = downloadProgressRenderer(status.raw, isTty);

        status.pending(isTty ? 'Downloading...' : 'Installing (downloading binary)...');

        const onProgress = (progress: { received: number; total: number }) => renderProgress?.(progress);

        const onRetry = ({ attempt: n, maxAttempts, error }: { attempt: number; maxAttempts: number; error: string }) => {

            status.endLine();
            status.say(`${error} — resuming (attempt ${n + 1}/${maxAttempts})...`);

        };

        observer.on('update:progress', onProgress);
        observer.on('update:retry', onRetry);

        const [result, installErr] = await attempt(() => installUpdate(latestVersion, { insecure }));

        observer.off('update:progress', onProgress);
        observer.off('update:retry', onRetry);

        status.endLine();

        if (installErr || !result) {

            // installUpdate resolves with a result even on failure; a throw here
            // is unexpected (e.g. abort wiring) — surface it rather than hang.
            const errorMsg = installErr?.message ?? 'Update failed';

            if (args.json) {

                outputResult(args, {
                    success: false,
                    error: errorMsg,
                    currentVersion,
                    latestVersion,
                    updateAvailable: true,
                    installed: false,
                }, '');

            }
            else {

                outputError(args, `Update failed: ${errorMsg}`);

            }

            process.exit(EXIT.FAILURE);

        }

        if (result.success) {

            status.say(`Updated to ${result.newVersion}. Restart noorm to use the new version.`);

            await offerSkill(args.json);

        }
        else if (!args.json) {

            outputError(args, `Update failed: ${result.error}`);

        }

        if (args.json) {

            // `success` is stated rather than inferred: the payload carries no
            // `status`, so without it a failed install reported success:true
            // while the process exited 1.
            outputResult(args, {
                success: result.success,
                currentVersion,
                latestVersion,
                updateAvailable: true,
                installed: result.success,
                error: result.error ?? undefined,
            }, '');

        }

        process.exit(result.success ? EXIT.SUCCESS : EXIT.FAILURE);

    },
});

(updateCommand as typeof updateCommand & { examples: string[] }).examples = [
    'noorm update',
    'noorm update --json',
    'noorm update --insecure',
];

export default updateCommand;
