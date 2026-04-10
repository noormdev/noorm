/**
 * noorm run exec <path> — batch-execute SQL files matching a glob or directory.
 *
 * CLI counterpart to the TUI RunExecScreen. Accepts a glob pattern or directory
 * path, discovers all matching SQL files, and executes them sequentially.
 */
import path from 'node:path';
import { stat } from 'node:fs/promises';

import { defineCommand } from 'citty';
import { attempt } from '@logosdx/utils';

import { withContext, outputResult, sharedArgs } from '../_utils.js';
import { discoverFiles } from '../../core/runner/index.js';

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

    // Treat as glob pattern
    const glob = new Bun.Glob(input);
    const matches: string[] = [];

    for await (const match of glob.scan({ cwd, absolute: true, onlyFiles: true })) {

        if (match.endsWith('.sql') || match.endsWith('.sql.tmpl')) {

            matches.push(match);

        }

    }

    return matches.sort();

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

        if (resolveErr || !filepaths) {

            process.stderr.write(`Error: Failed to resolve paths: ${resolveErr?.message ?? 'Unknown error'}\n`);
            process.exit(1);

        }

        if (filepaths.length === 0) {

            process.stderr.write(`Error: No SQL files found matching: ${args.path}\n`);
            process.exit(1);

        }

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.run.files(filepaths, { force: args.force, dryRun: args.dryRun }).then((res) => {

                    if (!args.json) {

                        for (const file of res.files) {

                            logger.info(`${file.filepath} (${file.status})`);

                        }

                        logger.info(`Run exec ${res.status}`, {
                            filesRun: res.filesRun,
                            filesSkipped: res.filesSkipped,
                            filesFailed: res.filesFailed,
                            durationMs: res.durationMs,
                        });

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, result, '');

        }

        process.exit(result.status === 'success' ? 0 : 2);

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
