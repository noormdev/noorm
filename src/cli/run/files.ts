/**
 * noorm run files --paths <path,...> — execute multiple SQL files in order.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const filesCommand = defineCommand({
    meta: {
        name: 'files',
        description: 'Execute multiple SQL files in order',
    },
    args: {
        paths: {
            type: 'string',
            description: 'Comma-separated list of SQL file paths to execute',
            required: true,
        },
        config: sharedArgs.config,
        dryRun: sharedArgs.dryRun,
        force: sharedArgs.force,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const filepaths = args.paths.split(',').map((p) => p.trim()).filter(Boolean);

        if (filepaths.length === 0) {

            process.stderr.write('Error: --paths must contain at least one file path\n');
            process.exit(1);

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

                            logger.info(`Run files ${res.status}`, summary);

                        }
                        else {

                            logger.error(`Run files ${res.status}`, summary);

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

        process.exit(result.status === 'success' ? 0 : 2);

    },
});

(filesCommand as typeof filesCommand & { examples: string[] }).examples = [
    'noorm run files --paths seed.sql,fixtures.sql',
    'noorm run files --paths sql/001_tables.sql,sql/002_indexes.sql',
    'noorm run files --paths migrations/001.sql,migrations/002.sql --json',
    'noorm run files --paths triggers/audit.sql --force',
];

export default filesCommand;
