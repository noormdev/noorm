/**
 * noorm run exec <path> — batch-execute SQL files matching a glob or directory.
 *
 * CLI counterpart to the TUI RunExecScreen. Accepts a glob pattern or directory
 * path, discovers all matching SQL files, and executes them sequentially.
 */
import path from 'node:path';
import { glob as nodeGlob, stat } from 'node:fs/promises';

import { defineCommand } from 'citty';
import { attempt } from '@logosdx/utils';

import { withContext, outputResult, outputError, sharedArgs } from '../_utils.js';
import { EXIT, exitCodeForStatus } from '../_exit.js';
import { discoverFiles } from '../../core/runner/index.js';

/**
 * Expand a glob to absolute paths under `cwd`, on whichever runtime is hosting us.
 *
 * `run exec` was the only CLI command that hard-required the `Bun` global, so
 * it died with `Bun is not defined` on the documented Node dev entry (and in
 * the `tests/cli` harness, which spawns `node dist/cli/index.js`) before doing
 * any work. Bun's own Glob stays the primary path so the compiled binary keeps
 * its existing matching semantics exactly.
 */
async function expandGlob(pattern: string, cwd: string): Promise<string[]> {

    const matches: string[] = [];

    if (typeof Bun !== 'undefined') {

        for await (const match of new Bun.Glob(pattern).scan({ cwd, absolute: true, onlyFiles: true })) {

            matches.push(match);

        }

        return matches;

    }

    for await (const match of nodeGlob(pattern, { cwd })) {

        matches.push(path.isAbsolute(match) ? match : path.join(cwd, match));

    }

    return matches;

}

/**
 * Resolve a path argument (directory or glob) to an array of absolute SQL file paths.
 *
 * When the path is an existing directory, delegates to discoverFiles for recursive
 * discovery. Otherwise treats the argument as a glob pattern and expands it.
 *
 * @example
 * const files = await resolveInputPaths('sql/', cwd);
 * const files = await resolveInputPaths('migrations/*.sql', cwd);
 */
async function resolveInputPaths(input: string, cwd: string): Promise<string[]> {

    const resolved = path.isAbsolute(input) ? input : path.join(cwd, input);

    const [stats] = await attempt(() => stat(resolved));

    if (stats?.isDirectory()) {

        return discoverFiles(resolved);

    }

    const matches = await expandGlob(input, cwd);

    return matches
        .filter((match) => match.endsWith('.sql') || match.endsWith('.sql.tmpl'))
        .sort();

}

const execCommand = defineCommand({
    meta: {
        name: 'exec',
        description: 'Batch-execute SQL files matching a glob pattern or directory',
    },
    args: {
        path: {
            type: 'positional',
            description: 'Directory path or glob pattern to match SQL files',
            required: true,
        },
        config: sharedArgs.config,
        dryRun: sharedArgs.dryRun,
        force: sharedArgs.force,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const cwd = process.cwd();

        const [filepaths, resolveErr] = await attempt(() => resolveInputPaths(args.path, cwd));

        // outputError, not a bare stderr write: under `--json` these two exits
        // used to produce an empty stdout, so a pipeline parsing the envelope
        // got nothing to parse and no `success: false` to key off.
        if (resolveErr || !filepaths) {

            outputError(args, `Failed to resolve paths: ${resolveErr?.message ?? 'Unknown error'}`);
            process.exit(EXIT.FAILURE);

        }

        if (filepaths.length === 0) {

            outputError(args, `No SQL files found matching: ${args.path}`);
            process.exit(EXIT.USAGE);

        }

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.run.files(filepaths, { force: args.force, dryRun: args.dryRun }).then((res) => {

                    if (!args.json) {

                        for (const file of res.files) {

                            if (file.status === 'failed') {

                                logger.error(`${file.filepath} (failed)`);
                                if (file.error) logger.error(`  error: ${file.error}`);

                            }
                            else if (file.status === 'skipped' && file.skipReason) {

                                logger.info(`${file.filepath} (skipped: ${file.skipReason})`);

                            }
                            else {

                                logger.info(`${file.filepath} (${file.status})`);

                            }

                        }

                        const summary = {
                            filesRun: res.filesRun,
                            filesSkipped: res.filesSkipped,
                            filesFailed: res.filesFailed,
                            durationMs: res.durationMs,
                        };

                        if (res.status === 'success') {

                            logger.info(`Run exec ${res.status}`, summary);

                        }
                        else {

                            logger.error(`Run exec ${res.status}`, summary);

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, result, '');

        }

        process.exit(exitCodeForStatus(result.status));

    },
});

(execCommand as typeof execCommand & { examples: string[] }).examples = [
    'noorm run exec sql/',
    'noorm run exec migrations/',
    'noorm run exec "sql/**/*.sql"',
    'noorm run exec "seeds/*.sql" --force',
    'noorm run exec sql/ --json',
    'noorm run exec "migrations/*.sql" --dry-run',
];

export default execCommand;
