import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { attempt } from '@logosdx/utils';

import { offerSkill } from '../../../src/cli/update.js';
import {
    SKILL_COMMAND,
    canPromptForSkill,
    installSkill,
} from '../../../src/core/update/skill.js';

describe('update: skill', () => {

    let binDir: string;
    let originalPath: string | undefined;
    let originalArgsFile: string | undefined;

    beforeEach(async () => {

        binDir = await mkdtemp(join(tmpdir(), 'noorm-skill-bin-'));
        originalPath = process.env['PATH'];
        originalArgsFile = process.env['NPX_ARGS_FILE'];

    });

    afterEach(async () => {

        process.env['PATH'] = originalPath;

        if (originalArgsFile === undefined) delete process.env['NPX_ARGS_FILE'];
        else process.env['NPX_ARGS_FILE'] = originalArgsFile;

        await rm(binDir, { recursive: true, force: true });

    });

    describe('installSkill', () => {

        it.skipIf(process.platform === 'win32')('should run `npx skills add` for the noorm skill and return its exit code', async () => {

            const argsFile = join(binDir, 'args.txt');

            await writeFile(join(binDir, 'npx'), '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$NPX_ARGS_FILE"\nexit 3\n');
            await chmod(join(binDir, 'npx'), 0o755);

            process.env['PATH'] = `${binDir}:${originalPath ?? ''}`;
            process.env['NPX_ARGS_FILE'] = argsFile;

            const code = await installSkill();
            const args = (await readFile(argsFile, 'utf-8')).trim().split('\n');

            expect(code).toBe(3);
            expect(args).toEqual(['skills', 'add', 'noormdev/noorm/skills']);

        });

        // Node.js is not required to run the noorm binary, so a missing npx has
        // to surface as an error the caller can explain, not a crash.
        it.skipIf(process.platform === 'win32')('should reject when npx is not installed', async () => {

            process.env['PATH'] = binDir;

            const [, err] = await attempt(() => installSkill());

            expect(err).toBeInstanceOf(Error);
            expect((err as NodeJS.ErrnoException).code).toBe('ENOENT');

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

    // The prompt needs a terminal; these are the paths that stay quiet or print the command.
    describe('offerSkill', () => {

        it('should print nothing for --json, even on a terminal', async () => {

            const write = spyOn(process.stdout, 'write').mockImplementation(() => true);

            await offerSkill(true, true);

            expect(write).not.toHaveBeenCalled();

            write.mockRestore();

        });

        it('should print the command instead of prompting when there is no terminal', async () => {

            const write = spyOn(process.stdout, 'write').mockImplementation(() => true);

            await offerSkill(false, false);

            const printed = write.mock.calls.map((call) => String(call[0])).join('');

            expect(printed).toContain(SKILL_COMMAND);

            write.mockRestore();

        });

    });

});
