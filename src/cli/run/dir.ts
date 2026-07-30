/**
 * noorm run dir <path> — execute all SQL files in a directory.
 */
import { stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { defineCommand } from 'citty';
import { attempt } from '@logosdx/utils';

import { withContext, outputResult, outputError, sharedArgs } from '../_utils.js';
import { EXIT, exitCodeForStatus } from '../_exit.js';

const dirCommand = defineCommand({
    meta: {
        name: 'dir',
        description: 'Execute all SQL files in a directory',
    },
    args: {
        path: {
            type: 'positional',
            description: 'Path to the directory containing SQL files',
            required: true,
        },
        config: sharedArgs.config,
        dryRun: sharedArgs.dryRun,
        force: sharedArgs.force,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const cwd = process.cwd();
        const dirpath = isAbsolute(args.path) ? args.path : join(cwd, args.path);

        // Core turns a missing directory into a generic failed batch, which
        // read as "the SQL failed" rather than "you named a directory that
        // isn't there". Checked here so the message and the code both say so.
        const [stats] = await attempt(() => stat(dirpath));

        if (!stats?.isDirectory()) {

            outputError(args, `Directory not found: ${args.path}`);
            process.exit(EXIT.USAGE);

        }

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.run.dir(args.path, { force: args.force, dryRun: args.dryRun }).then((res) => {

                    if (!args.json) {

                        for (const file of res.files) {

                            if (file.status === 'failed') {

                                logger.error(`${file.filepath} (failed)`);
                                if (file.error) logger.error(`  error: ${file.error}`);

                            }
                            else if (file.status === 'skipped' && file.skipReason) {

                                logger.info(`${file.filepath} (skipped: ${file.skipReason})`);

                            }

                        }

                        const summary = {
                            filesRun: res.filesRun,
                            filesSkipped: res.filesSkipped,
                            filesFailed: res.filesFailed,
                        };

                        if (res.status === 'success') {

                            logger.info(`Run directory ${res.status}`, summary);

                        }
                        else {

                            logger.error(`Run directory ${res.status}`, summary);

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(EXIT.FAILURE);

        // A directory with no SQL files in it is a no-op, and core reports a
        // no-op as `status: 'success'`. Announcing success over zero files is
        // how a mistyped path silently passes a pipeline.
        const nothingDiscovered = result.files.length === 0;

        if (args.json) {

            outputResult(
                args,
                nothingDiscovered ? { ...result, success: false, error: `No SQL files found in: ${args.path}` } : result,
                '',
            );

        }
        else if (nothingDiscovered) {

            outputError(args, `No SQL files found in: ${args.path}`);

        }

        process.exit(nothingDiscovered ? EXIT.USAGE : exitCodeForStatus(result.status));

    },
});

(dirCommand as typeof dirCommand & { examples: string[] }).examples = [
    'noorm run dir migrations/',
    'noorm run dir seeds/',
    'noorm run dir sql/01_tables/ --json',
];

export default dirCommand;
