import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { attempt } from '@logosdx/utils';

import { offerSkill } from '../../../src/cli/update.js';
import {
    SKILL_INSTALLERS,
    canPromptForSkill,
    findSkillInstaller,
    installSkill,
    skillCommand,
} from '../../../src/core/update/skill.js';

const [NPX, GH] = SKILL_INSTALLERS;

describe('update: skill', () => {

    let binDir: string;
    let originalPath: string | undefined;
    let originalArgsFile: string | undefined;

    /** Put a fake program on the test PATH that records its arguments and exits with `code`. */
    async function fakeBin(name: string, code = 0): Promise<void> {

        await writeFile(join(binDir, name), `#!/bin/sh\nprintf '%s\\n' "$@" > "$FAKE_ARGS_FILE"\nexit ${code}\n`);
        await chmod(join(binDir, name), 0o755);

    }

    beforeEach(async () => {

        binDir = await mkdtemp(join(tmpdir(), 'noorm-skill-bin-'));
        originalPath = process.env['PATH'];
        originalArgsFile = process.env['FAKE_ARGS_FILE'];

        // Only the fakes are reachable, so the machine's own npx and gh never count.
        process.env['PATH'] = binDir;
        process.env['FAKE_ARGS_FILE'] = join(binDir, 'args.txt');

    });

    afterEach(async () => {

        process.env['PATH'] = originalPath;

        if (originalArgsFile === undefined) delete process.env['FAKE_ARGS_FILE'];
        else process.env['FAKE_ARGS_FILE'] = originalArgsFile;

        await rm(binDir, { recursive: true, force: true });

    });

    describe('findSkillInstaller', () => {

        it.skipIf(process.platform === 'win32')('should prefer npx when both npx and gh are installed', async () => {

            await fakeBin('npx');
            await fakeBin('gh');

            expect(findSkillInstaller()).toBe(NPX);

        });

        // Node.js is not required to run the noorm binary, so a machine
        // without npx may still have the GitHub CLI.
        it.skipIf(process.platform === 'win32')('should fall back to gh when npx is missing', async () => {

            await fakeBin('gh');

            expect(findSkillInstaller()).toBe(GH);

        });

        it('should find nothing when neither npx nor gh is installed', () => {

            expect(findSkillInstaller()).toBeNull();

        });

    });

    describe('installSkill', () => {

        it.skipIf(process.platform === 'win32')('should run `npx skills add` for the noorm skill and return its exit code', async () => {

            await fakeBin('npx', 3);

            const code = await installSkill(NPX);
            const args = (await readFile(join(binDir, 'args.txt'), 'utf-8')).trim().split('\n');

            expect(code).toBe(3);
            expect(args).toEqual(['skills', 'add', 'noormdev/noorm/skills']);

        });

        // An exact skill path skips gh's search of the whole repository.
        it.skipIf(process.platform === 'win32')('should run `gh skill install` with the skill path', async () => {

            await fakeBin('gh');

            const code = await installSkill(GH);
            const args = (await readFile(join(binDir, 'args.txt'), 'utf-8')).trim().split('\n');

            expect(code).toBe(0);
            expect(args).toEqual(['skill', 'install', 'noormdev/noorm', 'skills/noorm']);

        });

        it.skipIf(process.platform === 'win32')('should reject when the program cannot be started', async () => {

            const [, err] = await attempt(() => installSkill(NPX));

            expect(err).toBeInstanceOf(Error);
            expect(err).toHaveProperty('code', 'ENOENT');

        });

    });

    describe('canPromptForSkill', () => {

        it('should prompt only when both stdin and stdout are terminals', () => {

            expect(canPromptForSkill({ stdinTty: true, stdoutTty: true })).toBe(true);
            expect(canPromptForSkill({ stdinTty: false, stdoutTty: true })).toBe(false);
            expect(canPromptForSkill({ stdinTty: true, stdoutTty: false })).toBe(false);
            expect(canPromptForSkill({ stdinTty: undefined, stdoutTty: undefined })).toBe(false);

        });

    });

    // The prompt needs a terminal; these are the paths that stay quiet or print commands.
    describe('offerSkill', () => {

        async function printedBy(run: () => Promise<void>): Promise<string> {

            const write = spyOn(process.stdout, 'write').mockImplementation(() => true);

            await run();

            const printed = write.mock.calls.map((call) => String(call[0])).join('');

            write.mockRestore();

            return printed;

        }

        it('should print nothing for --json, even on a terminal', async () => {

            expect(await printedBy(() => offerSkill(true, true))).toBe('');

        });

        it.skipIf(process.platform === 'win32')('should print the command it would run when there is no terminal', async () => {

            await fakeBin('gh');

            const printed = await printedBy(() => offerSkill(false, false));

            expect(printed).toContain(skillCommand(GH));
            expect(printed).not.toContain(skillCommand(NPX));

        });

        // With nothing to run, the user needs both ways in and where to get them.
        it('should print both commands and where to get each program when neither is installed', async () => {

            const printed = await printedBy(() => offerSkill(false, true));

            expect(printed).toContain(skillCommand(NPX));
            expect(printed).toContain(skillCommand(GH));
            expect(printed).toContain('https://nodejs.org');
            expect(printed).toContain('https://cli.github.com');

        });

    });

});
